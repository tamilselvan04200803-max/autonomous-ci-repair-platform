"""SQLite incremental code graph store with content-hash caching and k-hop queries."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from aegis.graph.frontend import (
    FileIndexResult,
    LanguageFrontend,
    PythonAstFrontend,
    compute_content_sha256,
    normalize_rel_path,
)

if TYPE_CHECKING:
    from collections.abc import Sequence
    from types import TracebackType

SKIP_DIRS: frozenset[str] = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".pytest_tmp",
        ".mypy_cache",
        ".ruff_cache",
        "dist",
        "build",
    }
)


@dataclass(frozen=True, slots=True)
class IndexStats:
    added_files: int
    updated_files: int
    skipped_files: int
    removed_files: int
    total_nodes: int
    total_edges: int


@dataclass(frozen=True, slots=True)
class SymbolMatch:
    node_id: str
    rel_path: str
    kind: str
    name: str
    qualified_name: str
    start_line: int
    end_line: int
    signature: str


@dataclass(frozen=True, slots=True)
class EdgeRecord:
    src_id: str
    src_qualified_name: str
    src_rel_path: str
    dst_id: str | None
    dst_name: str
    edge_type: str
    resolved: bool
    line_no: int


@dataclass(frozen=True, slots=True)
class ImpactAnalysis:
    seed_nodes: tuple[str, ...]
    impacted_nodes: tuple[str, ...]
    impacted_files: tuple[str, ...]
    affected_test_files: tuple[str, ...]
    affected_tests: tuple[str, ...]


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _should_skip_rel_path(rel_path: str) -> bool:
    parts = normalize_rel_path(rel_path).split("/")
    return any(part in SKIP_DIRS for part in parts[:-1])


class CodeGraphStore:
    """SQLite-backed incremental code graph with deterministic k-hop traversal."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA synchronous=NORMAL;")
        self._conn.execute("PRAGMA foreign_keys=ON;")
        self._init_schema()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def __enter__(self) -> CodeGraphStore:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS files (
                rel_path TEXT PRIMARY KEY,
                module_name TEXT NOT NULL,
                content_sha256 TEXT NOT NULL,
                imports_json TEXT NOT NULL,
                indexed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS nodes (
                node_id TEXT PRIMARY KEY,
                rel_path TEXT NOT NULL,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                qualified_name TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                signature TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS edges (
                edge_id INTEGER PRIMARY KEY AUTOINCREMENT,
                src_id TEXT NOT NULL,
                dst_id TEXT,
                dst_name TEXT NOT NULL,
                edge_type TEXT NOT NULL,
                resolved INTEGER NOT NULL,
                line_no INTEGER NOT NULL,
                rel_path TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_rel_path ON nodes(rel_path);
            CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
            CREATE INDEX IF NOT EXISTS idx_nodes_fqn ON nodes(qualified_name);
            CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
            CREATE INDEX IF NOT EXISTS idx_edges_dst_id ON edges(dst_id);
            CREATE INDEX IF NOT EXISTS idx_edges_dst_name ON edges(dst_name);
            CREATE INDEX IF NOT EXISTS idx_edges_rel_path ON edges(rel_path);
            """
        )
        self._conn.commit()

    def index_repo(
        self,
        repo_root: Path,
        frontend: LanguageFrontend | None = None,
    ) -> IndexStats:
        fe: LanguageFrontend = frontend if frontend is not None else PythonAstFrontend()
        extensions = set(fe.extensions)
        root = repo_root.resolve()

        existing_hashes: dict[str, str] = {
            str(row["rel_path"]): str(row["content_sha256"])
            for row in self._conn.execute("SELECT rel_path, content_sha256 FROM files")
        }

        discovered: dict[str, tuple[Path, str, str]] = {}
        for path in sorted(root.rglob("*")):
            if path.is_symlink() or not path.is_file():
                continue
            if path.suffix not in extensions:
                continue
            rel = normalize_rel_path(path.relative_to(root).as_posix())
            if _should_skip_rel_path(rel):
                continue
            try:
                source = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            sha = compute_content_sha256(source)
            discovered[rel] = (path, source, sha)

        added = 0
        updated = 0
        skipped = 0
        removed = 0
        changed = False

        with self._conn:
            for stale_rel in set(existing_hashes) - set(discovered):
                self._delete_file_entries(stale_rel)
                removed += 1
                changed = True

            for rel, (path, source, sha) in discovered.items():
                old_sha = existing_hashes.get(rel)
                if old_sha == sha:
                    skipped += 1
                    continue
                if old_sha is None:
                    added += 1
                else:
                    self._delete_file_entries(rel)
                    updated += 1
                parsed = fe.parse_file(path, rel, source)
                self._insert_file_result(parsed)
                changed = True

            if changed:
                self._resolve_cross_file_edges()

        node_row = self._conn.execute("SELECT COUNT(*) FROM nodes").fetchone()
        edge_row = self._conn.execute("SELECT COUNT(*) FROM edges").fetchone()
        return IndexStats(
            added_files=added,
            updated_files=updated,
            skipped_files=skipped,
            removed_files=removed,
            total_nodes=int(node_row[0]) if node_row else 0,
            total_edges=int(edge_row[0]) if edge_row else 0,
        )

    def _delete_file_entries(self, rel_path: str) -> None:
        self._conn.execute("DELETE FROM edges WHERE rel_path = ?", (rel_path,))
        self._conn.execute("DELETE FROM nodes WHERE rel_path = ?", (rel_path,))
        self._conn.execute("DELETE FROM files WHERE rel_path = ?", (rel_path,))

    def _insert_file_result(self, result: FileIndexResult) -> None:
        self._conn.execute(
            """
            INSERT INTO files(rel_path, module_name, content_sha256, imports_json, indexed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                result.rel_path,
                result.module_name,
                result.content_sha256,
                json.dumps(result.imports_map, sort_keys=True),
                _utc_now(),
            ),
        )
        for node in result.nodes:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO nodes(
                    node_id, rel_path, kind, name, qualified_name, start_line, end_line, signature
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    node.node_id,
                    node.rel_path,
                    node.kind,
                    node.name,
                    node.qualified_name,
                    node.start_line,
                    node.end_line,
                    node.signature,
                ),
            )
        for edge in result.edges:
            self._conn.execute(
                """
                INSERT INTO edges(
                    src_id, dst_id, dst_name, edge_type, resolved, line_no, rel_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    edge.src_id,
                    edge.dst_id,
                    edge.dst_name,
                    edge.edge_type,
                    1 if edge.resolved else 0,
                    edge.line_no,
                    result.rel_path,
                ),
            )

    def _resolve_cross_file_edges(self) -> None:
        fqn_to_id: dict[str, str] = {}
        for row in self._conn.execute("SELECT node_id, qualified_name FROM nodes"):
            fqn_to_id[str(row["qualified_name"])] = str(row["node_id"])

        edges = self._conn.execute(
            "SELECT edge_id, dst_name, dst_id, resolved FROM edges"
        ).fetchall()
        updates: list[tuple[str | None, int, int]] = []
        for row in edges:
            dst_name = str(row["dst_name"])
            if dst_name.startswith("<dynamic:"):
                continue
            matched = fqn_to_id.get(dst_name)
            if matched is not None:
                updates.append((matched, 1, int(row["edge_id"])))
        if updates:
            self._conn.executemany(
                "UPDATE edges SET dst_id = ?, resolved = ? WHERE edge_id = ?",
                updates,
            )

    def lookup_symbol(
        self,
        query: str,
        *,
        kind: str | None = None,
        limit: int = 20,
    ) -> list[SymbolMatch]:
        needle = query.strip()
        if not needle:
            return []
        sql = """
            SELECT node_id, rel_path, kind, name, qualified_name, start_line, end_line, signature
            FROM nodes
            WHERE (name = ? OR qualified_name = ? OR name LIKE ? OR qualified_name LIKE ?)
        """
        params: list[object] = [needle, needle, f"%{needle}%", f"%{needle}%"]
        if kind is not None:
            sql += " AND kind = ?"
            params.append(kind)
        sql += """
            ORDER BY
                CASE WHEN qualified_name = ? THEN 0
                     WHEN name = ? THEN 1
                     ELSE 2 END,
                qualified_name ASC
            LIMIT ?
        """
        params.extend([needle, needle, limit])
        rows = self._conn.execute(sql, params).fetchall()
        return [
            SymbolMatch(
                node_id=str(r["node_id"]),
                rel_path=str(r["rel_path"]),
                kind=str(r["kind"]),
                name=str(r["name"]),
                qualified_name=str(r["qualified_name"]),
                start_line=int(r["start_line"]),
                end_line=int(r["end_line"]),
                signature=str(r["signature"]),
            )
            for r in rows
        ]

    def _resolve_target_ids(self, symbol: str) -> set[str]:
        rows = self._conn.execute(
            """
            SELECT node_id FROM nodes
            WHERE node_id = ? OR qualified_name = ? OR name = ?
            """,
            (symbol, symbol, symbol),
        ).fetchall()
        return {str(r["node_id"]) for r in rows}

    def find_callers(
        self,
        symbol: str,
        *,
        include_unresolved: bool = False,
        limit: int = 50,
    ) -> list[EdgeRecord]:
        target_ids = sorted(self._resolve_target_ids(symbol))
        targets_json = json.dumps(target_ids)
        rows = self._conn.execute(
            """
            SELECT e.src_id, n.qualified_name AS src_fqn, n.rel_path AS src_rel_path,
                   e.dst_id, e.dst_name, e.edge_type, e.resolved, e.line_no
            FROM edges e
            JOIN nodes n ON e.src_id = n.node_id
            WHERE e.edge_type IN ('calls', 'tests', 'imports')
              AND (
                  e.dst_name = ?
                  OR e.dst_id IN (SELECT value FROM json_each(?))
                  OR e.dst_name IN (SELECT value FROM json_each(?))
              )
              AND (? = 1 OR e.resolved = 1)
            ORDER BY n.qualified_name ASC, e.line_no ASC
            LIMIT ?
            """,
            (symbol, targets_json, targets_json, 1 if include_unresolved else 0, limit),
        ).fetchall()
        return [
            EdgeRecord(
                src_id=str(r["src_id"]),
                src_qualified_name=str(r["src_fqn"]),
                src_rel_path=str(r["src_rel_path"]),
                dst_id=str(r["dst_id"]) if r["dst_id"] is not None else None,
                dst_name=str(r["dst_name"]),
                edge_type=str(r["edge_type"]),
                resolved=bool(r["resolved"]),
                line_no=int(r["line_no"]),
            )
            for r in rows
        ]

    def find_callees(
        self,
        symbol: str,
        *,
        include_unresolved: bool = True,
        limit: int = 50,
    ) -> list[EdgeRecord]:
        src_ids = self._resolve_target_ids(symbol)
        if not src_ids:
            src_ids = {symbol}
        src_json = json.dumps(sorted(src_ids))
        rows = self._conn.execute(
            """
            SELECT e.src_id, n.qualified_name AS src_fqn, n.rel_path AS src_rel_path,
                   e.dst_id, e.dst_name, e.edge_type, e.resolved, e.line_no
            FROM edges e
            JOIN nodes n ON e.src_id = n.node_id
            WHERE e.src_id IN (SELECT value FROM json_each(?))
              AND e.edge_type IN ('calls', 'tests', 'imports')
              AND (? = 1 OR e.resolved = 1)
            ORDER BY e.line_no ASC, e.dst_name ASC
            LIMIT ?
            """,
            (src_json, 1 if include_unresolved else 0, limit),
        ).fetchall()
        return [
            EdgeRecord(
                src_id=str(r["src_id"]),
                src_qualified_name=str(r["src_fqn"]),
                src_rel_path=str(r["src_rel_path"]),
                dst_id=str(r["dst_id"]) if r["dst_id"] is not None else None,
                dst_name=str(r["dst_name"]),
                edge_type=str(r["edge_type"]),
                resolved=bool(r["resolved"]),
                line_no=int(r["line_no"]),
            )
            for r in rows
        ]

    def _seed_node_ids(self, targets: Sequence[str]) -> list[str]:
        seeds: list[str] = []
        seen: set[str] = set()
        for raw in targets:
            norm = normalize_rel_path(raw)
            rows = self._conn.execute(
                """
                SELECT node_id FROM nodes
                WHERE rel_path = ? OR node_id = ? OR qualified_name = ? OR name = ?
                ORDER BY start_line ASC
                """,
                (norm, raw, raw, raw),
            ).fetchall()
            for r in rows:
                nid = str(r["node_id"])
                if nid not in seen:
                    seen.add(nid)
                    seeds.append(nid)
        return seeds

    def _ancestors_in_file(self, node_id: str) -> list[str]:
        """Include enclosing class/module scopes so callers of methods link cleanly."""
        extra: list[str] = []
        queue = deque([node_id])
        seen = {node_id}
        while queue:
            cur = queue.popleft()
            rows = self._conn.execute(
                "SELECT src_id FROM edges WHERE dst_id = ? AND edge_type = 'defines'",
                (cur,),
            ).fetchall()
            for r in rows:
                parent = str(r["src_id"])
                if parent not in seen:
                    seen.add(parent)
                    extra.append(parent)
                    queue.append(parent)
        return extra

    def analyze_impact(
        self,
        targets: Sequence[str],
        *,
        hops: int = 2,
    ) -> ImpactAnalysis:
        seeds = self._seed_node_ids(targets)
        visited: set[str] = set()
        queue: deque[tuple[str, int]] = deque()

        for nid in seeds:
            if nid not in visited:
                visited.add(nid)
                queue.append((nid, 0))

        while queue:
            cur, depth = queue.popleft()
            # Enclosing class/module stays at same depth so calls referencing parent resolve
            for anc in self._ancestors_in_file(cur):
                if anc not in visited:
                    visited.add(anc)
                    queue.append((anc, depth))

            if depth >= hops:
                continue

            rows = self._conn.execute(
                """
                SELECT src_id FROM edges
                WHERE (dst_id = ? OR dst_name = ?)
                  AND edge_type IN ('calls', 'imports', 'tests')
                """,
                (cur, cur),
            ).fetchall()
            for r in rows:
                caller = str(r["src_id"])
                if caller not in visited:
                    visited.add(caller)
                    queue.append((caller, depth + 1))

        if not visited:
            return ImpactAnalysis(
                seed_nodes=tuple(seeds),
                impacted_nodes=(),
                impacted_files=(),
                affected_test_files=(),
                affected_tests=(),
            )

        visited_json = json.dumps(sorted(visited))
        node_rows = self._conn.execute(
            "SELECT node_id, rel_path, kind FROM nodes "
            "WHERE node_id IN (SELECT value FROM json_each(?))",
            (visited_json,),
        ).fetchall()

        impacted_files = sorted({str(r["rel_path"]) for r in node_rows})
        affected_tests = sorted(str(r["node_id"]) for r in node_rows if str(r["kind"]) == "test")
        affected_test_files = sorted(
            {str(r["rel_path"]) for r in node_rows if str(r["kind"]) == "test"}
        )

        return ImpactAnalysis(
            seed_nodes=tuple(seeds),
            impacted_nodes=tuple(sorted(visited)),
            impacted_files=tuple(impacted_files),
            affected_test_files=tuple(affected_test_files),
            affected_tests=tuple(affected_tests),
        )

    def khop_related_files(
        self,
        seed_targets: Sequence[str],
        *,
        hops: int = 2,
    ) -> list[str]:
        """Bidirectional k-hop traversal from failing tests or files into dependencies & callers."""
        seeds = self._seed_node_ids(seed_targets)
        visited_order: list[str] = []
        visited: set[str] = set()
        queue: deque[tuple[str, int]] = deque()

        for nid in seeds:
            if nid not in visited:
                visited.add(nid)
                visited_order.append(nid)
                queue.append((nid, 0))

        while queue:
            cur, depth = queue.popleft()
            if depth >= hops:
                continue

            # Traverse forward (callees/imports/tests/defines) and backward (callers/tests)
            neighbors: list[str] = []
            fwd_rows = self._conn.execute(
                """
                SELECT dst_id, dst_name FROM edges
                WHERE src_id = ? AND edge_type IN ('calls', 'imports', 'tests', 'defines')
                """,
                (cur,),
            ).fetchall()
            for r in fwd_rows:
                target = str(r["dst_id"]) if r["dst_id"] is not None else str(r["dst_name"])
                neighbors.append(target)

            rev_rows = self._conn.execute(
                """
                SELECT src_id FROM edges
                WHERE (dst_id = ? OR dst_name = ?)
                  AND edge_type IN ('calls', 'imports', 'tests', 'defines')
                """,
                (cur, cur),
            ).fetchall()
            for r in rev_rows:
                neighbors.append(str(r["src_id"]))

            for nxt in neighbors:
                if nxt not in visited:
                    # Only enqueue known graph node IDs
                    exists = self._conn.execute(
                        "SELECT 1 FROM nodes WHERE node_id = ? LIMIT 1",
                        (nxt,),
                    ).fetchone()
                    if exists is not None:
                        visited.add(nxt)
                        visited_order.append(nxt)
                        queue.append((nxt, depth + 1))

        file_order: list[str] = []
        seen_files: set[str] = set()
        for nid in visited_order:
            row = self._conn.execute(
                "SELECT rel_path FROM nodes WHERE node_id = ?",
                (nid,),
            ).fetchone()
            if row is not None:
                rel = str(row["rel_path"])
                if rel not in seen_files:
                    seen_files.add(rel)
                    file_order.append(rel)
        return file_order
