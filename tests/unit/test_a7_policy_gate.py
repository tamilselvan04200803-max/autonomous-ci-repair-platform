"""TDD tests for Milestone A7: YAML-configured Policy Gate (P1..P8).

Every rule P1..P8 has >= 2 ALLOW and >= 2 DENY/ESCALATE fixtures.
"""

from __future__ import annotations

import hashlib
import textwrap
from datetime import UTC, datetime
from pathlib import Path

import pytest
from aegis.domain.models import (
    Diagnosis,
    FailureClass,
    FailureEvent,
    Patch,
    PolicyVerdict,
    VerificationReport,
)
from aegis.policy.config import PolicyConfig, load_policy_config
from aegis.policy.gate import PolicyContext, PolicyGate


def _make_repo(root: Path, files: dict[str, str] | None = None) -> Path:
    defaults = {
        "pkg/__init__.py": "",
        "pkg/calc.py": textwrap.dedent(
            """\
            def add(a: int, b: int) -> int:
                return a - b


            def sub(a: int, b: int) -> int:
                return a - b
            """
        ),
        "tests/__init__.py": "",
        "tests/test_calc.py": textwrap.dedent(
            """\
            from pkg.calc import add


            def test_add() -> None:
                assert add(2, 3) == 5


            def test_add_zero() -> None:
                assert add(0, 4) == 4
            """
        ),
        "requirements.txt": "pytest==8.4.2\n",
        ".github/workflows/ci.yml": "name: ci\non: [push]\n",
        "conftest.py": "import pytest\n",
        "pyproject.toml": "[project]\nname = 'demo'\n",
    }
    if files:
        defaults.update(files)
    for rel, content in defaults.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
    return root


def _make_event(
    *,
    base_branch: str = "main",
    actor: str = "dev-user",
) -> FailureEvent:
    return FailureEvent(
        run_id="run-a7",
        repo="org/demo",
        workflow_run_id=101,
        run_attempt=1,
        head_sha="a" * 40,
        base_branch=base_branch,
        delivery_id="deliv-1",
        actor=actor,
        workflow_name="CI",
        received_at=datetime(2026, 11, 25, tzinfo=UTC),
    )


def _make_diagnosis(
    *,
    failure_class: FailureClass = FailureClass.F1_TEST_REGRESSION,
    confidence: float = 0.92,
) -> Diagnosis:
    return Diagnosis(
        failure_class=failure_class,
        parser="pytest",
        failing_command="pytest",
        error_summary="AssertionError",
        error_files=("pkg/calc.py",),
        confidence=confidence,
    )


def _make_verification(
    *,
    reproduction_runs: int = 1,
    reproduced_failures: int = 1,
    passed_after_patch: bool = True,
    lint_clean: bool = True,
    typecheck_clean: bool = True,
    network_disabled: bool = True,
    read_only_rootfs: bool = True,
) -> VerificationReport:
    return VerificationReport(
        reproduction_runs=reproduction_runs,
        reproduced_failures=reproduced_failures,
        passed_after_patch=passed_after_patch,
        exit_codes_before=(1,),
        exit_codes_after=(0 if passed_after_patch else 1,),
        lint_clean=lint_clean,
        typecheck_clean=typecheck_clean,
        network_disabled=network_disabled,
        read_only_rootfs=read_only_rootfs,
    )


def _make_patch(
    diff: str,
    changed_files: tuple[str, ...],
    *,
    added: int | None = None,
    deleted: int | None = None,
) -> Patch:
    if added is None:
        added = sum(
            1 for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++")
        )
    if deleted is None:
        deleted = sum(
            1 for ln in diff.splitlines() if ln.startswith("-") and not ln.startswith("---")
        )
    return Patch(
        attempt=1,
        unified_diff=diff,
        diff_sha256=hashlib.sha256(diff.encode("utf-8")).hexdigest(),
        changed_files=changed_files,
        added_lines=added,
        deleted_lines=deleted,
        rationale="test patch",
    )


_CLEAN_CALC_DIFF = (
    "--- a/pkg/calc.py\n"
    "+++ b/pkg/calc.py\n"
    "@@ -1,2 +1,2 @@\n"
    " def add(a: int, b: int) -> int:\n"
    "-    return a - b\n"
    "+    return a + b\n"
)


def _gate() -> PolicyGate:
    cfg = load_policy_config(Path("config/policy.yaml"))
    assert isinstance(cfg, PolicyConfig)
    return PolicyGate(cfg)


