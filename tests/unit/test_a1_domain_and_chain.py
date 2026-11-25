"""Milestone A1 TDD tests: Domain models, SHA-256 hash-chained SQLite log, and crash resume."""

from __future__ import annotations

import sqlite3
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from aegis.domain.models import (
    ContextManifest,
    Diagnosis,
    EvidenceBundle,
    FailureClass,
    FailureEvent,
    LLMCallRecord,
    Patch,
    PolicyDecision,
    PolicyVerdict,
    RunState,
    SearchReplaceEdit,
    ToolVersions,
    VerificationReport,
)
from aegis.ledger.store import ChainVerificationError, EventLogStore, export_bundle_json
from pydantic import ValidationError


@pytest.mark.unit
def test_domain_models_frozen_and_roundtrip_json() -> None:
    now = datetime(2026, 11, 25, 12, 0, 0, tzinfo=UTC)
    failure = FailureEvent(
        run_id="run-001",
        repo="owner/repo",
        workflow_run_id=12345,
        run_attempt=1,
        head_sha="a" * 40,
        base_branch="main",
        delivery_id="deliv-1",
        received_at=now,
    )
    with pytest.raises(ValidationError):
        failure.run_id = "tampered"  # type: ignore[misc]

    diagnosis = Diagnosis(
        failure_class=FailureClass.F1_TEST_REGRESSION,
        parser="pytest",
        failing_command="pytest -v",
        error_summary="AssertionError in test_add",
        failing_test_ids=("tests/test_math.py::test_add",),
        confidence=0.95,
    )
    context = ContextManifest(
        method="traceback_grep_B1",
        files=("src/math_ops.py", "tests/test_math.py"),
        token_counts={"src/math_ops.py": 120, "tests/test_math.py": 80},
        total_tokens=200,
    )
    patch = Patch(
        attempt=1,
        edits=(SearchReplaceEdit(path="src/math_ops.py", search="a - b", replace="a + b"),),
        unified_diff="--- a/src/math_ops.py\n+++ b/src/math_ops.py\n@@ -1 +1 @@\n-a - b\n+a + b\n",
        diff_sha256="b" * 64,
        changed_files=("src/math_ops.py",),
        added_lines=1,
        deleted_lines=1,
    )
    verification = VerificationReport(
        reproduction_runs=3,
        reproduced_failures=3,
        junit_xml_sha256="c" * 64,
        passed_after_patch=True,
        exit_codes_before=(1, 1, 1),
        exit_codes_after=(0, 0, 0),
        lint_clean=True,
        typecheck_clean=True,
    )
    decisions = (
        PolicyDecision(
            rule_id="P1",
            verdict=PolicyVerdict.ALLOW,
            reason="All edited paths allowed",
            details=(),
        ),
    )
    llm_call = LLMCallRecord(
        attempt=1,
        model_id="gpt-4o-mini",
        parameter_hash="d" * 64,
        prompt_tokens=150,
        completion_tokens=40,
        prompt_sha256="e" * 64,
        response_sha256="f" * 64,
        cached_replay=True,
    )
    tools = ToolVersions(
        image_digest="sha256:" + "1" * 64,
        python_version="3.11.17",
        lockfile_sha256="2" * 64,
        aegis_version="0.1.0",
    )
    bundle = EvidenceBundle(
        run_id="run-001",
        repo="owner/repo",
        head_sha="a" * 40,
        verdict="DELIVERED",
        failure_event=failure,
        diagnosis=diagnosis,
        reproduction=verification,
        context_manifest=context,
        llm_calls=(llm_call,),
        attempts=(patch,),
        attempt_verifications=(verification,),
        policy_decisions=decisions,
        final_diff_sha256=patch.diff_sha256,
        tool_versions=tools,
        chain_head_hash="3" * 64,
    )
    restored = EvidenceBundle.model_validate_json(bundle.model_dump_json())
    assert restored == bundle


@pytest.mark.unit
def test_hash_chain_verify_and_flipping_any_byte_fails(tmp_path: Path) -> None:
    db_path = tmp_path / "aegis.db"
    with EventLogStore(db_path) as store:
        store.init_run("run-tamper", state=RunState.RECEIVED, meta={"repo": "o/r"})
        e1 = store.append_event("run-tamper", "RECEIVED", {"delivery": "d1"})
        e2 = store.append_event("run-tamper", "TRIAGED", {"class": "F1"})
        e3 = store.append_event("run-tamper", "REPRODUCED", {"exit_code": 1})
        assert e1.seq == 1
        assert e2.seq == 2
        assert e2.prev_hash == e1.hash
        assert e3.prev_hash == e2.hash
        result = store.verify_chain("run-tamper")
        assert result.valid is True
        assert result.head_hash == e3.hash
        assert result.event_count == 3

    # Flip 1 byte in each column across different events on separate copies or rollback
    columns = ("payload_json", "type", "ts", "prev_hash", "hash")
    for seq_target in (1, 2, 3):
        for col in columns:
            conn = sqlite3.connect(db_path)
            orig = conn.execute(
                f"SELECT {col} FROM events WHERE run_id = ? AND seq = ?",
                ("run-tamper", seq_target),
            ).fetchone()[0]
            flipped = ("X" if orig[0] != "X" else "Y") + orig[1:]
            with conn:
                conn.execute(
                    f"UPDATE events SET {col} = ? WHERE run_id = ? AND seq = ?",
                    (flipped, "run-tamper", seq_target),
                )
            conn.close()
            try:
                with EventLogStore(db_path) as store, pytest.raises(ChainVerificationError):
                    store.verify_chain("run-tamper", raise_on_error=True)
                with EventLogStore(db_path) as store:
                    bad_res = store.verify_chain("run-tamper", raise_on_error=False)
                    assert bad_res.valid is False
            finally:
                # Restore original byte
                conn = sqlite3.connect(db_path)
                with conn:
                    conn.execute(
                        f"UPDATE events SET {col} = ? WHERE run_id = ? AND seq = ?",
                        (orig, "run-tamper", seq_target),
                    )
                conn.close()


