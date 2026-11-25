"""Diff generation, path safety validation, git apply checking, and copy application."""

from __future__ import annotations

import difflib
import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING

from agentsentinel.policy.diff_parser import MalformedDiffError, ParsedDiff, UnifiedDiffParser

from aegis.domain.models import Patch, SearchReplaceEdit
from aegis.graph.frontend import normalize_rel_path

if TYPE_CHECKING:
    from collections.abc import Sequence

    from aegis.repair.models import RepairProposal

_FORBIDDEN_DIRS: frozenset[str] = frozenset({".git", ".venv", "venv", "__pycache__"})
_FORBIDDEN_PREFIXES: tuple[str, ...] = (".env",)
_FORBIDDEN_SUFFIXES: tuple[str, ...] = (".pem", ".key", ".p12", ".pfx")


class DiffValidationError(ValueError):
    """Raised when a search/replace edit or unified diff violates safety or applicability."""


def resolve_safe_rel_path(repo_root: Path, raw_path: str) -> tuple[str, Path]:
    """Validate that a relative path stays strictly inside repo_root and avoids secret/git files."""
    if not raw_path or "\x00" in raw_path:
        raise DiffValidationError(f"Empty or null-byte path rejected: {raw_path!r}")
    norm = normalize_rel_path(raw_path.strip())
    if norm.startswith("/") or (len(norm) >= 2 and norm[1] == ":"):
        raise DiffValidationError(f"Absolute path rejected: {raw_path!r}")

    posix = PurePosixPath(norm)
    parts = posix.parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise DiffValidationError(f"Path traversal or malformed path rejected: {raw_path!r}")
    if any(part in _FORBIDDEN_DIRS for part in parts):
        raise DiffValidationError(f"Forbidden repository directory in path: {raw_path!r}")
    base = parts[-1].lower()
    if any(base.startswith(pfx) for pfx in _FORBIDDEN_PREFIXES) or any(
        base.endswith(sfx) for sfx in _FORBIDDEN_SUFFIXES
    ):
        raise DiffValidationError(f"Forbidden sensitive file path rejected: {raw_path!r}")

    root_resolved = repo_root.resolve()
    target = repo_root / posix.as_posix()
    if target.is_symlink():
        raise DiffValidationError(f"Symlink target rejected: {raw_path!r}")
    resolved_target = target.resolve()
    if not resolved_target.is_relative_to(root_resolved):
        raise DiffValidationError(f"Resolved path escapes repo root: {raw_path!r}")
    return posix.as_posix(), resolved_target


def edits_to_unified_diff(repo_root: Path, edits: Sequence[SearchReplaceEdit]) -> str:
    """Convert unambiguous SearchReplaceEdit objects into a validated LF unified diff."""
    if not edits:
        raise DiffValidationError("No edits supplied")

    grouped: dict[str, list[SearchReplaceEdit]] = {}
    for edit in edits:
        rel, _ = resolve_safe_rel_path(repo_root, edit.path)
        grouped.setdefault(rel, []).append(edit)

    chunks: list[str] = []
    for rel in sorted(grouped):
        _, target = resolve_safe_rel_path(repo_root, rel)
        if not target.is_file():
            raise DiffValidationError(f"Target file does not exist: {rel}")

        original = target.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
        updated = original
        for edit in grouped[rel]:
            search = edit.search.replace("\r\n", "\n").replace("\r", "\n")
            replace = edit.replace.replace("\r\n", "\n").replace("\r", "\n")
            if not search:
                raise DiffValidationError(f"Empty search block in edit for {rel}")
            count = updated.count(search)
            if count != 1:
                raise DiffValidationError(
                    f"Search block in {rel} matched {count} times (expected exact 1)"
                )
            updated = updated.replace(search, replace, 1)

        if updated == original:
            raise DiffValidationError(f"Edits for {rel} produced no textual change")

        diff_lines = list(
            difflib.unified_diff(
                original.splitlines(keepends=True),
                updated.splitlines(keepends=True),
                fromfile=f"a/{rel}",
                tofile=f"b/{rel}",
                lineterm="\n",
            )
        )
        chunk = "".join(diff_lines)
        if chunk and not chunk.endswith("\n"):
            chunk += "\n"
        chunks.append(chunk)

    unified = "".join(chunks)
    if not unified.strip():
        raise DiffValidationError("Generated empty unified diff")
    validate_unified_diff(repo_root, unified)
    return unified


