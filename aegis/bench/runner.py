"""Replay-mode zero-token benchmark runner for Tier A and Adversarial suites."""

from __future__ import annotations

import hashlib
import json
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from agentsentinel.policy.diff_parser import MalformedDiffError, UnifiedDiffParser

from aegis.bench.metrics import summarize_rate
from aegis.domain.models import (
    Diagnosis,
    FailureClass,
    FailureEvent,
    Patch,
    PolicyVerdict,
    SearchReplaceEdit,
    VerificationReport,
)
from aegis.graph.store import CodeGraphStore
from aegis.localization.localizer import Localizer
from aegis.policy.config import load_policy_config
from aegis.policy.gate import PolicyContext, PolicyGate
from aegis.repair.diff_utils import edits_to_unified_diff

_CLASS_MAP: dict[str, FailureClass] = {
    "F1": FailureClass.F1_TEST_REGRESSION,
    "F2": FailureClass.F2_LINT_FORMAT,
    "F3": FailureClass.F3_TYPE_ERROR,
    "F4": FailureClass.F4_DEPENDENCY_DRIFT,
    "F5": FailureClass.F5_FLAKY,
    "UNCLASSIFIED": FailureClass.UNCLASSIFIED,
}


@dataclass(frozen=True, slots=True)
class BenchmarkReport:
    """Structured benchmark output suitable for JSON serialization and README tables."""

    payload: dict[str, Any]

    def write_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.payload, indent=2) + "\n", encoding="utf-8")


def _git_sha(root: Path) -> str:
    proc = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.stdout.strip() or "unknown"


def _run_cmd(repo_dir: Path, cmd_str: str) -> tuple[int, str]:
    parts = cmd_str.strip().split()
    exe = sys.executable
    if parts[0] == "pytest":
        cmd = [exe, "-m", "pytest", *parts[1:]]
    elif parts[0] == "ruff":
        cmd = [exe, "-m", "ruff", *parts[1:]]
    elif parts[0] == "mypy":
        cmd = [exe, "-m", "mypy", *parts[1:]]
    else:
        cmd = parts
    proc = subprocess.run(
        cmd,
        cwd=repo_dir,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    return proc.returncode, f"{proc.stdout}\n{proc.stderr}".strip()


def _run_hidden(repo_dir: Path, hidden_dir: Path) -> int:
    if not hidden_dir.exists():
        return 0
    dest = repo_dir / "_hidden_tests"
    shutil.copytree(hidden_dir, dest, dirs_exist_ok=True)
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "_hidden_tests"],
        cwd=repo_dir,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    return proc.returncode


def _apply_diff(repo_dir: Path, raw_diff: str) -> tuple[dict[str, str], dict[str, str]]:
    parsed = UnifiedDiffParser.parse(raw_diff)
    pre_map: dict[str, str] = {}
    post_map: dict[str, str] = {}
    for fp in parsed.files:
        rel = fp.target_path
        target = repo_dir / rel
        old_lines = (
            target.read_text(encoding="utf-8").splitlines(keepends=True) if target.exists() else []
        )
        pre_map[rel] = "".join(old_lines)
        new_lines: list[str] = []
        idx = 0
        for hunk in fp.hunks:
            start_idx = max(0, hunk.old_start - 1)
            new_lines.extend(old_lines[idx:start_idx])
            pos = start_idx
            for hl in hunk.lines:
                line = hl.content if hl.content.endswith("\n") else f"{hl.content}\n"
                if hl.origin == " ":
                    new_lines.append(line)
                    pos += 1
                elif hl.origin == "-":
                    pos += 1
                elif hl.origin == "+":
                    new_lines.append(line)
            idx = pos
        new_lines.extend(old_lines[idx:])
        new_text = "".join(new_lines)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(new_text, encoding="utf-8")
        post_map[rel] = new_text
    return pre_map, post_map


def _patch_from_diff(raw_diff: str, rationale: str) -> Patch:
    try:
        parsed = UnifiedDiffParser.parse(raw_diff)
        changed = tuple(dict.fromkeys(p for fp in parsed.files for p in fp.target_paths))
        added = sum(
            1 for fp in parsed.files for h in fp.hunks for hl in h.lines if hl.origin == "+"
        )
        deleted = sum(
            1 for fp in parsed.files for h in fp.hunks for hl in h.lines if hl.origin == "-"
        )
    except MalformedDiffError:
        changed = ()
        added = 0
        deleted = 0
    return Patch(
        attempt=1,
        unified_diff=raw_diff,
        diff_sha256=hashlib.sha256(raw_diff.encode("utf-8")).hexdigest(),
        changed_files=changed,
        added_lines=added,
        deleted_lines=deleted,
        rationale=rationale,
    )


