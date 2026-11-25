"""Milestone A3 TDD tests: Log redaction, JUnit/pytest/ruff/mypy/pip triage, golden corpus & flake check."""

from __future__ import annotations

from pathlib import Path

import pytest
from aegis.domain.models import FailureClass
from aegis.triage.flake import FlakeVerdict, detect_flaky_failure
from aegis.triage.parsers import parse_junit_xml, triage_failure
from aegis.triage.redactor import sanitize_untrusted_log

CORPUS_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "triage_corpus"


@pytest.mark.unit
def test_redactor_strips_ansi_redacts_secrets_truncates_and_wraps() -> None:
    fake_gh = "ghp_" + "A" * 30
    fake_sk = "sk-proj-" + "B" * 30
    raw = (
        f"\x1b[31mERROR\x1b[0m: auth failed with token {fake_gh} "
        f"and bearer Bearer my-super-secret-jwt-value and {fake_sk}\n"
        + ("A" * 5000)
    )
    safe = sanitize_untrusted_log(raw, max_chars=500)
    assert "\x1b" not in safe
    assert fake_gh not in safe
    assert "my-super-secret-jwt-value" not in safe
    assert fake_sk not in safe
    assert "[REDACTED:" in safe
    assert "<<<UNTRUSTED_DATA_BEGIN>>>" in safe
    assert "<<<UNTRUSTED_DATA_END>>>" in safe
    assert len(safe) < 900


@pytest.mark.unit
def test_junit_xml_preferred_over_console_noise() -> None:
    junit_xml = """<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" tests="2" errors="0" failures="1" skipped="0">
    <testcase classname="tests.test_calc" name="test_add" time="0.001" />
    <testcase classname="tests.test_calc" name="test_sub" time="0.002">
      <failure message="AssertionError: assert -1 == 5">def test_sub():
    assert sub(3, 2) == 1</failure>
    </testcase>
  </testsuite>
</testsuites>
"""
    diag = parse_junit_xml(junit_xml)
    assert diag is not None
    assert diag.failure_class == FailureClass.F1_TEST_REGRESSION
    assert diag.parser == "pytest-junitxml"
    assert "tests.test_calc::test_sub" in diag.failing_test_ids

    combined = triage_failure("unrelated stdout noise", junit_xml=junit_xml)
    assert combined.parser == "pytest-junitxml"
    assert combined.failure_class == FailureClass.F1_TEST_REGRESSION


@pytest.mark.unit
def test_golden_corpus_counts_and_deterministic_classification() -> None:
    expected = {
        "pytest": FailureClass.F1_TEST_REGRESSION,
        "ruff": FailureClass.F2_LINT_FORMAT,
        "mypy": FailureClass.F3_TYPE_ERROR,
        "pip": FailureClass.F4_DEPENDENCY_DRIFT,
    }
    for subdir, want_class in expected.items():
        files = sorted((CORPUS_ROOT / subdir).iterdir())
        assert len(files) >= 15, f"Expected >= 15 golden logs in {subdir}, found {len(files)}"
        for f in files:
            content = f.read_text(encoding="utf-8")
            diag = (
                triage_failure("", junit_xml=content)
                if f.suffix == ".xml"
                else triage_failure(content)
            )
            assert diag.failure_class == want_class, f"{f.name} misclassified as {diag.failure_class}"

    unknown_files = sorted((CORPUS_ROOT / "unclassified").iterdir())
    assert len(unknown_files) >= 6
    for f in unknown_files:
        diag = triage_failure(f.read_text(encoding="utf-8"))
        assert diag.failure_class == FailureClass.UNCLASSIFIED, (
            f"Unknown log {f.name} must yield UNCLASSIFIED, got {diag.failure_class}"
        )


@pytest.mark.unit
def test_flake_detector_mixed_runs_flagged_and_never_patched() -> None:
    mixed_codes = iter([1, 0, 1])
    res_mixed = detect_flaky_failure(lambda: next(mixed_codes), runs=3)
    assert res_mixed.verdict == FlakeVerdict.FLAKY
    assert res_mixed.failure_class == FailureClass.F5_FLAKY
    assert res_mixed.should_patch is False

    det_codes = iter([1, 1, 1])
    res_det = detect_flaky_failure(lambda: next(det_codes), runs=3)
    assert res_det.verdict == FlakeVerdict.DETERMINISTIC_FAILURE
    assert res_det.should_patch is True

    pass_codes = iter([0, 0, 0])
    res_pass = detect_flaky_failure(lambda: next(pass_codes), runs=3)
    assert res_pass.verdict == FlakeVerdict.NOT_REPRODUCED
    assert res_pass.should_patch is False
