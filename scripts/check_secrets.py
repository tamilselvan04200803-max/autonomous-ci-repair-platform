"""Pre-commit / CI secret scan for Aegis-CI (Rule 7)."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("github_pat", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b")),
    ("github_fine_pat", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{30,}\b")),
    ("openai_key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("rsa_private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
)

ALLOWLISTED_FILES = frozenset({
    "examples/proof-bundles/sample-public.pem",
    "templates/sample-public.pem",
    "scripts/check_secrets.py",
})

SKIP_EXTS = frozenset({".jpg", ".jpeg", ".png", ".gif", ".ico", ".woff2", ".db", ".sqlite", ".pyc"})


def scan_tracked_files(repo_root: Path) -> list[str]:
    """Scan all git-tracked files for leaked credentials or private keys."""
    res = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files"],
        capture_output=True,
        text=True,
        check=True,
    )
    findings: list[str] = []
    for rel in res.stdout.splitlines():
        rel_posix = rel.replace("\\", "/").strip()
        if not rel_posix or rel_posix in ALLOWLISTED_FILES:
            continue
        p = repo_root / rel_posix
        if not p.is_file() or p.suffix.lower() in SKIP_EXTS:
            continue
        if rel_posix == ".env" or (rel_posix.startswith(".env.") and rel_posix != ".env.example"):
            findings.append(f"Forbidden environment file tracked: {rel_posix}")
            continue
        if rel_posix.endswith(".key") or (
            rel_posix.endswith(".pem")
            and "examples/" not in rel_posix
            and "templates/" not in rel_posix
        ):
            # Allow test fixture public PEMs only if checked cleanly
            content = p.read_text(encoding="utf-8", errors="replace")
            if "PRIVATE KEY" in content:
                findings.append(f"Private key file tracked: {rel_posix}")
                continue
        content = p.read_text(encoding="utf-8", errors="replace")
        # Ignore documented placeholder markers using ellipsis or TEST_DUMMY
        lines = content.splitlines()
        for idx, line in enumerate(lines, 1):
            for name, pat in SECRET_PATTERNS:
                if pat.search(line):
                    if "PUBLIC KEY" in line or "TEST_DUMMY" in line or "PLACEHOLDER" in line:
                        continue
                    is_placeholder = "…" in line or "..." in line or "\\n…" in line
                    if name == "rsa_private_key" and is_placeholder:
                        continue
                    findings.append(f"{rel_posix}:{idx}: matched {name}")
    return findings


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    findings = scan_tracked_files(root)
    if findings:
        for item in findings:
            print(f"[SECRET-SCAN FAIL] {item}", file=sys.stderr)
        return 1
    print("[SECRET-SCAN OK] Zero secrets or private keys detected in tracked files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
