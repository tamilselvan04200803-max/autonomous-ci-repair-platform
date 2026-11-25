"""Deterministic v1 triage parsers for pytest, ruff, mypy, and pip output (Milestone A3)."""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from aegis.domain.models import Diagnosis, FailureClass
from aegis.triage.redactor import strip_ansi_and_redact

# --- Ruff patterns ---
_RUFF_LINE_RE = re.compile(
    r"^([^\s:][^:\n]*\.pyi?):(\d+):(?:\d+:)?\s+([A-Z]{1,4}\d{3,4})\s+(.+)$", re.MULTILINE
)
_RUFF_FORMAT_RE = re.compile(r"^Would reformat:\s+(.+\.pyi?)$", re.MULTILINE)
_RUFF_SUMMARY_RE = re.compile(r"^Found\s+\d+\s+errors?\.", re.MULTILINE)

# --- Mypy patterns ---
_MYPY_LINE_RE = re.compile(
    r"^([^\s:][^:\n]*\.pyi?):(\d+):(?:\d+:)?\s+error:\s+(.+?)(?:\s+\[([a-z0-9-]+)\])?\s*$",
    re.MULTILINE,
)
_MYPY_SUMMARY_RE = re.compile(r"^Found\s+\d+\s+errors?\s+in\s+\d+\s+files?", re.MULTILINE)

# --- Pip / dependency & API drift patterns ---
_PIP_STRONG_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"ERROR:\s+ResolutionImpossible", re.IGNORECASE),
    re.compile(r"Could not find a version that satisfies the requirement", re.IGNORECASE),
    re.compile(r"No matching distribution found for", re.IGNORECASE),
    re.compile(r"pip's dependency resolver does not currently take into account", re.IGNORECASE),
    re.compile(r"No solution found when resolving dependencies:", re.IGNORECASE),
    re.compile(r"pkg_resources\.DistributionNotFound:", re.IGNORECASE),
    re.compile(r"ERROR:\s+Failed building wheel for", re.IGNORECASE),
    re.compile(r"Preparing metadata \(pyproject\.toml\) did not run successfully", re.IGNORECASE),
)
_PYTHON_DRIFT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bModuleNotFoundError:\s+No module named\s+'([^']+)'"),
    re.compile(r"\bImportError:\s+cannot import name\s+'([^']+)'\s+from\s+'([^']+)'"),
    re.compile(r"\bPydanticImportError:"),
    re.compile(r"has no attribute\s+'append'.*DataFrame|DataFrame.*has no attribute\s+'append'"),
    re.compile(r"unexpected keyword argument\s+'proxies'.*Client|Client\.__init__\(\)"),
    re.compile(r"TypeError:\s+load\(\)\s+missing 1 required positional argument:\s+'Loader'"),
)

# --- Pytest patterns ---
_PYTEST_FAILED_SUMMARY_RE = re.compile(
    r"^(?:FAILED|ERROR)\s+([^\s]+(?:::[^\s]+)?)(?:\s+-\s+(.*))?$", re.MULTILINE
)
_PYTEST_SECTION_RE = re.compile(r"^=+\s+(?:FAILURES|ERRORS)\s+=+$", re.MULTILINE)
_PYTEST_COUNTS_RE = re.compile(r"\b\d+\s+(?:failed|error)\b", re.IGNORECASE)
_PYTEST_FRAME_RE = re.compile(r"^\s*([^\s:]+\.py):(\d+):\s+in\s+\S+", re.MULTILINE)