def _copy_clean_subset(repo_root: Path, files: Sequence[str], dest_dir: Path) -> None:
    for rel in files:
        _, src = resolve_safe_rel_path(repo_root, rel)
        if not src.is_file():
            raise DiffValidationError(f"Missing target file for diff check: {rel}")
        dst = dest_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        content = src.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
        dst.write_text(content, encoding="utf-8", newline="\n")


def validate_unified_diff(repo_root: Path, unified_diff: str) -> ParsedDiff:
    """Validate unified diff syntax via AgentSentinel and dry-run `git apply --check`."""
    try:
        parsed = UnifiedDiffParser.parse(unified_diff)
    except MalformedDiffError as exc:
        raise DiffValidationError(str(exc)) from exc

    if not parsed.files:
        raise DiffValidationError("Unified diff touches zero files")

    target_paths: list[str] = []
    for file_diff in parsed.files:
        if file_diff.is_new or file_diff.is_delete or file_diff.is_rename:
            raise DiffValidationError(
                "Creating, deleting, or renaming files is disallowed in v1 diffs"
            )
        for tp in file_diff.target_paths:
            rel, _ = resolve_safe_rel_path(repo_root, tp)
            if rel not in target_paths:
                target_paths.append(rel)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        _copy_clean_subset(repo_root, target_paths, tmp_path)
        proc = subprocess.run(
            ["git", "apply", "--check", "-"],
            input=unified_diff.replace("\r\n", "\n").encode("utf-8"),
            cwd=tmp_path,
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            stderr = proc.stderr.decode("utf-8", errors="replace").strip()
            raise DiffValidationError(f"git apply --check failed: {stderr}")

    return parsed


def _count_diff_lines(parsed: ParsedDiff) -> tuple[tuple[str, ...], int, int]:
    changed: list[str] = []
    added = 0
    deleted = 0
    for fdiff in parsed.files:
        changed.extend(fdiff.target_paths)
        for hunk in fdiff.hunks:
            for line in hunk.lines:
                if line.origin == "+":
                    added += 1
                elif line.origin == "-":
                    deleted += 1
    return tuple(dict.fromkeys(changed)), added, deleted


def build_patch_from_proposal(
    repo_root: Path,
    proposal: RepairProposal,
    attempt: int,
) -> Patch:
    """Convert a validated RepairProposal into a canonical immutable Patch."""
    if proposal.edits:
        unified = edits_to_unified_diff(repo_root, proposal.edits)
    else:
        unified = proposal.unified_diff.replace("\r\n", "\n")
    parsed = validate_unified_diff(repo_root, unified)
    changed_files, added_lines, deleted_lines = _count_diff_lines(parsed)
    diff_sha256 = hashlib.sha256(unified.encode("utf-8")).hexdigest()
    return Patch(
        attempt=attempt,
        edits=proposal.edits,
        unified_diff=unified,
        diff_sha256=diff_sha256,
        changed_files=changed_files,
        added_lines=added_lines,
        deleted_lines=deleted_lines,
        rationale=proposal.rationale,
    )


def apply_diff_to_copy(repo_root: Path, unified_diff: str, dest_dir: Path) -> Path:
    """Copy repo safely (no .git/secrets/symlinks) to dest_dir and apply unified_diff."""
    validate_unified_diff(repo_root, unified_diff)
    root_resolved = repo_root.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    for src_path in sorted(root_resolved.rglob("*")):
        if src_path.is_symlink():
            continue
        rel = src_path.relative_to(root_resolved).as_posix()
        parts = PurePosixPath(rel).parts
        if any(p in _FORBIDDEN_DIRS for p in parts):
            continue
        base = parts[-1].lower()
        if any(base.startswith(pfx) for pfx in _FORBIDDEN_PREFIXES) or any(
            base.endswith(sfx) for sfx in _FORBIDDEN_SUFFIXES
        ):
            continue
        dst_path = dest_dir / rel
        if src_path.is_dir():
            dst_path.mkdir(parents=True, exist_ok=True)
        elif src_path.is_file():
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src_path, dst_path)

    proc = subprocess.run(
        ["git", "apply", "-"],
        input=unified_diff.replace("\r\n", "\n").encode("utf-8"),
        cwd=dest_dir,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise DiffValidationError(f"git apply failed in workspace copy: {stderr}")
    return dest_dir
