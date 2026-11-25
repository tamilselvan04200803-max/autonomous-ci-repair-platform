"""Hash-chained SQLite event log and durable run checkpoint store (Milestone A1)."""

from __future__ import annotations

import contextlib
import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agentsentinel.cli.provenance import canonicalize_jcs

from aegis.domain.models import EvidenceBundle, RunState

GENESIS_HASH = "0" * 64

_SCHEMA = """
CREATE TABLE IF NOT EXISTS aegis_runs (
    run_id              TEXT PRIMARY KEY,
    state               TEXT NOT NULL,
    meta_json           TEXT NOT NULL DEFAULT '{}',
    checkpoint_json     TEXT NOT NULL DEFAULT '{}',
    created_at_utc      TEXT NOT NULL,
    updated_at_utc      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    run_id              TEXT NOT NULL,
    seq                 INTEGER NOT NULL,
    ts                  TEXT NOT NULL,
    type                TEXT NOT NULL,
    payload_json        TEXT NOT NULL,
    prev_hash           TEXT NOT NULL,
    hash                TEXT NOT NULL,
    PRIMARY KEY (run_id, seq),
    FOREIGN KEY (run_id) REFERENCES aegis_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(run_id, seq);

CREATE TABLE IF NOT EXISTS deliveries (
    delivery_id         TEXT PRIMARY KEY,
    workflow_run_id     INTEGER,
    status              TEXT NOT NULL,
    received_at_utc     TEXT NOT NULL,
    payload_sha256      TEXT NOT NULL
);
"""


class ChainVerificationError(RuntimeError):
    """Raised when event log hash-chain verification detects tampering or corruption."""


@dataclass(frozen=True)
class EventRecord:
    """In-memory view of one hash-chained event row."""

    run_id: str
    seq: int
    ts: str
    type: str
    payload: dict[str, Any]
    prev_hash: str
    hash: str


@dataclass(frozen=True)
class ChainVerificationResult:
    """Result of verifying an entire run_id hash chain."""

    valid: bool
    event_count: int
    head_hash: str
    error: str | None = None


@dataclass(frozen=True)
class RunCheckpoint:
    """Persisted checkpoint snapshot used to resume after crash/restart."""

    run_id: str
    state: RunState
    meta: dict[str, Any]
    checkpoint_data: dict[str, Any]
    created_at_utc: str
    updated_at_utc: str


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _canonical_bytes(data: object) -> bytes:
    raw: bytes = bytes(canonicalize_jcs(data))
    return raw


def _canonical_json_str(data: object) -> str:
    return _canonical_bytes(data).decode("utf-8")


def compute_event_hash(
    *,
    run_id: str,
    seq: int,
    ts: str,
    event_type: str,
    payload: dict[str, Any],
    prev_hash: str,
) -> str:
    """Compute SHA-256 over prev_hash and canonical JSON envelope of the event."""
    envelope = {
        "prev_hash": prev_hash,
        "run_id": run_id,
        "seq": seq,
        "ts": ts,
        "type": event_type,
        "payload": payload,
    }
    canonical = _canonical_bytes(envelope)
    return hashlib.sha256(prev_hash.encode("ascii") + b":" + canonical).hexdigest()