def parse_junit_xml(junit_xml: str) -> Diagnosis | None:
    """Parse pytest JUnit XML output deterministically; prefers structured XML over logs."""
    stripped = junit_xml.strip()
    if not stripped:
        return None
    try:
        root = ET.fromstring(stripped)  # noqa: S314
    except ET.ParseError:
        return None

    suites = [root] if root.tag == "testsuite" else root.findall(".//testsuite")
    failing_ids: list[str] = []
    messages: list[str] = []
    files: list[str] = []
    for suite in suites:
        for tc in suite.findall("testcase"):
            classname = tc.attrib.get("classname", "")
            name = tc.attrib.get("name", "")
            node_id = f"{classname}::{name}" if classname and name else (name or classname)
            fail_node = tc.find("failure")
            err_node = tc.find("error")
            bad = fail_node if fail_node is not None else err_node
            if bad is not None:
                if node_id:
                    failing_ids.append(node_id)
                msg = bad.attrib.get("message", "") or (bad.text or "").strip().splitlines()[0]
                if msg:
                    messages.append(msg)
                if classname and "." in classname:
                    mod_file = classname.replace(".", "/") + ".py"
                    if mod_file not in files:
                        files.append(mod_file)

    if not failing_ids:
        return None

    return Diagnosis(
        failure_class=FailureClass.F1_TEST_REGRESSION,
        parser="pytest-junitxml",
        failing_command="pytest --junitxml=report.xml",
        error_summary=(
            messages[0][:300] if messages else f"{len(failing_ids)} failing pytest case(s)"
        ),
        failing_test_ids=tuple(dict.fromkeys(failing_ids)),
        error_files=tuple(files),
        confidence=0.98,
        evidence_excerpt=strip_ansi_and_redact("\n".join(messages), max_chars=800),
    )


def parse_ruff_log(raw_log: str) -> Diagnosis | None:
    """Parse Ruff lint / format check outputs deterministically -> F2_LINT_FORMAT."""
    clean = strip_ansi_and_redact(raw_log, max_chars=32_000)
    # 1. Ruff JSON format: [{"code": "...", "filename": "...", "message": "..."}]
    trimmed = clean.strip()
    if trimmed.startswith("[") and trimmed.endswith("]"):
        try:
            items = json.loads(trimmed)
            if isinstance(items, list) and items and all(
                isinstance(x, dict) and "code" in x and "filename" in x for x in items
            ):
                files = tuple(dict.fromkeys(Path(str(x["filename"])).as_posix() for x in items))
                codes = tuple(dict.fromkeys(str(x["code"]) for x in items))
                first_msg = str(items[0].get("message", codes[0]))
                return Diagnosis(
                    failure_class=FailureClass.F2_LINT_FORMAT,
                    parser="ruff-json",
                    failing_command="ruff check --output-format json",
                    error_summary=f"Ruff {', '.join(codes[:4])}: {first_msg}",
                    error_files=files,
                    error_codes=codes,
                    confidence=0.98,
                    evidence_excerpt=clean[:800],
                )
        except json.JSONDecodeError:
            pass

    matches = _RUFF_LINE_RE.findall(clean)
    if matches:
        files = tuple(dict.fromkeys(m[0].replace("\\", "/") for m in matches))
        codes = tuple(dict.fromkeys(m[2] for m in matches))
        return Diagnosis(
            failure_class=FailureClass.F2_LINT_FORMAT,
            parser="ruff",
            failing_command="ruff check",
            error_summary=(
                f"Ruff {matches[0][2]} in {matches[0][0]}:{matches[0][1]}: {matches[0][3]}"
            ),
            error_files=files,
            error_codes=codes,
            confidence=0.97,
            evidence_excerpt=clean[:800],
        )

    fmt_matches = _RUFF_FORMAT_RE.findall(clean)
    if fmt_matches or "would be reformatted" in clean.lower():
        files = tuple(dict.fromkeys(p.strip().replace("\\", "/") for p in fmt_matches))
        return Diagnosis(
            failure_class=FailureClass.F2_LINT_FORMAT,
            parser="ruff-format",
            failing_command="ruff format --check",
            error_summary=f"Ruff formatting mismatch in {len(files) or 1} file(s)",
            error_files=files,
            error_codes=("FORMAT",),
            confidence=0.96,
            evidence_excerpt=clean[:800],
        )
    return None


def parse_mypy_log(raw_log: str) -> Diagnosis | None:
    """Parse mypy static typecheck output deterministically -> F3_TYPE_ERROR."""
    clean = strip_ansi_and_redact(raw_log, max_chars=32_000)
    matches = _MYPY_LINE_RE.findall(clean)
    has_mypy_summary = bool(_MYPY_SUMMARY_RE.search(clean))
    if not matches:
        return None
    if not has_mypy_summary and not any(m[3] for m in matches):
        return None

    files = tuple(dict.fromkeys(m[0].replace("\\", "/") for m in matches))
    codes = tuple(dict.fromkeys(m[3] for m in matches if m[3]))
    return Diagnosis(
        failure_class=FailureClass.F3_TYPE_ERROR,
        parser="mypy",
        failing_command="mypy",
        error_summary=f"mypy error at {matches[0][0]}:{matches[0][1]}: {matches[0][2]}",
        error_files=files,
        error_codes=codes,
        confidence=0.97,
        evidence_excerpt=clean[:800],
    )


