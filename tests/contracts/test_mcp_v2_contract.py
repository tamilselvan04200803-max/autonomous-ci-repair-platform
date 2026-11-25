"""Contract tests verifying pinned mcp==2.3.0 MCPServer v2 API surface."""

from __future__ import annotations

import json

import anyio
import pytest
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from mcp.server import MCPServer


def test_mcp_v2_server_registers_readonly_tools_and_calls_them() -> None:
    server = MCPServer("contract-check")

    @server.tool(
        annotations=ToolAnnotations(
            read_only_hint=True,
            destructive_hint=False,
            idempotent_hint=True,
            open_world_hint=False,
        )
    )
    def lookup_echo(name: str) -> dict[str, str]:
        """Return the queried name."""
        if not name:
            raise ToolError("name must be non-empty")
        return {"symbol": name}

    async def exercise() -> None:
        tools = await server.list_tools()
        assert [tool.name for tool in tools] == ["lookup_echo"]
        assert tools[0].annotations is not None
        assert tools[0].annotations.read_only_hint is True

        result = await server.call_tool("lookup_echo", {"name": "calc"})
        assert result.is_error is False
        assert result.content
        payload = json.loads(result.content[0].text)
        assert payload == {"symbol": "calc"}

        with pytest.raises(ToolError):
            await server.call_tool("lookup_echo", {"name": ""})

        with pytest.raises(ToolError):
            await server.call_tool("nonexistent_mutator", {})

    anyio.run(exercise)
