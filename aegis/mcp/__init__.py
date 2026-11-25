"""Strict read-only MCP v2 server exposing code-graph inspection tools."""

from aegis.mcp.server import ALLOWED_READONLY_TOOLS, create_code_graph_mcp_server

__all__ = ["ALLOWED_READONLY_TOOLS", "create_code_graph_mcp_server"]