def test_p1_path_deny_allow_and_deny_fixtures(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")

    # Allow #1: clean production Python file
    clean_calc_src = (
        "def add(a: int, b: int) -> int:\n    return a + b\n\n\n"
        "def sub(a: int, b: int) -> int:\n    return a - b\n"
    )
    res_a1 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(),
            post_patch_sources={"pkg/calc.py": clean_calc_src},
        )
    )
    assert res_a1.verdict == PolicyVerdict.ALLOW

    # Allow #2: requirements.txt permitted for F4 dependency drift
    req_diff = "--- a/requirements.txt\n+++ b/requirements.txt\n@@ -1 +1 @@\n-pytest==8.4.2\n+pytest==8.4.3\n"
    res_a2 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(failure_class=FailureClass.F4_DEPENDENCY_DRIFT),
            patch=_make_patch(req_diff, ("requirements.txt",)),
            verification=_make_verification(),
            post_patch_sources={"requirements.txt": "pytest==8.4.3\n"},
        )
    )
    assert res_a2.verdict == PolicyVerdict.ALLOW

    # Deny #1: .github workflow modification
    wf_diff = "--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@ -1 +1 @@\n-name: ci\n+name: pwn\n"
    res_d1 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(wf_diff, (".github/workflows/ci.yml",)),
            verification=_make_verification(),
        )
    )
    assert res_d1.verdict == PolicyVerdict.DENY
    assert res_d1.by_rule["P1"].verdict == PolicyVerdict.DENY

    # Deny #2: lockfile modification under non-F4 failure class
    res_d2 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(failure_class=FailureClass.F1_TEST_REGRESSION),
            patch=_make_patch(req_diff, ("requirements.txt",)),
            verification=_make_verification(),
        )
    )
    assert res_d2.verdict == PolicyVerdict.DENY
    assert res_d2.by_rule["P1"].verdict == PolicyVerdict.DENY

    # Deny #3: conftest / pytest config & homoglyph path
    homo_path = "pkg/c\u0430lc.py"  # Cyrillic 'а'
    res_d3 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch("--- a/conftest.py\n+++ b/conftest.py\n@@ -1 +1 @@\n-import pytest\n+pass\n", ("conftest.py",)),
            verification=_make_verification(),
        )
    )
    assert res_d3.by_rule["P1"].verdict == PolicyVerdict.DENY
    res_d4 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(f"--- a/{homo_path}\n+++ b/{homo_path}\n@@ -1 +1 @@\n-a\n+b\n", (homo_path,)),
            verification=_make_verification(),
        )
    )
    assert res_d4.by_rule["P1"].verdict == PolicyVerdict.DENY


def test_p2_ast_test_integrity_allow_deny_and_escalate(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")

    # Allow #1: prod fix without touching tests
    res_a1 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(),
            post_patch_sources={"pkg/calc.py": "def add(a: int, b: int) -> int:\n    return a + b\n"},
        )
    )
    assert res_a1.by_rule["P2"].verdict == PolicyVerdict.ALLOW

    # Allow #2: prod fix + adding stronger non-tautological assertion in co-patched test
    updated_test_strong = textwrap.dedent(
        """\
        from pkg.calc import add


        def test_add() -> None:
            assert add(2, 3) == 5
            assert add(1, 2) == 3


        def test_add_zero() -> None:
            assert add(0, 4) == 4
        """
    )
    res_a2 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(
                _CLEAN_CALC_DIFF,
                ("pkg/calc.py", "tests/test_calc.py"),
            ),
            verification=_make_verification(),
            post_patch_sources={
                "pkg/calc.py": "def add(a: int, b: int) -> int:\n    return a + b\n",
                "tests/test_calc.py": updated_test_strong,
            },
        )
    )
    assert res_a2.by_rule["P2"].verdict == PolicyVerdict.ALLOW

    # Deny #1: deleted a test function
    deleted_test = textwrap.dedent(
        """\
        from pkg.calc import add


        def test_add() -> None:
            assert add(2, 3) == 5
        """
    )
    res_d1 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch("--- a/tests/test_calc.py\n+++ b/tests/test_calc.py\n@@ -1 +1 @@\n-x\n+y\n", ("pkg/calc.py", "tests/test_calc.py")),
            verification=_make_verification(),
            post_patch_sources={
                "pkg/calc.py": "def add(a: int, b: int) -> int:\n    return a + b\n",
                "tests/test_calc.py": deleted_test,
            },
        )
    )
    assert res_d1.by_rule["P2"].verdict == PolicyVerdict.DENY

    # Deny #2: added pytest.mark.skip / tautology assertion
    skipped_test = textwrap.dedent(
        """\
        import pytest
        from pkg.calc import add


        @pytest.mark.skip(reason="flaky")
        def test_add() -> None:
            assert add(2, 3) == 5


        def test_add_zero() -> None:
            assert 1 == 1
        """
    )
    res_d2 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch("--- a/tests/test_calc.py\n+++ b/tests/test_calc.py\n@@ -1 +1 @@\n-x\n+y\n", ("pkg/calc.py", "tests/test_calc.py")),
            verification=_make_verification(),
            post_patch_sources={
                "pkg/calc.py": "def add(a: int, b: int) -> int:\n    return a + b\n",
                "tests/test_calc.py": skipped_test,
            },
        )
    )
    assert res_d2.by_rule["P2"].verdict == PolicyVerdict.DENY

    # Escalate: test-only patch that keeps all assertions intact
    res_e = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch("--- a/tests/test_calc.py\n+++ b/tests/test_calc.py\n@@ -1 +1 @@\n-x\n+y\n", ("tests/test_calc.py",)),
            verification=_make_verification(),
            post_patch_sources={"tests/test_calc.py": updated_test_strong},
        )
    )
    assert res_e.by_rule["P2"].verdict == PolicyVerdict.ESCALATE
    assert res_e.verdict == PolicyVerdict.ESCALATE