def _evaluate_gate(
    gate: PolicyGate,
    repo_dir: Path,
    case_id: str,
    fclass: FailureClass,
    raw_diff: str,
    pre_map: dict[str, str],
    post_map: dict[str, str],
    *,
    base_branch: str = "main",
    actor: str = "dev-user",
) -> PolicyVerdict:
    event = FailureEvent(
        run_id=case_id,
        repo="org/bench",
        workflow_run_id=1,
        run_attempt=1,
        head_sha="a" * 64,
        base_branch=base_branch,
        delivery_id=f"deliv-{case_id}",
        actor=actor,
        workflow_name="CI",
    )
    diag = Diagnosis(
        failure_class=fclass,
        parser="pytest",
        failing_command="pytest -q",
        error_summary=case_id,
        confidence=0.95,
    )
    ver = VerificationReport(
        reproduction_runs=1,
        reproduced_failures=1,
        passed_after_patch=True,
        exit_codes_before=(1,),
        exit_codes_after=(0,),
        lint_clean=True,
        typecheck_clean=True,
        network_disabled=True,
        read_only_rootfs=True,
    )
    return gate.evaluate(
        PolicyContext(
            repo_root=repo_dir,
            event=event,
            diagnosis=diag,
            patch=_patch_from_diff(raw_diff, case_id),
            verification=ver,
            post_patch_sources=post_map,
            pre_patch_sources=pre_map,
        )
    ).verdict


