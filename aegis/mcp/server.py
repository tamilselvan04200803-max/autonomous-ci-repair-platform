"""Read-only MCP v2 server exposing ONLY graph inspection tools (zero write/exec tools)."""

from __future__ import annotations

import threading
from dataclasses import asdict
from typing import TYPE_CHECKING, Any

from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from mcp.server import MCPServer

if TYPE_CHECKING:
    from aegis.graph.store import CodeGraphStore

ALLOWED_READONLY_TOOLS: frozenset[str] = frozenset(
    {"lookup_symbol", "find_callers", "find_callees", "analyze_impact"}
)

_READONLY_ANNOTATIONS = ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=False,
)


def create_code_graph_mcp_server(store: CodeGraphStore) -> MCPServer:
    """Create a read-only MCPServer bound to a CodeGraphStore instance."""
    store_lock = threading.RLock()
    server = MCPServer(
        name="aegis-code-graph",
        instructions=(
            "Read-only structural query interface for the target repository code graph. "
            "Mutation and execution tools are strictly absent."
        ),
    )

    @server.tool(annotations=_READONLY_ANNOTATIONS)
    def lookup_symbol(
        query: str,
        kind: str | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Look up symbols matching a name or qualified prefix."""
        if not query.strip():
            raise ToolError("query must be non-empty")
        if limit < 1 or limit > 100:
            raise ToolError("limit must be between 1 and 100")
        with store_lock:
            matches = store.lookup_symbol(query, kind=kind, limit=limit)
        return {"matches": [asdict(m) for m in matches]}

    @server.tool(annotations=_READONLY_ANNOTATIONS)
    def find_callers(
        symbol: str,
        include_unresolved: bool = False,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Find all callers, importers, and tests referencing a target symbol."""
        if not symbol.strip():
            raise ToolError("symbol must be non-empty")
        if limit < 1 or limit > 200:
            raise ToolError("limit must be between 1 and 200")
        with store_lock:
            callers = store.find_callers(
                symbol,
                include_unresolved=include_unresolved,
                limit=limit,
            )
        return {"callers": [asdict(c) for c in callers]}

    @server.tool(annotations=_READONLY_ANNOTATIONS)
    def find_callees(
        symbol: str,
        include_unresolved: bool = True,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Find all symbols invoked or imported by a given function, class, or module."""
        if not symbol.strip():
            raise ToolError("symbol must be non-empty")
        if limit < 1 or limit > 200:
            raise ToolError("limit must be between 1 and 200")
        with store_lock:
            callees = store.find_callees(
                symbol,
                include_unresolved=include_unresolved,
                limit=limit,
            )
        return {"callees": [asdict(c) for c in callees]}

    @server.tool(annotations=_READONLY_ANNOTATIONS)
    def analyze_impact(
        targets: list[str],
        hops: int = 2,
    ) -> dict[str, Any]:
        """Compute k-hop impacted symbols, files, and tests for modified files or symbols."""
        if not targets:
            raise ToolError("targets must be non-empty")
        if hops < 1 or hops > 5:
            raise ToolError("hops must be between 1 and 5")
        with store_lock:
            impact = store.analyze_impact(targets, hops=hops)
        return asdict(impact)

    return server
