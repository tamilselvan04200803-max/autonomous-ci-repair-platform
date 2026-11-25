"""Untrusted log ANSI stripping, secret redaction, truncation, and wrapping (Section 5)."""

from __future__ import annotations

import re

_ANSI_ESCAPE_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("GITHUB_TOKEN", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b")),
    ("GITHUB_PAT", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("OPENAI_KEY", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b")),
    ("GOOGLE_KEY", re.compile(r"\bAIza[0-9A-Za-z\-_]{24,}\b")),
    ("AWS_KEY", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("BEARER_TOKEN", re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}")),
    (
        "PEM_KEY",
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    ),
)

UNTRUSTED_BEGIN = "<<<UNTRUSTED_DATA_BEGIN>>>"
UNTRUSTED_END = "<<<UNTRUSTED_DATA_END>>>"


def strip_ansi_and_redact(text: str, *, max_chars: int = 12_000) -> str:
    """Strip ANSI escape sequences, redact token-shaped strings, and truncate safely."""
    cleaned = _ANSI_ESCAPE_RE.sub("", text or "")
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _CONTROL_RE.sub("", cleaned)
    for label, pattern in _SECRET_PATTERNS:
        if label == "BEARER_TOKEN":
            cleaned = pattern.sub(f"Bearer [REDACTED:{label}]", cleaned)
        else:
            cleaned = pattern.sub(f"[REDACTED:{label}]", cleaned)
    # Neutralize embedded untrusted wrappers or markdown triple backticks inside raw log text
    cleaned = cleaned.replace(UNTRUSTED_BEGIN, "[UNTRUSTED_MARKER_STRIPPED]")
    cleaned = cleaned.replace(UNTRUSTED_END, "[UNTRUSTED_MARKER_STRIPPED]")
    if len(cleaned) > max_chars:
        half = max(1, (max_chars - 60) // 2)
        omitted = len(cleaned) - (2 * half)
        cleaned = f"{cleaned[:half]}\n... [TRUNCATED {omitted} CHARS] ...\n{cleaned[-half:]}"
    return cleaned


def sanitize_untrusted_log(text: str, *, max_chars: int = 12_000) -> str:
    """Sanitize untrusted CI log text and enclose it in an explicit untrusted-data block."""
    inner = strip_ansi_and_redact(text, max_chars=max_chars)
    return f"{UNTRUSTED_BEGIN}\n{inner}\n{UNTRUSTED_END}"
