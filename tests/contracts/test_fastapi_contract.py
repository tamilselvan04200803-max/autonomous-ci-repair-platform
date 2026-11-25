"""Contract test for FastAPI raw request body and HTTP 202 status handling.

Docs URL: https://fastapi.tiangolo.com/reference/request/
Docs URL: https://fastapi.tiangolo.com/reference/status/
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request, Response, status
from fastapi.testclient import TestClient


@pytest.mark.contract
def test_fastapi_raw_body_and_202_contract() -> None:
    app = FastAPI()

    @app.post("/raw", status_code=status.HTTP_202_ACCEPTED)
    async def receive_raw(request: Request) -> Response:
        raw = await request.body()
        return Response(content=raw, status_code=status.HTTP_202_ACCEPTED, media_type="text/plain")

    with TestClient(app) as client:
        resp = client.post("/raw", content=b"unparsed{bytes")
        assert resp.status_code == 202
        assert resp.content == b"unparsed{bytes"