def parse_pip_log(raw_log: str) -> Diagnosis | None:
    """Parse pip/uv resolver & dependency/API drift failures -> F4_DEPENDENCY_DRIFT."""
    clean = strip_ansi_and_redact(raw_log, max_chars=32_000)
    for pat in _PIP_STRONG_PATTERNS:
        m = pat.search(clean)
        if m:
            line = m.group(0).strip()
            return Diagnosis(
                failure_class=FailureClass.F4_DEPENDENCY_DRIFT,
                parser="pip-resolver",
                failing_command="pip install",
                error_summary=line[:300],
                confidence=0.96,
                evidence_excerpt=clean[:800],
            )
    # Check standalone Python dependency / API drift tracebacks (exclude pytest test assertions)
    is_pytest_session = bool(
        _PYTEST_SECTION_RE.search(clean) or _PYTEST_FAILED_SUMMARY_RE.search(clean)
    )
    if not is_pytest_session:
        for pat in _PYTHON_DRIFT_PATTERNS:
            m = pat.search(clean)
            if m:
                return Diagnosis(
                    failure_class=FailureClass.F4_DEPENDENCY_DRIFT,
                    parser="python-dependency-drift",
                    failing_command="python",
                    error_summary=m.group(0)[:300],
                    confidence=0.92,
                    evidence_excerpt=clean[:800],
                )
    return None


def parse_pytest_log(raw_log: str) -> Diagnosis | None:
    """Parse pytest console failure/collection outputs -> F1_TEST_REGRESSION."""
    clean = strip_ansi_and_redact(raw_log, max_chars=32_000)
    summary_hits = _PYTEST_FAILED_SUMMARY_RE.findall(clean)
    has_pytest_markers = bool(
        summary_hits
        or _PYTEST_SECTION_RE.search(clean)
        or "pytest" in clean.lower()
        or "INTERNALERROR>" in clean
        or (_PYTEST_COUNTS_RE.search(clean) and (".py" in clean or "::" in clean))
    )
    if not has_pytest_markers:
        return None
    if (
        not summary_hits
        and not _PYTEST_SECTION_RE.search(clean)
        and not _PYTEST_COUNTS_RE.search(clean)
    ):
        return None

    test_ids = tuple(dict.fromkeys(hit[0].strip() for hit in summary_hits if hit[0].strip()))
    frames = _PYTEST_FRAME_RE.findall(clean)
    files: list[str] = []
    for path_raw, _ in frames:
        p = path_raw.replace("\\", "/")
        if not p.startswith("tests/") and "site-packages" not in p and p not in files:
            files.append(p)
    for tid in test_ids:
        fpath = tid.split("::", 1)[0].replace("\\", "/")
        if fpath.endswith(".py") and fpath not in files:
            files.append(fpath)

    summary_msg = (
        f"{summary_hits[0][0]} - {summary_hits[0][1]}".strip(" -")
        if summary_hits
        else clean.strip().splitlines()[-1][:240]
    )
    return Diagnosis(
        failure_class=FailureClass.F1_TEST_REGRESSION,
        parser="pytest",
        failing_command="pytest",
        error_summary=summary_msg[:300],
        failing_test_ids=test_ids,
        error_files=tuple(files),
        confidence=0.94,
        evidence_excerpt=clean[:800],
    )


def triage_failure(raw_log: str, *, junit_xml: str | None = None) -> Diagnosis:
    """Deterministically triage CI output; unknown formats ALWAYS yield UNCLASSIFIED."""
    if junit_xml:
        xml_diag = parse_junit_xml(junit_xml)
        if xml_diag is not None:
            return xml_diag

    for parser_fn in (parse_pip_log, parse_ruff_log, parse_mypy_log, parse_pytest_log):
        result = parser_fn(raw_log)
        if result is not None:
            return result

    clean = strip_ansi_and_redact(raw_log, max_chars=800)
    return Diagnosis(
        failure_class=FailureClass.UNCLASSIFIED,
        parser="none",
        failing_command="",
        error_summary="Unrecognized CI failure format; deterministic parsers refuse to guess",
        confidence=0.0,
        evidence_excerpt=clean,
    )