def test_p3_diff_budget_allow_and_deny_fixtures(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")

    # Allow #1 & #2: within <=3 files and <=60 changed lines
    for n_files, n_lines in [(1, 2), (3, 60)]:
        files = tuple(f"pkg/f{i}.py" for i in range(n_files))
        res = gate.evaluate(
            PolicyContext(
                repo_root=repo,
                event=_make_event(),
                diagnosis=_make_diagnosis(),
                patch=_make_patch(_CLEAN_CALC_DIFF, files, added=n_lines, deleted=0),
                verification=_make_verification(),
            )
        )
        assert res.by_rule["P3"].verdict == PolicyVerdict.ALLOW

    # Deny #1: 4 files (> 3)
    res_d1 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(
                _CLEAN_CALC_DIFF,
                ("pkg/a.py", "pkg/b.py", "pkg/c.py", "pkg/d.py"),
                added=4,
                deleted=4,
            ),
            verification=_make_verification(),
        )
    )
    assert res_d1.by_rule["P3"].verdict == PolicyVerdict.DENY

    # Deny #2: 61 lines (> 60)
    res_d2 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",), added=40, deleted=21),
            verification=_make_verification(),
        )
    )
    assert res_d2.by_rule["P3"].verdict == PolicyVerdict.DENY


def test_p4_dangerous_constructs_and_overfit_allow_and_deny_fixtures(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")

    # Allow #1 & #2: normal arithmetic / string handling fixes
    for src in (
        "def add(a: int, b: int) -> int:\n    return a + b\n\n\ndef sub(a: int, b: int) -> int:\n    return a - b\n",
        "def add(a: int, b: int) -> int:\n    total = a + b\n    return total\n\n\ndef sub(a: int, b: int) -> int:\n    return a - b\n",
    ):
        res = gate.evaluate(
            PolicyContext(
                repo_root=repo,
                event=_make_event(),
                diagnosis=_make_diagnosis(),
                patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
                verification=_make_verification(),
                post_patch_sources={"pkg/calc.py": src},
            )
        )
        assert res.by_rule["P4"].verdict == PolicyVerdict.ALLOW

    # Deny #1: eval/os.system/shell=True introduced
    bad_exec = "import os\ndef add(a: int, b: int) -> int:\n    os.system('id')\n    return a + b\n"
    res_d1 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(),
            post_patch_sources={"pkg/calc.py": bad_exec},
        )
    )
    assert res_d1.by_rule["P4"].verdict == PolicyVerdict.DENY

    # Deny #2: hardcoding test literal via overfit_guard (`if a == 2: return 5`)
    overfit_src = (
        "def add(a: int, b: int) -> int:\n"
        "    if a == 2:\n"
        "        return 5\n"
        "    return a - b\n"
    )
    res_d2 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(),
            post_patch_sources={"pkg/calc.py": overfit_src},
        )
    )
    assert res_d2.by_rule["P4"].verdict == PolicyVerdict.DENY

    # Deny #3: socket / env read
    exfil_src = (
        "import os, urllib.request\n"
        "def add(a: int, b: int) -> int:\n"
        "    _ = os.environ.get('SECRET')\n"
        "    return a + b\n"
    )
    res_d3 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(),
            post_patch_sources={"pkg/calc.py": exfil_src},
        )
    )
    assert res_d3.by_rule["P4"].verdict == PolicyVerdict.DENY


