"""Deterministic record/replay LLM cassette store keyed by canonical SHA-256."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from agentsentinel.cli.provenance import canonicalize_jcs
from pydantic import BaseModel, ConfigDict

if TYPE_CHECKING:
    from collections.abc import Sequence


class CassetteMissError(KeyError):
    """Raised in offline replay mode when no recorded response matches the prompt key."""


class CassetteEntry(BaseModel):
    """Serialized immutable LLM record/replay entry."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    key: str
    model_id: str
    parameter_hash: str
    prompt_sha256: str
    response_sha256: str
    raw_content: str
    prompt_tokens: int
    completion_tokens: int
    recorded_at: str


def _sha256_canonical(payload: object) -> str:
    return hashlib.sha256(canonicalize_jcs(payload)).hexdigest()


def hash_params(params: dict[str, Any]) -> str:
    return _sha256_canonical(params)


def hash_messages(messages: Sequence[dict[str, str]]) -> str:
    return _sha256_canonical(list(messages))


def compute_cassette_key(
    model_id: str,
    params: dict[str, Any],
    messages: Sequence[dict[str, str]],
) -> str:
    """Compute canonical SHA-256 key from model, canonical parameters, and messages."""
    envelope = {
        "model_id": model_id,
        "params": params,
        "messages": list(messages),
    }
    return hashlib.sha256(canonicalize_jcs(envelope)).hexdigest()


class CassetteStore:
    """Filesystem JSON cassette directory for zero-cost deterministic replay."""

    def __init__(self, cassette_dir: str | Path) -> None:
        self.cassette_dir = Path(cassette_dir)
        self.cassette_dir.mkdir(parents=True, exist_ok=True)

    def _entry_path(self, key: str) -> Path:
        if not key.isalnum():
            raise ValueError(f"Invalid cassette key: {key!r}")
        return self.cassette_dir / f"{key}.json"

    def lookup(self, key: str) -> CassetteEntry | None:
        path = self._entry_path(key)
        if not path.is_file():
            return None
        return CassetteEntry.model_validate_json(path.read_text(encoding="utf-8"))

    def record(
        self,
        *,
        key: str,
        model_id: str,
        params: dict[str, Any],
        messages: Sequence[dict[str, str]],
        raw_content: str,
        prompt_tokens: int,
        completion_tokens: int,
    ) -> CassetteEntry:
        entry = CassetteEntry(
            key=key,
            model_id=model_id,
            parameter_hash=hash_params(params),
            prompt_sha256=hash_messages(messages),
            response_sha256=hashlib.sha256(raw_content.encode("utf-8")).hexdigest(),
            raw_content=raw_content,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            recorded_at=datetime.now(UTC).isoformat(),
        )
        path = self._entry_path(key)
        encoded = json.dumps(entry.model_dump(mode="json"), indent=2, sort_keys=True) + "\n"
        path.write_text(encoded, encoding="utf-8")
        return entry