@pytest.mark.unit
def test_crash_kill_mid_run_resumes_from_last_checkpoint(tmp_path: Path) -> None:
    db_path = tmp_path / "resume.db"
    marker_file = tmp_path / "checkpointed.flag"
    repo_root = Path(__file__).resolve().parents[2]
    worker_code = f"""
import sys, time
from pathlib import Path
from aegis.domain.models import RunState
from aegis.ledger.store import EventLogStore

db = Path({str(db_path)!r})
marker = Path({str(marker_file)!r})
with EventLogStore(db) as store:
    store.init_run("run-crash", state=RunState.RECEIVED, meta={{"repo": "o/r"}})
    store.append_event("run-crash", "RECEIVED", {{"step": 1}}, new_state=RunState.RECEIVED)
    store.append_event("run-crash", "FETCHED", {{"step": 2}}, new_state=RunState.FETCHED)
    store.append_event("run-crash", "TRIAGED", {{"step": 3}}, new_state=RunState.TRIAGED)
    store.save_checkpoint("run-crash", RunState.LOCALIZED, {{"cursor": "hop-1"}})
marker.write_text("ready", encoding="utf-8")
while True:
    time.sleep(0.2)
"""
    proc = subprocess.Popen(
        [sys.executable, "-B", "-c", worker_code],
        cwd=str(repo_root),
    )
    try:
        deadline = time.monotonic() + 10.0
        while not marker_file.exists():
            assert time.monotonic() < deadline, "Worker failed to reach checkpoint"
            time.sleep(0.05)
        proc.kill()
        proc.wait(timeout=5)
    finally:
        if proc.poll() is None:
            proc.kill()

    with EventLogStore(db_path) as store:
        cp = store.get_checkpoint("run-crash")
        assert cp is not None
        assert cp.state == RunState.LOCALIZED
        assert cp.checkpoint_data == {"cursor": "hop-1"}
        chain = store.verify_chain("run-crash")
        assert chain.valid is True
        assert chain.event_count == 3
        e4 = store.append_event(
            "run-crash",
            "REPAIRING",
            {"attempt": 1},
            new_state=RunState.REPAIRING,
        )
        assert e4.seq == 4
        assert store.verify_chain("run-crash").valid is True


@pytest.mark.unit
def test_aegis_imports_agentsentinel_unidirectional() -> None:
    from pathlib import Path

    import agentsentinel  # noqa: F401

    kernel_src = Path(agentsentinel.__file__).resolve().parent
    for py_file in kernel_src.rglob("*.py"):
        text = py_file.read_text(encoding="utf-8")
        assert "import aegis" not in text and "from aegis" not in text


@pytest.mark.unit
def test_seq_gap_and_export_bundle_json(tmp_path: Path) -> None:
    db_path = tmp_path / "gap.db"
    with EventLogStore(db_path) as store:
        store.init_run("run-gap", state=RunState.RECEIVED)
        store.append_event("run-gap", "E1", {"a": 1})
        e2 = store.append_event("run-gap", "E2", {"a": 2})
        store.append_event("run-gap", "E3", {"a": 3})

    conn = sqlite3.connect(db_path)
    with conn:
        conn.execute("DELETE FROM events WHERE run_id = ? AND seq = 2", ("run-gap",))
    conn.close()

    with EventLogStore(db_path) as store:
        res = store.verify_chain("run-gap", raise_on_error=False)
        assert res.valid is False
        assert res.error is not None and "Sequence" in res.error

    now = datetime(2026, 11, 25, 12, 0, 0, tzinfo=UTC)
    bundle = EvidenceBundle(
        run_id="run-gap",
        repo="owner/repo",
        head_sha="a" * 40,
        verdict="DELIVERED",
        failure_event=FailureEvent(
            run_id="run-gap",
            repo="owner/repo",
            workflow_run_id=10,
            head_sha="a" * 40,
            base_branch="main",
            delivery_id="d-gap",
            received_at=now,
        ),
        diagnosis=Diagnosis(
            failure_class=FailureClass.F1_TEST_REGRESSION,
            parser="pytest",
            error_summary="fail",
            confidence=0.9,
        ),
        tool_versions=ToolVersions(
            image_digest="sha256:" + "0" * 64,
            python_version="3.13.7",
            lockfile_sha256="1" * 64,
        ),
        chain_head_hash=e2.hash,
    )
    out = tmp_path / "out" / "bundle.json"
    text = export_bundle_json(bundle, out)
    assert out.exists()
    assert EvidenceBundle.model_validate_json(text) == bundle