def test_p5_secret_scan_allow_and_deny_fixtures(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")

    # Allow #1 & #2: normal code & benign comment
    for added_line in ("+    return a + b", "+    # Safe integer addition"):
        diff = f"--- a/pkg/calc.py\n+++ b/pkg/calc.py\n@@ -1,2 +1,2 @@\n-    return a - b\n{added_line}\n"
        res = gate.evaluate(
            PolicyContext(
                repo_root=repo,
                event=_make_event(),
                diagnosis=_make_diagnosis(),
                patch=_make_patch(diff, ("pkg/calc.py",)),
                verification=_make_verification(),
            )
        )
        assert res.by_rule["P5"].verdict == PolicyVerdict.ALLOW

    # Deny #1 & #2: synthetic GitHub token and AWS access key in added lines
    fake_gh = "ghp_" + "Z" * 36
    fake_aws = "AKIA" + "0123456789ABCDEF"
    for secret in (fake_gh, fake_aws):
        diff = f'--- a/pkg/calc.py\n+++ b/pkg/calc.py\n@@ -1 +1 @@\n-x = 1\n+x = "{secret}"\n'
        res = gate.evaluate(
            PolicyContext(
                repo_root=repo,
                event=_make_event(),
                diagnosis=_make_diagnosis(),
                patch=_make_patch(diff, ("pkg/calc.py",)),
                verification=_make_verification(),
            )
        )
        assert res.by_rule["P5"].verdict == PolicyVerdict.DENY


def test_p6_required_evidence_allow_and_deny_fixtures(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")

    # Allow #1 & #2: passed after patch with k=1 and k=3 reproduction runs, no network, ro rootfs
    for k in (1, 3):
        res = gate.evaluate(
            PolicyContext(
                repo_root=repo,
                event=_make_event(),
                diagnosis=_make_diagnosis(),
                patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
                verification=_make_verification(reproduction_runs=k, reproduced_failures=k),
            )
        )
        assert res.by_rule["P6"].verdict == PolicyVerdict.ALLOW

    # Deny #1: did not pass after patch
    res_d1 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(passed_after_patch=False),
        )
    )
    assert res_d1.by_rule["P6"].verdict == PolicyVerdict.DENY

    # Deny #2: network was NOT disabled or lint was dirty
    res_d2 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(network_disabled=False),
        )
    )
    assert res_d2.by_rule["P6"].verdict == PolicyVerdict.DENY


def test_p7_confidence_threshold_allow_and_escalate_fixtures(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")

    # Allow #1 & #2: confidence >= 0.75
    for conf in (0.75, 0.99):
        res = gate.evaluate(
            PolicyContext(
                repo_root=repo,
                event=_make_event(),
                diagnosis=_make_diagnosis(confidence=conf),
                patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
                verification=_make_verification(),
            )
        )
        assert res.by_rule["P7"].verdict == PolicyVerdict.ALLOW

    # Diagnosis-only Escalate #1 & #2: confidence < 0.75
    for conf in (0.40, 0.74):
        res = gate.evaluate(
            PolicyContext(
                repo_root=repo,
                event=_make_event(),
                diagnosis=_make_diagnosis(confidence=conf),
                patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
                verification=_make_verification(),
            )
        )
        assert res.by_rule["P7"].verdict == PolicyVerdict.ESCALATE
        assert res.verdict == PolicyVerdict.ESCALATE


def test_p8_depth_limit_allow_and_deny_fixtures(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")

    # Allow #1 & #2: human PR at depth 0/1 on normal branch
    for actor, depth in [("alice", 0), ("ci-trigger", 1)]:
        res = gate.evaluate(
            PolicyContext(
                repo_root=repo,
                event=_make_event(base_branch="main", actor=actor),
                diagnosis=_make_diagnosis(),
                patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
                verification=_make_verification(),
                repair_depth=depth,
            )
        )
        assert res.by_rule["P8"].verdict == PolicyVerdict.ALLOW

    # Deny #1: bot actor or aegis/* branch self-loop
    res_d1 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(base_branch="aegis/fix/run-1", actor="alice"),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(),
            repair_depth=1,
        )
    )
    assert res_d1.by_rule["P8"].verdict == PolicyVerdict.DENY

    # Deny #2: repair_depth > 1 or bot actor
    res_d2 = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(base_branch="main", actor="aegis-ci[bot]"),
            diagnosis=_make_diagnosis(),
            patch=_make_patch(_CLEAN_CALC_DIFF, ("pkg/calc.py",)),
            verification=_make_verification(),
            repair_depth=2,
        )
    )
    assert res_d2.by_rule["P8"].verdict == PolicyVerdict.DENY


def test_p1_rejects_symlink_if_supported(tmp_path: Path) -> None:
    gate = _gate()
    repo = _make_repo(tmp_path / "repo")
    link_path = repo / "pkg" / "link.py"
    try:
        link_path.symlink_to(repo / "pkg" / "calc.py")
    except (OSError, NotImplementedError):
        pytest.skip("Symlinks not permitted on this host")

    res = gate.evaluate(
        PolicyContext(
            repo_root=repo,
            event=_make_event(),
            diagnosis=_make_diagnosis(),
            patch=_make_patch("--- a/pkg/link.py\n+++ b/pkg/link.py\n@@ -1 +1 @@\n-a\n+b\n", ("pkg/link.py",)),
            verification=_make_verification(),
        )
    )
    assert res.by_rule["P1"].verdict == PolicyVerdict.DENY