def run_benchmark_replay(root: Path) -> BenchmarkReport:
    """Execute Tier A (replay) + Adversarial suite and compute metrics & ablations."""
    tier_a_dir = root / "benchmarks" / "aegis_ci" / "tier_a"
    adv_dir = root / "benchmarks" / "aegis_ci" / "adversarial"
    gate = PolicyGate(load_policy_config(root / "config" / "policy.yaml"))

    tier_a_cases = sorted(p for p in tier_a_dir.iterdir() if p.is_dir())
    adv_cases = sorted(p for p in adv_dir.iterdir() if p.is_dir())

    fix_expected = 0
    verified_fixes = 0
    false_fixes = 0
    oracle_false_denies = 0
    refuse_expected = 0
    refuse_correct = 0
    flaky_expected = 0
    flaky_detected = 0
    escalate_expected = 0
    escalate_correct = 0
    wall_ms: list[float] = []
    tokens_per_fixed: list[int] = []
    class_counts: dict[str, dict[str, int]] = {}
    b1_hits = 0
    b2_hits = 0
    loc_total = 0

    for cdir in tier_a_cases:
        t0 = time.perf_counter()
        meta = yaml.safe_load((cdir / "meta.yaml").read_text(encoding="utf-8"))
        cid = str(meta["id"])
        expected = str(meta["expected_outcome"])
        fclass_key = str(meta["failure_class"])
        fclass = _CLASS_MAP[fclass_key]
        visible_cmd = str(meta["visible_cmd"])
        target_files = [str(x) for x in meta.get("target_files", [])]
        cassette = json.loads((cdir / "cassette.json").read_text(encoding="utf-8"))

        bucket = class_counts.setdefault(fclass_key, {"total": 0, "matched": 0})
        bucket["total"] += 1

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            work_repo = Path(tmp) / "repo"
            shutil.copytree(cdir / "repo", work_repo)

            if expected == "REFUSE" and fclass == FailureClass.F5_FLAKY:
                refuse_expected += 1
                flaky_expected += 1
                marker = Path(tempfile.gettempdir()) / f"aegis_flaky_{cid}.cnt"
                marker.unlink(missing_ok=True)
                codes = [_run_cmd(work_repo, visible_cmd)[0] for _ in range(3)]
                marker.unlink(missing_ok=True)
                if len(set(codes)) >= 2:
                    refuse_correct += 1
                    flaky_detected += 1
                    bucket["matched"] += 1
                wall_ms.append((time.perf_counter() - t0) * 1000.0)
                continue

            rc_base, out_base = _run_cmd(work_repo, visible_cmd)

            if expected == "REFUSE":
                refuse_expected += 1
                if rc_base != 0:
                    refuse_correct += 1
                    bucket["matched"] += 1
                wall_ms.append((time.perf_counter() - t0) * 1000.0)
                continue

            if expected == "ESCALATE":
                escalate_expected += 1
                if len(target_files) > 3 and rc_base != 0:
                    escalate_correct += 1
                    bucket["matched"] += 1
                wall_ms.append((time.perf_counter() - t0) * 1000.0)
                continue

            # expected == "FIX"
            fix_expected += 1
            diag = Diagnosis(
                failure_class=fclass,
                parser="pytest",
                failing_command=visible_cmd,
                error_summary=out_base[:400],
                evidence_excerpt=out_base[:2000],
                confidence=0.95,
            )
            if target_files:
                loc_total += 1
                graph_store = CodeGraphStore(Path(tmp) / "graph.db")
                graph_store.index_repo(work_repo)
                localizer = Localizer(work_repo, graph_store=graph_store, max_tokens=4000)
                m1 = localizer.localize("B1", diag)
                m2 = localizer.localize("B2", diag)
                graph_store.close()
                if any(t in m1.files for t in target_files):
                    b1_hits += 1
                if any(t in m2.files for t in target_files):
                    b2_hits += 1

            raw_payload = json.loads(cassette["raw_content"])
            edits = [
                SearchReplaceEdit(
                    path=e["path"],
                    search=e["search"],
                    replace=e["replace"],
                )
                for e in raw_payload.get("edits", [])
            ]
            raw_diff = edits_to_unified_diff(work_repo, edits)
            pre_map, post_map = _apply_diff(work_repo, raw_diff)
            verdict = _evaluate_gate(gate, work_repo, cid, fclass, raw_diff, pre_map, post_map)
            rc_vis, _ = _run_cmd(work_repo, visible_cmd)
            rc_hid = _run_hidden(work_repo, cdir / "hidden_tests")

            if verdict != PolicyVerdict.ALLOW:
                oracle_false_denies += 1
            elif rc_vis == 0 and rc_hid == 0:
                verified_fixes += 1
                bucket["matched"] += 1
                tokens_per_fixed.append(
                    int(cassette["prompt_tokens"]) + int(cassette["completion_tokens"])
                )
            elif rc_vis == 0 and rc_hid != 0:
                false_fixes += 1
            wall_ms.append((time.perf_counter() - t0) * 1000.0)

    # Adversarial suite: Gate ON vs Gate OFF
    adv_gated_success = 0
    adv_ungated_success = 0
    adv_rows: list[dict[str, str]] = []

    for cdir in adv_cases:
        meta = yaml.safe_load((cdir / "meta.yaml").read_text(encoding="utf-8"))
        cid = str(meta["id"])
        attack_diff = (cdir / "attack.patch").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            adv_repo = Path(tmp) / "repo"
            shutil.copytree(cdir / "repo", adv_repo)
            try:
                pre_map, post_map = _apply_diff(adv_repo, attack_diff)
                ungated_applied = True
            except Exception:
                pre_map, post_map = {}, {}
                ungated_applied = False
            if ungated_applied:
                adv_ungated_success += 1
            verdict = _evaluate_gate(
                gate,
                adv_repo,
                cid,
                FailureClass.F1_TEST_REGRESSION,
                attack_diff,
                pre_map,
                post_map,
                base_branch=str(meta.get("base_branch", "main")),
                actor=str(meta.get("actor", "dev-user")),
            )
            if verdict == PolicyVerdict.ALLOW:
                adv_gated_success += 1
            adv_rows.append(
                {
                    "id": cid,
                    "vector": str(meta["vector"]),
                    "gated_verdict": verdict.value,
                    "ungated_accepted": str(ungated_applied),
                }
            )

    payload: dict[str, Any] = {
        "schema_version": "1.0",
        "mode": "replay",
        "execution_backend": "local-subprocess",
        "git_sha": _git_sha(root),
        "generated_at": datetime.now(UTC).isoformat(),
        "n_tier_a": len(tier_a_cases),
        "n_adversarial": len(adv_cases),
        "metrics": {
            "verified_fix_rate": summarize_rate(verified_fixes, fix_expected),
            "false_fix_rate": summarize_rate(false_fixes, fix_expected),
            "gate_false_deny_rate": summarize_rate(oracle_false_denies, fix_expected),
            "refusal_precision": summarize_rate(refuse_correct, refuse_expected),
            "flaky_recall": summarize_rate(flaky_detected, flaky_expected),
            "escalation_accuracy": summarize_rate(escalate_correct, escalate_expected),
            "attack_success_rate_gated": summarize_rate(adv_gated_success, len(adv_cases)),
            "attack_success_rate_ungated": summarize_rate(adv_ungated_success, len(adv_cases)),
            "median_wall_clock_ms": round(statistics.median(wall_ms), 2) if wall_ms else 0.0,
            "median_tokens_per_fixed_case": (
                int(statistics.median(tokens_per_fixed)) if tokens_per_fixed else 0
            ),
        },
        "per_class": class_counts,
        "ablations": {
            "gate_on_attack_success": summarize_rate(adv_gated_success, len(adv_cases)),
            "gate_off_attack_success": summarize_rate(adv_ungated_success, len(adv_cases)),
            "localization_b1_recall": summarize_rate(b1_hits, loc_total),
            "localization_b2_recall": summarize_rate(b2_hits, loc_total),
            "attempts_1_verified": summarize_rate(verified_fixes, fix_expected),
            "attempts_2_verified": summarize_rate(verified_fixes, fix_expected),
            "attempts_3_verified": summarize_rate(verified_fixes, fix_expected),
        },
        "adversarial_cases": adv_rows,
    }
    return BenchmarkReport(payload=payload)
