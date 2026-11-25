"""SQLite atomic budget governor enforcing case, minute, daily, and backoff bounds."""

from __future__ import annotations

import random
import sqlite3
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from collections.abc import Callable

BudgetScope = Literal["case", "minute", "daily", "attempts"]


class BudgetConfig(BaseModel):
    """Hard token and retry caps enforced across every LLM call."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    max_tokens_per_case: int = Field(default=24000, ge=1)
    max_tokens_per_minute: int = Field(default=60000, ge=1)
    max_tokens_per_day: int = Field(default=500000, ge=1)
    max_attempts_per_case: int = Field(default=3, ge=1)
    max_retries_on_429: int = Field(default=4, ge=0)
    base_backoff_seconds: float = Field(default=0.5, gt=0.0)
    max_backoff_seconds: float = Field(default=8.0, gt=0.0)


class BudgetExceededError(RuntimeError):
    """Raised before making an outbound LLM call if any cap would be exceeded."""

    def __init__(self, scope: BudgetScope, message: str) -> None:
        super().__init__(message)
        self.scope = scope


class BudgetGovernor:
    """Thread-safe SQLite budget governor preventing any token or rate cap overshoot."""

    def __init__(
        self,
        db_path: str | Path,
        config: BudgetConfig | None = None,
        *,
        clock: Callable[[], float] | None = None,
        sleeper: Callable[[float], None] | None = None,
        rng: random.Random | None = None,
    ) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.config = config if config is not None else BudgetConfig()
        self._clock: Callable[[], float] = clock if clock is not None else time.time
        self._sleeper: Callable[[float], None] = sleeper if sleeper is not None else time.sleep
        self._rng = rng if rng is not None else random.Random()  # noqa: S311
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(self.db_path),
            timeout=30.0,
            check_same_thread=False,
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS token_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    tokens INTEGER NOT NULL,
                    cached_replay INTEGER NOT NULL,
                    recorded_epoch REAL NOT NULL,
                    day_utc TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_ledger_run ON token_ledger(run_id);
                CREATE INDEX IF NOT EXISTS idx_ledger_epoch ON token_ledger(recorded_epoch);
                CREATE INDEX IF NOT EXISTS idx_ledger_day ON token_ledger(day_utc);
                """
            )
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _day_str(self, epoch: float) -> str:
        return datetime.fromtimestamp(epoch, tz=UTC).strftime("%Y-%m-%d")

    def reserve(
        self,
        run_id: str,
        estimated_tokens: int,
        *,
        cached_replay: bool = False,
    ) -> int:
        """Atomically check all caps and record reserved tokens before outbound LLM traffic."""
        if estimated_tokens < 0:
            raise ValueError("estimated_tokens must be >= 0")

        now = self._clock()
        day = self._day_str(now)
        minute_cutoff = now - 60.0

        with self._lock:
            if cached_replay:
                cur = self._conn.execute(
                    """
                    INSERT INTO token_ledger(run_id, tokens, cached_replay, recorded_epoch, day_utc)
                    VALUES (?, 0, 1, ?, ?)
                    """,
                    (run_id, now, day),
                )
                self._conn.commit()
                return int(cur.lastrowid or 0)

            case_row = self._conn.execute(
                "SELECT COALESCE(SUM(tokens), 0) AS total FROM token_ledger WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            case_used = int(case_row["total"]) if case_row else 0
            if case_used + estimated_tokens > self.config.max_tokens_per_case:
                raise BudgetExceededError(
                    "case",
                    f"Case budget exceeded for {run_id}: {case_used}+{estimated_tokens} > "
                    f"{self.config.max_tokens_per_case}",
                )

            min_row = self._conn.execute(
                "SELECT COALESCE(SUM(tokens), 0) AS total FROM token_ledger "
                "WHERE recorded_epoch >= ?",
                (minute_cutoff,),
            ).fetchone()
            min_used = int(min_row["total"]) if min_row else 0
            if min_used + estimated_tokens > self.config.max_tokens_per_minute:
                raise BudgetExceededError(
                    "minute",
                    f"Per-minute budget exceeded: {min_used}+{estimated_tokens} > "
                    f"{self.config.max_tokens_per_minute}",
                )

            day_row = self._conn.execute(
                "SELECT COALESCE(SUM(tokens), 0) AS total FROM token_ledger WHERE day_utc = ?",
                (day,),
            ).fetchone()
            day_used = int(day_row["total"]) if day_row else 0
            if day_used + estimated_tokens > self.config.max_tokens_per_day:
                raise BudgetExceededError(
                    "daily",
                    f"Daily budget exceeded: {day_used}+{estimated_tokens} > "
                    f"{self.config.max_tokens_per_day}",
                )

            cur = self._conn.execute(
                """
                INSERT INTO token_ledger(run_id, tokens, cached_replay, recorded_epoch, day_utc)
                VALUES (?, ?, 0, ?, ?)
                """,
                (run_id, estimated_tokens, now, day),
            )
            self._conn.commit()
            return int(cur.lastrowid or 0)

    def settle_reservation(self, reservation_id: int, actual_tokens: int) -> None:
        """Replace estimated reservation with actual token count reported by provider."""
        if actual_tokens < 0:
            raise ValueError("actual_tokens must be >= 0")
        with self._lock:
            self._conn.execute(
                "UPDATE token_ledger SET tokens = ? WHERE id = ?",
                (actual_tokens, reservation_id),
            )
            self._conn.commit()

    def total_tokens_used(self, *, run_id: str | None = None) -> int:
        with self._lock:
            if run_id is not None:
                row = self._conn.execute(
                    "SELECT COALESCE(SUM(tokens), 0) AS total FROM token_ledger WHERE run_id = ?",
                    (run_id,),
                ).fetchone()
            else:
                row = self._conn.execute(
                    "SELECT COALESCE(SUM(tokens), 0) AS total FROM token_ledger"
                ).fetchone()
            return int(row["total"]) if row else 0

    def compute_backoff_seconds(
        self,
        retry_index: int,
        *,
        retry_after_header: str | None = None,
    ) -> float:
        """Compute bounded jittered exponential backoff for HTTP 429/5xx retries."""
        if retry_after_header is not None:
            try:
                parsed = float(retry_after_header.strip())
                if parsed > 0.0:
                    return min(parsed, self.config.max_backoff_seconds)
            except ValueError:
                pass
        raw = self.config.base_backoff_seconds * (2.0**retry_index)
        capped = min(raw, self.config.max_backoff_seconds)
        jitter = 0.5 + 0.5 * self._rng.random()
        return max(0.01, min(capped, capped * jitter))

    def sleep(self, seconds: float) -> None:
        self._sleeper(seconds)
