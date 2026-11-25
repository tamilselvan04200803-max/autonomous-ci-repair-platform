"""Self-contained local end-to-end Aegis-CI demo and tamper-evidence verification.

Exercises:
1. Hash-chained EventLogStore lifecycle (ingest -> triage -> localize -> verify -> gate).
2. PolicyGate P1..P8 evaluation on a clean patch -> ALLOW.
3. Tampering detection: flipping a single byte in the SQLite event payload fails verify_chain().
"""

from __future__ import annotations

import hashlib
import sqlite3
import tempfile
from pathlib import Path

from aegis.delivery.deliverer import Deliverer, DeliverySpec, PipelineVerdict
from aegis.domain.models import (
    ContextManifest,
    Diagnosis,
    FailureClass,
    FailureEvent,
    Patch,
    PolicyVerdict,
    VerificationReport,
)
from aegis.ledger.store import EventLogStore
from aegis.policy.config import load_policy_config
from aegis.policy.gate import PolicyContext, PolicyGate

ROOT = Path(__file__).resolve().parent.parent


def run_demo() -> int:
    diff_text = (
        "--- a/pkg/calc.py\n"
        "+++ b/pkg/calc.py\n"
        "@@ -1,2 +1,2 @@\n"
        " def add(a: int, b: int) -> int:\n"
        "-    return a - b\n"
        "+    return a + b\n"
    )
    pre_src = "def add(a: int, b: int) -> int:\n    return a - b\n"
    post_src = "def add(a: int, b: int) -> int:\n    return a + b\n"

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        tmp_path = Path(tmp)
        repo_dir = tmp_path / "repo"
        (repo_dir / "pkg").mkdir(parents=True)
        (repo_dir / "pkg" / "calc.py").write_text(post_src, encoding="utf-8")

        db_path = tmp_path / "ledger.db"
        store = EventLogStore(db_path)

        event = FailureEvent(
            run_id="demo-e2e-1",
            repo="org/demo",
            workflow_run_id=101,
            run_attempt=1,
            head_sha="a" * 64,
            base_branch="main",
            delivery_id="deliv-demo-1",
            actor="dev-user",
            workflow_name="CI",
        )
        diag = Diagnosis(
            failure_class=FailureClass.F1_TEST_REGRESSION,
            parser="pytest",
            failing_command="pytest -q",
            error_summary="assert add(2, 3) == 5 failed (got -1)",
            error_files=("pkg/calc.py",),
            confidence=0.96,
        )
        manifest = ContextManifest(
            method="B1",
            files=("pkg/calc.py",),
            token_counts={"pkg/calc.py": 18},
            total_tokens=18,
            symbols=("pkg.calc.add",),
        )
        patch = Patch(
            attempt=1,
            unified_diff=diff_text,
            diff_sha256=hashlib.sha256(diff_text.encode("utf-8")).hexdigest(),
            changed_files=("pkg/calc.py",),
            added_lines=1,
            deleted_lines=1,
            rationale="Fix subtraction typo in add()",
        )
        ver = VerificationReport(
            reproduction_runs=2,
            reproduced_failures=2,
            passed_after_patch=True,
            exit_codes_before=(1, 1),
            exit_codes_after=(0, 0),
            lint_clean=True,
            typecheck_clean=True,
            network_disabled=True,
            read_only_rootfs=True,
        )

        store.init_run(event.run_id, meta=event.model_dump(mode="json"))
        store.append_event(event.run_id, "triage", diag.model_dump(mode="json"))
        store.append_event(event.run_id, "localize", manifest.model_dump(mode="json"))
        store.append_event(event.run_id, "verify", ver.model_dump(mode="json"))

        gate = PolicyGate(load_policy_config(ROOT / "config" / "policy.yaml"))
        gate_res = gate.evaluate(
            PolicyContext(
                repo_root=repo_dir,
                event=event,
                diagnosis=diag,
                patch=patch,
                verification=ver,
                post_patch_sources={"pkg/calc.py": post_src},
                pre_patch_sources={"pkg/calc.py": pre_src},
            )
        )
        if gate_res.verdict != PolicyVerdict.ALLOW:
            raise AssertionError(f"Expected ALLOW, got {gate_res.verdict}")

        head_hash = store.append_event(
            event.run_id,
            "gate",
            {"verdict": gate_res.verdict.value, "rules": len(gate_res.decisions)},
        ).hash

        if not store.verify_chain(event.run_id).valid:
            raise AssertionError("verify_chain() failed on untampered ledger")

        deliverer = Deliverer(repo=event.repo, run_id=event.run_id, head_sha=event.head_sha)
        pr_body = deliverer.draft_pr_body(
            DeliverySpec(
                repo=event.repo,
                run_id=event.run_id,
                run_attempt=event.run_attempt,
                head_sha=event.head_sha,
                verdict=PipelineVerdict.ALLOW,
                failure_class=diag.failure_class.value,
                root_cause=diag.error_summary,
                diff_summary="1 file changed (+1/-1)",
                verification_table="2/2 reproduced, passed after patch",
                policy_table="P1-P8 ALLOW",
                token_cost=0.0,
                chain_head_hash=head_hash,
            )
        )
        assert head_hash in pr_body

        store.close()

        # Tamper test: mutate 1 row in SQLite and verify verify_chain() fails
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "UPDATE events SET payload_json = replace(payload_json, 'pytest', 'tamper') "
            "WHERE run_id = ? AND seq = 1",
            (event.run_id,),
        )
        conn.commit()
        conn.close()

        with EventLogStore(db_path) as verify_store:
            if verify_store.verify_chain(event.run_id).valid:
                raise AssertionError("Tampered ledger unexpectedly passed verify_chain()!")

    print("[DEMO-E2E OK] Pipeline gated ALLOW, PR body verified, and tamper detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_demo())