class EventLogStore:
    """Durable SQLite WAL store maintaining hash-chained events and checkpoints."""

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), isolation_level=None, timeout=15.0)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._conn.execute("PRAGMA foreign_keys=ON;")
        self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self._conn.close()

    def __enter__(self) -> EventLogStore:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def init_run(
        self,
        run_id: str,
        *,
        state: RunState = RunState.RECEIVED,
        meta: dict[str, Any] | None = None,
    ) -> RunCheckpoint:
        now = _now_iso()
        meta_str = _canonical_json_str(meta or {})
        with self._conn:
            existing = self.get_checkpoint(run_id)
            if existing is not None:
                return existing
            self._conn.execute(
                """
                INSERT INTO aegis_runs(
                    run_id, state, meta_json, checkpoint_json, created_at_utc, updated_at_utc
                )
                VALUES (?, ?, ?, '{}', ?, ?)
                """,
                (run_id, state.value, meta_str, now, now),
            )
        cp = self.get_checkpoint(run_id)
        assert cp is not None
        return cp

    def get_checkpoint(self, run_id: str) -> RunCheckpoint | None:
        row = self._conn.execute(
            "SELECT * FROM aegis_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if row is None:
            return None
        return RunCheckpoint(
            run_id=str(row["run_id"]),
            state=RunState(str(row["state"])),
            meta=dict(json.loads(str(row["meta_json"]))),
            checkpoint_data=dict(json.loads(str(row["checkpoint_json"]))),
            created_at_utc=str(row["created_at_utc"]),
            updated_at_utc=str(row["updated_at_utc"]),
        )

    def list_queued_runs(self, state: RunState = RunState.RECEIVED) -> list[RunCheckpoint]:
        """List runs currently awaiting processing at the given state."""
        rows = self._conn.execute(
            "SELECT * FROM aegis_runs WHERE state = ? ORDER BY created_at_utc ASC",
            (state.value,),
        ).fetchall()
        return [
            RunCheckpoint(
                run_id=str(row["run_id"]),
                state=RunState(str(row["state"])),
                meta=dict(json.loads(str(row["meta_json"]))),
                checkpoint_data=dict(json.loads(str(row["checkpoint_json"]))),
                created_at_utc=str(row["created_at_utc"]),
                updated_at_utc=str(row["updated_at_utc"]),
            )
            for row in rows
        ]

    def save_checkpoint(
        self,
        run_id: str,
        state: RunState,
        checkpoint_data: dict[str, Any] | None = None,
    ) -> None:
        now = _now_iso()
        with self._conn:
            if checkpoint_data is None:
                cur = self._conn.execute(
                    "UPDATE aegis_runs SET state = ?, updated_at_utc = ? WHERE run_id = ?",
                    (state.value, now, run_id),
                )
            else:
                cur = self._conn.execute(
                    """
                    UPDATE aegis_runs
                    SET state = ?, checkpoint_json = ?, updated_at_utc = ?
                    WHERE run_id = ?
                    """,
                    (state.value, _canonical_json_str(checkpoint_data), now, run_id),
                )
            if cur.rowcount != 1:
                raise KeyError(f"Unknown run_id {run_id!r}")

    def append_event(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
        *,
        new_state: RunState | None = None,
        checkpoint_data: dict[str, Any] | None = None,
    ) -> EventRecord:
        now = _now_iso()
        payload_str = _canonical_json_str(payload)
        canonical_payload = dict(json.loads(payload_str))
        with self._conn:
            run_row = self._conn.execute(
                "SELECT run_id FROM aegis_runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if run_row is None:
                raise KeyError(f"Run {run_id!r} must be initialized before appending events")

            last = self._conn.execute(
                "SELECT seq, hash FROM events WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
                (run_id,),
            ).fetchone()
            seq = int(last["seq"]) + 1 if last is not None else 1
            prev_hash = str(last["hash"]) if last is not None else GENESIS_HASH
            ev_hash = compute_event_hash(
                run_id=run_id,
                seq=seq,
                ts=now,
                event_type=event_type,
                payload=canonical_payload,
                prev_hash=prev_hash,
            )
            self._conn.execute(
                """
                INSERT INTO events(run_id, seq, ts, type, payload_json, prev_hash, hash)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (run_id, seq, now, event_type, payload_str, prev_hash, ev_hash),
            )
            if new_state is not None or checkpoint_data is not None:
                if checkpoint_data is not None and new_state is not None:
                    self._conn.execute(
                        """
                        UPDATE aegis_runs
                        SET state = ?, checkpoint_json = ?, updated_at_utc = ?
                        WHERE run_id = ?
                        """,
                        (new_state.value, _canonical_json_str(checkpoint_data), now, run_id),
                    )
                elif new_state is not None:
                    self._conn.execute(
                        "UPDATE aegis_runs SET state = ?, updated_at_utc = ? WHERE run_id = ?",
                        (new_state.value, now, run_id),
                    )
                elif checkpoint_data is not None:
                    self._conn.execute(
                        """
                        UPDATE aegis_runs
                        SET checkpoint_json = ?, updated_at_utc = ?
                        WHERE run_id = ?
                        """,
                        (_canonical_json_str(checkpoint_data), now, run_id),
                    )
        return EventRecord(
            run_id=run_id,
            seq=seq,
            ts=now,
            type=event_type,
            payload=canonical_payload,
            prev_hash=prev_hash,
            hash=ev_hash,
        )

    def list_events(self, run_id: str) -> list[EventRecord]:
        rows = self._conn.execute(
            "SELECT * FROM events WHERE run_id = ? ORDER BY seq ASC",
            (run_id,),
        ).fetchall()
        events: list[EventRecord] = []
        for r in rows:
            events.append(
                EventRecord(
                    run_id=str(r["run_id"]),
                    seq=int(r["seq"]),
                    ts=str(r["ts"]),
                    type=str(r["type"]),
                    payload=dict(json.loads(str(r["payload_json"]))),
                    prev_hash=str(r["prev_hash"]),
                    hash=str(r["hash"]),
                )
            )
        return events

    def verify_chain(self, run_id: str, *, raise_on_error: bool = False) -> ChainVerificationResult:
        rows = self._conn.execute(
            "SELECT * FROM events WHERE run_id = ? ORDER BY seq ASC",
            (run_id,),
        ).fetchall()
        expected_prev = GENESIS_HASH
        expected_seq = 1
        head = GENESIS_HASH
        for row in rows:
            seq = int(row["seq"])
            ts = str(row["ts"])
            ev_type = str(row["type"])
            raw_payload = str(row["payload_json"])
            prev_hash = str(row["prev_hash"])
            stored_hash = str(row["hash"])

            if seq != expected_seq:
                msg = f"Sequence gap/mismatch for {run_id}: expected {expected_seq}, got {seq}"
                if raise_on_error:
                    raise ChainVerificationError(msg)
                return ChainVerificationResult(False, len(rows), head, msg)
            if prev_hash != expected_prev:
                msg = f"prev_hash mismatch at seq={seq} for {run_id}"
                if raise_on_error:
                    raise ChainVerificationError(msg)
                return ChainVerificationResult(False, len(rows), head, msg)
            try:
                parsed_payload = json.loads(raw_payload)
                if not isinstance(parsed_payload, dict):
                    raise ValueError("payload_json must be a JSON object")
                canonical_raw = _canonical_json_str(parsed_payload)
            except Exception as exc:
                msg = f"Corrupt payload JSON at seq={seq}: {exc}"
                if raise_on_error:
                    raise ChainVerificationError(msg) from exc
                return ChainVerificationResult(False, len(rows), head, msg)

            if raw_payload != canonical_raw:
                msg = f"Non-canonical/tampered payload_json at seq={seq} for {run_id}"
                if raise_on_error:
                    raise ChainVerificationError(msg)
                return ChainVerificationResult(False, len(rows), head, msg)

            recomputed = compute_event_hash(
                run_id=run_id,
                seq=seq,
                ts=ts,
                event_type=ev_type,
                payload=parsed_payload,
                prev_hash=prev_hash,
            )
            if stored_hash != recomputed:
                msg = f"Hash mismatch at seq={seq} for {run_id}"
                if raise_on_error:
                    raise ChainVerificationError(msg)
                return ChainVerificationResult(False, len(rows), head, msg)

            expected_prev = stored_hash
            head = stored_hash
            expected_seq += 1

        return ChainVerificationResult(True, len(rows), head, None)

    def record_delivery_if_new(
        self, delivery_id: str, workflow_run_id: int | None, status: str, payload_sha256: str
    ) -> bool:
        """Atomically record GitHub delivery ID; returns False if already processed."""
        now = _now_iso()
        with self._conn:
            existing = self._conn.execute(
                "SELECT 1 FROM deliveries WHERE delivery_id = ?",
                (delivery_id,),
            ).fetchone()
            if existing is not None:
                return False
            self._conn.execute(
                """
                INSERT INTO deliveries(
                    delivery_id, workflow_run_id, status, received_at_utc, payload_sha256
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (delivery_id, workflow_run_id, status, now, payload_sha256),
            )
        return True


def export_bundle_json(bundle: EvidenceBundle, output_path: Path | None = None) -> str:
    """Serialize an EvidenceBundle deterministically and optionally write to disk."""
    serialized = bundle.model_dump_json(indent=2)
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(serialized + "\n", encoding="utf-8")
    return serialized
