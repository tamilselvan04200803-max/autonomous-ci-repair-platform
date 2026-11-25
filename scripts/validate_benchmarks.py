"""Mechanically validate Tier A (>=40) and Adversarial (>=12) benchmark suites.

Enforces Master Plan Section 7.1 & 7.2:
- Base repo fails visible_ci.sh (or exhibits flaky mixed pass/fail for F5).
- Oracle patch passes visible_ci.sh + hidden_tests/ + PolicyGate P1..P8 (0 false denies).
- Cheat patch is blocked by PolicyGate or fails hidden_tests/.
- All 13 adversarial attack patches are blocked by PolicyGate (0/13 attack success).
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml
from aegis.domain.models import (
    Diagnosis,
    FailureClass,
    FailureEvent,
    Patch,
    VerificationReport,
)
from aegis.policy.config import load_policy_config
from aegis.policy.gate import PolicyContext, PolicyGate
from agentsentinel.policy.diff_parser import UnifiedDiffParser

ROOT = Path(__file__).resolve().parent.parent
TIER_A_DIR = ROOT / "benchmarks" / "aegis_ci" / "tier_a"
ADV_DIR = ROOT / "benchmarks" / "aegis_ci" / "adversarial"

_CLASS_MAP: dict[str, FailureClass] = {
    "F1": FailureClass.F1_TEST_REGRESSION,
    "F2": FailureClass.F2_LINT_FORMAT,
    "F3": FailureClass.F3_TYPE_ERROR,
    "F4": FailureClass.F4_DEPENDENCY_DRIFT,
    "F5": FailureClass.F5_FLAKY,
    "UNCLASSIFIED": FailureClass.UNCLASSIFIED,
}


def _run_visible_cmd(repo_dir: Path, visible_cmd: str) -> int:
    parts = visible_cmd.strip().split()
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
    return proc.returncode


def _run_hidden_tests(repo_dir: Path, hidden_dir: Path) -> int:
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


def _apply_patch_to_dir(repo_dir: Path, raw_diff: str) -> tuple[dict[str, str], dict[str, str]]:
    """Apply a unified diff onto repo_dir using UnifiedDiffParser and return (pre, post) maps."""
    parsed = UnifiedDiffParser.parse(raw_diff)
    pre_map: dict[str, str] = {}
    post_map: dict[str, str] = {}
    for fp in parsed.files:
        rel = fp.target_path
        target = repo_dir / rel
        old_lines = (
            target.read_text(encoding="utf-8").splitlines(keepends=True)
            if target.exists()
            else []
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


def _build_patch_model(raw_diff: str, rationale: str) -> Patch:
    try:
        parsed = UnifiedDiffParser.parse(raw_diff)
        changed = tuple(dict.fromkeys(p for fp in parsed.files for p in fp.target_paths))
        added = sum(
            1 for fp in parsed.files for h in fp.hunks for hl in h.lines if hl.origin == "+"
        )
        deleted = sum(
            1 for fp in parsed.files for h in fp.hunks for hl in h.lines if hl.origin == "-"
        )
    except Exception:
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
    failure_class: FailureClass,
    raw_diff: str,
    pre_map: dict[str, str],
    post_map: dict[str, str],
    *,
    base_branch: str = "main",
    actor: str = "dev-user",
) -> str:
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
        failure_class=failure_class,
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
    patch = _build_patch_model(raw_diff, case_id)
    result = gate.evaluate(
        PolicyContext(
            repo_root=repo_dir,
            event=event,
            diagnosis=diag,
            patch=patch,
            verification=ver,
            post_patch_sources=post_map,
            pre_patch_sources=pre_map,
        )
    )
    return result.verdict.value


def validate_all() -> int:
    gate = PolicyGate(load_policy_config(ROOT / "config" / "policy.yaml"))
    errors: list[str] = []

    tier_a_cases = sorted(p for p in TIER_A_DIR.iterdir() if p.is_dir())
    if len(tier_a_cases) < 40:
        errors.append(f"Expected >= 40 Tier A cases, found {len(tier_a_cases)}")

    for cdir in tier_a_cases:
        meta = yaml.safe_load((cdir / "meta.yaml").read_text(encoding="utf-8"))
        cid = meta["id"]
        outcome = meta["expected_outcome"]
        fclass = _CLASS_MAP[meta["failure_class"]]
        visible_cmd = meta["visible_cmd"]

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            base_repo = tmp_path / "base"
            shutil.copytree(cdir / "repo", base_repo)

            if outcome == "REFUSE" and fclass == FailureClass.F5_FLAKY:
                # Reset marker and confirm mixed pass/fail across 3 runs
                marker = Path(tempfile.gettempdir()) / f"aegis_flaky_{cid}.cnt"
                marker.unlink(missing_ok=True)
                codes = [_run_visible_cmd(base_repo, visible_cmd) for _ in range(3)]
                marker.unlink(missing_ok=True)
                if len(set(codes)) < 2:
                    errors.append(f"{cid}: flaky test did not produce mixed pass/fail: {codes}")
                continue

            base_rc = _run_visible_cmd(base_repo, visible_cmd)
            if base_rc == 0:
                errors.append(f"{cid}: base repo unexpectedly passed {visible_cmd}")
                continue

            if outcome != "FIX":
                continue

            # Validate oracle
            oracle_diff = (cdir / "oracle.patch").read_text(encoding="utf-8")
            oracle_repo = tmp_path / "oracle"
            shutil.copytree(cdir / "repo", oracle_repo)
            pre_map, post_map = _apply_patch_to_dir(oracle_repo, oracle_diff)
            verdict = _evaluate_gate(gate, oracle_repo, cid, fclass, oracle_diff, pre_map, post_map)
            if verdict != "ALLOW":
                errors.append(
                    f"{cid}: oracle.patch false-denied/escalated by PolicyGate: {verdict}"
                )
            if _run_visible_cmd(oracle_repo, visible_cmd) != 0:
                errors.append(f"{cid}: oracle.patch failed visible CI ({visible_cmd})")
            if _run_hidden_tests(oracle_repo, cdir / "hidden_tests") != 0:
                errors.append(f"{cid}: oracle.patch failed hidden tests")

            # Validate cheat
            cheat_path = cdir / "cheat.patch"
            cheat_diff = cheat_path.read_text(encoding="utf-8") if cheat_path.exists() else ""
            if cheat_diff.strip():
                cheat_repo = tmp_path / "cheat"
                shutil.copytree(cdir / "repo", cheat_repo)
                c_pre, c_post = _apply_patch_to_dir(cheat_repo, cheat_diff)
                c_verdict = _evaluate_gate(
                    gate, cheat_repo, cid, fclass, cheat_diff, c_pre, c_post
                )
                c_hidden_rc = _run_hidden_tests(cheat_repo, cdir / "hidden_tests")
                if c_verdict == "ALLOW" and c_hidden_rc == 0:
                    errors.append(f"{cid}: cheat.patch escaped BOTH PolicyGate and hidden tests!")

    adv_cases = sorted(p for p in ADV_DIR.iterdir() if p.is_dir())
    if len(adv_cases) < 12:
        errors.append(f"Expected >= 12 adversarial cases, found {len(adv_cases)}")

    for cdir in adv_cases:
        meta = yaml.safe_load((cdir / "meta.yaml").read_text(encoding="utf-8"))
        cid = meta["id"]
        attack_diff = (cdir / "attack.patch").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            adv_repo = Path(tmp) / "adv"
            shutil.copytree(cdir / "repo", adv_repo)
            try:
                pre_map, post_map = _apply_patch_to_dir(adv_repo, attack_diff)
            except Exception:
                pre_map, post_map = {}, {}
            verdict = _evaluate_gate(
                gate,
                adv_repo,
                cid,
                FailureClass.F1_TEST_REGRESSION,
                attack_diff,
                pre_map,
                post_map,
                base_branch=meta.get("base_branch", "main"),
                actor=meta.get("actor", "dev-user"),
            )
            if verdict == "ALLOW":
                errors.append(f"{cid}: adversarial attack was ALLOWED by PolicyGate!")

    if errors:
        for err in errors:
            print(f"[FAIL] {err}", file=sys.stderr)
        return 1

    print(
        f"[BENCH-VALIDATE OK] {len(tier_a_cases)} Tier A cases and "
        f"{len(adv_cases)} Adversarial cases validated mechanically."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(validate_all())
