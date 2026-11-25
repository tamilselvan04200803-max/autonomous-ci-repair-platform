"""Contract test for httpx MockTransport and persistent header forwarding.

Docs URL: https://www.python-httpx.org/advanced/transports/
"""

from __future__ import annotations

import httpx
import pytest


@pytest.mark.contract
def test_httpx_mock_transport_headers_contract() -> None:
    seen_headers: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.update(dict(request.headers))
        return httpx.Response(200, json={"ok": True})

    with httpx.Client(
        base_url="https://api.github.com",
        headers={"X-GitHub-Api-Version": "2026-03-10", "Accept": "application/vnd.github+json"},
        transport=httpx.MockTransport(handler),
    ) as client:
        resp = client.get("/rate_limit")
        assert resp.status_code == 200
        assert seen_headers.get("x-github-api-version") == "2026-03-10"
