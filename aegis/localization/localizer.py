"""Token-budgeted B0/B1/B2 localization strategies and Section 7.5 selection rule."""

from __future__ import annotations

import keyword
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from agentsentinel.localization.traceback_parser import extract_traceback_frames

from aegis.domain.models import ContextManifest, Diagnosis
from aegis.graph.frontend import normalize_rel_path
from aegis.graph.store import SKIP_DIRS, CodeGraphStore

if TYPE_CHECKING:
    from pathlib import Path

LocalizationMethod = Literal["B0", "B1", "B2"]

_FILE_LINE_RE = re.compile(r'File\s+"([^"]+)",\s+line\s+\d+')
_PYTEST_PATH_RE = re.compile(r"([A-Za-z0-9_./\\-]+\.py)(?::\d+|::)")
_IDENT_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]{2,}\b")
_STOPWORDS: frozenset[str] = frozenset(
    {
        "AssertionError",
        "TypeError",
        "ValueError",
        "RuntimeError",
        "KeyError",
        "AttributeError",
        "ImportError",
        "ModuleNotFoundError",
        "line",
        "file",
        "error",
        "failed",
        "pytest",
        "ruff",
        "mypy",
        "assert",
        "test",
    }
)


def estimate_tokens(text: str) -> int:
    """Deterministic lightweight token estimator (roughly 4 chars per token)."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


@dataclass(frozen=True, slots=True)
class LocalizationExperimentResult:
    b0_pass_rate: float
    b0_median_tokens: int
    b1_pass_rate: float
    b1_median_tokens: int
    b2_pass_rate: float
    b2_median_tokens: int


def select_localization_mode(result: LocalizationExperimentResult) -> Literal["B1", "B2"]:
    """Apply Section 7.5 pre-registered localization selection rule.

    Keep B2 (code graph) if:
    - B2 accuracy beats B1 by at least 5 percentage points (0.05), OR
    - B2 accuracy is within 5 percentage points of B1 AND B2 uses <= 70% of B1's median tokens.
    Otherwise, keep simpler B1 (traceback + grep).
    """
    if result.b2_pass_rate >= result.b1_pass_rate + 0.05:
        return "B2"
    if (
        abs(result.b2_pass_rate - result.b1_pass_rate) < 0.05
        and result.b1_median_tokens > 0
        and result.b2_median_tokens <= 0.70 * result.b1_median_tokens
    ):
        return "B2"
    return "B1"


def _iter_repo_files(repo_root: Path) -> list[str]:
    root = repo_root.resolve()
    rels: list[str] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        if path.suffix not in {".py", ".toml", ".txt", ".cfg", ".ini", ".yaml", ".yml"}:
            continue
        rel = normalize_rel_path(path.relative_to(root).as_posix())
        parts = rel.split("/")
        if any(p in SKIP_DIRS for p in parts[:-1]):
            continue
        rels.append(rel)
    return rels


def _extract_seed_files_and_symbols(
    diagnosis: Diagnosis,
    available_files: set[str],
) -> tuple[list[str], list[str]]:
    ordered_files: list[str] = []
    seen_files: set[str] = set()

    def add_file(candidate: str) -> None:
        norm = normalize_rel_path(candidate)
        if norm in available_files and norm not in seen_files:
            seen_files.add(norm)
            ordered_files.append(norm)
            return
        # Suffix match for absolute CI runner paths like /workspace/pkg/mod.py
        for avail in sorted(available_files):
            if norm.endswith("/" + avail) or norm == avail:
                if avail not in seen_files:
                    seen_files.add(avail)
                    ordered_files.append(avail)
                return

    for f in diagnosis.error_files:
        add_file(f)

    for tid in diagnosis.failing_test_ids:
        path_part = tid.split("::", 1)[0]
        add_file(path_part)

    # Delegate production traceback parsing to AgentSentinel kernel
    frames = extract_traceback_frames(diagnosis.evidence_excerpt, "", allowed_edit_paths=None)
    for frame in frames:
        add_file(frame.file_path)

    # Also extract test paths / file headers (which AgentSentinel intentionally filters out)
    text_blob = f"{diagnosis.error_summary}\n{diagnosis.evidence_excerpt}"
    for m in _FILE_LINE_RE.finditer(text_blob):
        add_file(m.group(1))
    for m in _PYTEST_PATH_RE.finditer(text_blob):
        add_file(m.group(1))

    identifiers: list[str] = []
    seen_id: set[str] = set()
    for ident in _IDENT_RE.findall(text_blob):
        if keyword.iskeyword(ident) or ident in _STOPWORDS:
            continue
        if ident not in seen_id:
            seen_id.add(ident)
            identifiers.append(ident)

    return ordered_files, identifiers


class Localizer:
    """Packs repo context slices deterministically up to a strict token budget."""

    def __init__(
        self,
        repo_root: Path,
        graph_store: CodeGraphStore | None = None,
        max_tokens: int = 4000,
    ) -> None:
        self.repo_root = repo_root.resolve()
        self.graph_store = graph_store
        self.max_tokens = max_tokens

    def _pack_files(
        self,
        method: LocalizationMethod,
        candidate_files: list[str],
        symbols: list[str] | None = None,
    ) -> ContextManifest:
        selected: list[str] = []
        token_counts: dict[str, int] = {}
        total = 0

        for rel in candidate_files:
            file_path = self.repo_root / rel
            if not file_path.is_file():
                continue
            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            tokens = estimate_tokens(content)
            if selected and total + tokens > self.max_tokens:
                continue
            if not selected and tokens > self.max_tokens:
                # Never leave context empty if the top seed file slightly exceeds budget
                tokens = self.max_tokens
            selected.append(rel)
            token_counts[rel] = tokens
            total += tokens
            if total >= self.max_tokens:
                break

        return ContextManifest(
            method=method,
            files=tuple(selected),
            token_counts=token_counts,
            total_tokens=total,
            symbols=tuple(symbols or ()),
        )

    def localize(self, method: LocalizationMethod, diagnosis: Diagnosis) -> ContextManifest:
        all_files = _iter_repo_files(self.repo_root)
        available = set(all_files)

        if method == "B0":
            return self._pack_files("B0", all_files)

        seed_files, identifiers = _extract_seed_files_and_symbols(diagnosis, available)

        # Rank remaining files by deterministic identifier grep frequency
        grep_scores: list[tuple[int, str]] = []
        for rel in all_files:
            if rel in seed_files:
                continue
            try:
                content = (self.repo_root / rel).read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            score = sum(1 for ident in identifiers if ident in content)
            if score > 0:
                grep_scores.append((score, rel))
        grep_scores.sort(key=lambda pair: (-pair[0], pair[1]))
        grep_files = [rel for _, rel in grep_scores]

        if method == "B1":
            ordered = [*seed_files, *grep_files]
            return self._pack_files("B1", ordered, symbols=identifiers)

        # B2: expand seeds + matched symbols across k-hop code graph (callers, callees, tests)
        graph_files: list[str] = []
        graph_symbols: list[str] = list(identifiers)
        if self.graph_store is not None:
            seed_targets = [*seed_files, *identifiers[:8]]
            graph_files = self.graph_store.khop_related_files(seed_targets, hops=3)
            for ident in identifiers[:5]:
                for match in self.graph_store.lookup_symbol(ident, limit=3):
                    if match.qualified_name not in graph_symbols:
                        graph_symbols.append(match.qualified_name)

        merged: list[str] = []
        seen: set[str] = set()
        for rel in [*seed_files, *graph_files, *grep_files]:
            if rel in available and rel not in seen:
                seen.add(rel)
                merged.append(rel)

        return self._pack_files("B2", merged, symbols=graph_symbols)
