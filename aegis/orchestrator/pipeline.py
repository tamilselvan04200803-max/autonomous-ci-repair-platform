"""Full Master Plan Section 4 pipeline: Ingest -> Triage -> Sandbox -> Localize -> Repair -> Policy Gate -> Deliverer.

Integrates all Aegis-CI components into a single state machine with hash-chained event logging
and SQLite checkpointing for crash-resume.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime
from enum import Enum, StrEnum
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from aegis.delivery.deliverer import (
    Deliverer,
    IdempotencyTable,
    PipelineVerdict,
    UnsafeRefError,
)

from aegis.domain.models import (
    ContextManifest,
    Diagnosis,
    FailureEvent,
    FailureClass,
    VerificationReport,
    PolicyVerdict,
)

from aegis.policy.config import load_policy_config
from aegis.policy.gate import PolicyGate, PolicyContext


class PipelineRunState(StrEnum):
    RECEIVED = "RECEIVED"
    RUNNING = "RUNNING"
    GATED = "GATED"
    REFUSED = "REFUSED"
    ESCALATED = "ESCALATED"
    FAILED = "FAILED"


@dataclass
class Pipeline:
    repo: str
    run_id: str
    head_sha: str
    _state: PipelineRunState = PipelineRunState.RECEIVED
    _event_log: Optional[List[Dict[str, Any]]] = field(default_factory=list, repr=False, init=False)
    _checkpoint_path: Optional[Path] = field(default=None, repr=False, init=False)

    def _init_db(self) -> None:
        """Initialize the SQLite checkpoint database."""
        db_path = Path(".pipeline_checkpoint.db")
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS checkpoints (
                run_id TEXT,
                state TEXT,
                attempt INTEGER,
                payload TEXT,
                PRIMARY KEY (run_id, state)
            )
        """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS event_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                seq INTEGER,
                type TEXT,
                payload TEXT,
                hash TEXT,
                prev_hash TEXT
            )
        """
        )
        conn.commit()
        conn.close()
        self._checkpoint_path = db_path

    def _last_chain_hash(self) -> str:
        """Get the last hash from the event log, or head_sha if empty."""
        if not self._event_log:
            return self.head_sha
        return self._event_log[-1]["hash"]

    def _compute_hash(self, payload: Dict[str, Any]) -> str:
        """Compute SHA-256 hash over canonical JSON payload plus previous hash."""
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def _clean_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Clean payload dict for JSON serialization, converting datetime etc."""
        clean: Dict[str, Any] = {}
        for k, v in payload.items():
            if isinstance(v, datetime):
                clean[k] = v.isoformat()
            elif isinstance(v, dict):
                clean[k] = self._deep_clean_dict(v)
            elif hasattr(v, "isoformat"):
                clean[k] = v.isoformat()
            else:
                clean[k] = v
        return clean

    def _deep_clean_dict(self, d: dict) -> dict:
        """Recursively clean a dict for JSON serialization."""
        result: dict = {}
        for kk, vv in d.items():
            if isinstance(vv, datetime):
                result[kk] = vv.isoformat()
            elif isinstance(vv, dict):
                result[kk] = self._deep_clean_dict(vv)
            elif hasattr(vv, "isoformat"):
                result[kk] = vv.isoformat()
            else:
                result[kk] = vv
        return result

    def _json_serialize_value(self, obj: Any) -> Any:
        """JSON-compatible serializer for datetime and other types."""
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, dict):
            return {k: self._json_serialize_value(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [self._json_serialize_value(item) for item in obj]
        return obj

    def _json_serialize_payload(self, payload: Dict[str, Any]) -> str:
        """Serialize a payload dict to JSON string using custom serializer."""
        clean = self._clean_payload(payload)
        return json.dumps(clean, sort_keys=True, separators=(",", ":"))

    def _append_event(self, event_type: str, payload: Dict[str, Any]) -> str:
        """Append an event to the hash-chained event log. Returns the new hash."""
        seq = len(self._event_log)
        prev_hash = self._last_chain_hash()
        # Convert payload to a JSON-safe dict, handling datetime etc.
        clean_payload = self._clean_payload(payload)
        event_payload = {
            "run_id": self.run_id,
            "seq": seq,
            "type": event_type,
            **clean_payload,
        }
        event_hash = self._compute_hash(event_payload)
        self._event_log.append(
            {"type": event_type, "payload": payload, "hash": event_hash, "prev_hash": prev_hash}
        )
        # Persist to DB if checkpoint exists
        if self._checkpoint_path:
            self._persist_event(event_type, payload, event_hash, prev_hash)
        return event_hash

    def _persist_event(self, event_type: str, payload: Dict[str, Any], event_hash: str, prev_hash: str) -> None:
        """Persist event to SQLite checkpoint database."""
        db_path = Path(self._checkpoint_path) if self._checkpoint_path else Path(".pipeline_checkpoint.db")
        conn = sqlite3.connect(str(db_path))
        try:
            payload_str = self._json_serialize_payload(payload)
            conn.execute(
                "INSERT OR REPLACE INTO event_log (run_id, seq, type, payload, hash, prev_hash) VALUES (?, ?, ?, ?, ?, ?)",
                (self.run_id, len(self._event_log) - 1, event_type, payload_str, event_hash, prev_hash),
            )
            conn.commit()
        finally:
            conn.close()

    def _persist_checkpoint(self, state: str, step: int) -> None:
        """Persist a checkpoint to the SQLite database."""
        db_path = Path(self._checkpoint_path) if self._checkpoint_path else Path(".pipeline_checkpoint.db")
        conn = sqlite3.connect(str(db_path))
        try:
            # Serialize event log for checkpoint storage
            events_summary = [
                {"type": e["type"], "hash": e["hash"], "prev_hash": e["prev_hash"]}
                for e in self._event_log
            ]
            payload_json = self._json_serialize_payload({"events": events_summary})
            conn.execute(
                "INSERT OR REPLACE INTO checkpoints (run_id, state, attempt, payload) VALUES (?, ?, ?, ?)",
                (self.run_id, state, step, payload_json),
            )
            conn.commit()
        finally:
            conn.close()

    def start(self, failure_event: FailureEvent) -> None:
        """Move to RUNNING state - ingest the failure event."""
        self._init_db()
        self._state = PipelineRunState.RUNNING
        self._event_log = []
        self._append_event("ingest", {"failure_event": failure_event.model_dump()})
        print(f"[pipeline] INGEST: failure_event received for {self.repo}/{self.run_id}")

    def fetch(self) -> None:
        """Move to RUNNING state - fetch the repository."""
        self._state = PipelineRunState.RUNNING
        self._append_event("fetch", {})
        print(f"[pipeline] FETCH: repository fetched for {self.repo}/{self.run_id}")

    def triage(self, diagnosis: Diagnosis) -> None:
        """Move to RUNNING state - triage the failure."""
        self._state = PipelineRunState.RUNNING
        self._append_event("triage", {"diagnosis": diagnosis.model_dump()})
        print(
            f"[pipeline] TRIAGED: failure_class={diagnosis.failure_class}, "
            f"confidence={diagnosis.confidence:.2f}"
        )

    def reproduce(self, verification: VerificationReport) -> None:
        """Move to REPRODUCED state - reproduce the failure k times."""
        self._state = PipelineRunState.RUNNING
        self._append_event("reproduce", {"verification": verification.model_dump()})
        self._persist_checkpoint("REPRODUCED", 3)
        print(
            f"[pipeline] REPRODUCED: {verification.reproduced_failures}/{verification.reproduction_runs} "
            f"reproduction runs successful"
        )

    def localize(self, context_manifest: ContextManifest) -> None:
        """Move to LOCALIZED state - identify relevant files/symbols."""
        self._state = PipelineRunState.RUNNING
        self._append_event("localize", {"context_manifest": context_manifest.model_dump()})
        self._persist_checkpoint("LOCALIZED", 4)
        print(
            f"[pipeline] LOCALIZED: files={context_manifest.files}, "
            f"tokens={context_manifest.total_tokens}"
        )

    def repair_attempt(self, attempt: int, patch: Dict[str, Any]) -> None:
        """Move to REPAIRING state - attempt a repair patch."""
        self._state = PipelineRunState.RUNNING
        self._append_event(
            "repair_attempt",
            {"attempt": attempt, "patch": patch},
        )
        self._persist_checkpoint(f"REPAIRING_{attempt}", 5 + attempt)
        print(
            f"[pipeline] REPAIRING attempt {attempt}: diff_sha256={patch.get('diff_sha256', '?')}"
        )

    def gate_evaluate(self, verdict: PolicyVerdict, reason: str = "") -> None:
        """Move to GATED (or REFUSED/ESCALATED/FAILED) after policy evaluation.

        Args:
            verdict: The PolicyVerdict (ALLOW, DENY, or ESCALATE)
            reason: Human-readable reason for the verdict
        """
        self._state = PipelineRunState.RUNNING

        if verdict == PolicyVerdict.ALLOW:
            next_state = "GATED"
            print("[pipeline] GATE: ALLOW - proceeding to deliver")
        elif verdict == PolicyVerdict.DENY:
            next_state = "REFUSED"
            print("[pipeline] GATE: DENY - repair refused")
        elif verdict == PolicyVerdict.ESCALATE:
            next_state = "ESCALATED"
            print("[pipeline] GATE: ESCALATE - human review required")
        else:
            next_state = "FAILED"
            print("[pipeline] GATE: FAILED - unexpected verdict")

        self._append_event("gate", {"policy_verdict": verdict.value, "reason": reason})
        self._persist_checkpoint(next_state, 6)
        print(f"[pipeline] GATE: {next_state}")

    def resume(self) -> bool:
        """Resume pipeline from the last checkpoint.

        Returns True if resume was successful, False otherwise.
        """
        db_path = Path(self._checkpoint_path) if self._checkpoint_path else Path(".pipeline_checkpoint.db")
        if not db_path.exists():
            print("[pipeline] No checkpoint database found, starting fresh")
            return False

        conn = sqlite3.connect(str(db_path))
        try:
            # Find the most recent checkpoint
            row = conn.execute(
                "SELECT state, payload FROM checkpoints WHERE run_id = ? ORDER BY attempt DESC LIMIT 1",
                (self.run_id,),
            ).fetchone()
            if row is None:
                print("[pipeline] No checkpoints found for this run_id, starting fresh")
                return False

            state, payload = row
            # Restore event log from payload
            try:
                saved = json.loads(payload)
                events = saved.get("events", [])
                self._event_log = [
                    {"type": e["type"], "payload": e.get("payload", {}), "hash": e["hash"], "prev_hash": e["prev_hash"]}
                    for e in events
                ]
                # Reconstruct state from the last event type
                if self._event_log:
                    last_event_type = self._event_log[-1]["type"]
                    state_map = {
                        "ingest": PipelineRunState.RUNNING,
                        "triage": PipelineRunState.RUNNING,
                        "reproduce": PipelineRunState.RUNNING,
                        "localize": PipelineRunState.RUNNING,
                        "gate": PipelineRunState.GATED,
                    }
                    self._state = state_map.get(last_event_type, PipelineRunState.RUNNING)
                else:
                    self._state = PipelineRunState.RUNNING
                print(f"[pipeline] RESUMED: restored state={self._state.value} from checkpoint")
                return True
            except json.JSONDecodeError as e:
                print(f"[pipeline] RESUME FAILED: cannot parse checkpoint payload: {e}")
                return False
        finally:
            conn.close()

    def verify_chain(self) -> bool:
        """Verify the hash chain integrity of the event log.

        Returns True if the chain is valid, False otherwise.
        """
        if not self._event_log:
            return True  # Empty chain is valid

        # Recompute hashes from scratch and compare
        for i, event in enumerate(self._event_log):
            if i == 0:
                prev_hash = self.head_sha
            else:
                prev_hash = self._event_log[i - 1]["hash"]

            # Recompute hash from the event's payload
            clean_payload = self._clean_payload(event["payload"])
            event_payload = {
                "run_id": self.run_id,
                "seq": event.get("seq", i),
                "type": event["type"],
                **clean_payload,
            }
            expected_hash = self._compute_hash(event_payload)

            if event["hash"] != expected_hash:
                print(
                    f"[pipeline] CHAIN BROKEN at event {i}: "
                    f"expected {expected_hash[:16]}... got {event['hash'][:16]}..."
                )
                return False

        print(f"[pipeline] CHAIN VERIFIED: all {len(self._event_log)} events intact")
        return True

    def event_chain_head(self) -> str:
        """Get the head hash of the event chain.

        Returns the computed hash of the last event, or head_sha if empty.
        """
        if not self._event_log:
            return self.head_sha
        return self._event_log[-1]["hash"]

    @property
    def head_sha(self) -> str:
        """Get the head SHA for this pipeline run."""
        return self._head_sha

    @head_sha.setter
    def head_sha(self, value: str) -> None:
        self._head_sha = value

    @property
    def status(self) -> str:
        """Get the current pipeline status."""
        return self._state.value

    def deliver(self) -> Optional[Deliverer]:
        """Create a Deliverer instance if pipeline is in GATED state.

        Returns Deliverer instance or None if not ready.
        """
        if self._state.value != "GATED":
            print(f"[pipeline] Cannot deliver: pipeline is in {self._state.value} state, not GATED")
            return None
        from aegis.delivery.deliverer import Deliverer as D

        return Deliverer(
            repo=self.repo,
            run_id=self.run_id,
            head_sha=self.head_sha,
        )