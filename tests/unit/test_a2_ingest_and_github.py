"""Milestone A2 TDD tests: Webhook security, loop guards, GitHub App JWT, and log fetch."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from pathlib import Path
from typing import Any

import httpx
import jwt
import pytest
from aegis.github.client import GitHubAppAuth, GitHubClient, GitHubClientError
from aegis.ingest.webhook import IngestConfig, create_webhook_app
from aegis.ledger.store import EventLogStore
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient


def _sign_body(secret: str, body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={mac}"


def _workflow_run_payload(
    *,
    action: str = "completed",
    conclusion: str = "failure",
    branch: str = "main",
    fork: bool = False,
    private: bool = True,
    sender_login: str = "octocat",
    run_id: int = 999001,
    head_sha: str = "abc1234" * 5 + "abcde",
) -> bytes:
    payload = {
        "action": action,
        "installation": {"id": 4242},
        "sender": {"login": sender_login, "type": "User"},
        "repository": {
            "full_name": "acme/python-service",
            "private": private,
            "fork": fork,
        },
        "workflow_run": {
            "id": run_id,
            "name": "CI",
            "run_attempt": 1,
            "head_branch": branch,
            "head_sha": head_sha,
            "conclusion": conclusion,
            "head_repository": {"full_name": "acme/python-service", "fork": fork},
            "pull_requests": [],
            "triggering_actor": {"login": sender_login},
        },
    }
    return json.dumps(payload).encode("utf-8")


@pytest.mark.unit
def test_webhook_rejects_bad_missing_legacy_sig_before_json_parse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = create_webhook_app(
        IngestConfig(webhook_secret="top-secret", db_path=tmp_path / "db.sqlite", app_slug="aegis-ci[bot]")
    )

    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("json.loads must NEVER execute before signature verification!")

    monkeypatch.setattr("aegis.ingest.webhook.json.loads", boom)
    with TestClient(app) as client:
        # Missing signature header with broken JSON body
        r1 = client.post(
            "/webhook",
            content=b"{not-json",
            headers={"X-GitHub-Event": "workflow_run", "X-GitHub-Delivery": "d1"},
        )
        assert r1.status_code == 401

        # Legacy SHA-1 header only (missing X-Hub-Signature-256)
        r2 = client.post(
            "/webhook",
            content=b"{not-json",
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "d2",
                "X-Hub-Signature": "sha1=deadbeef",
            },
        )
        assert r2.status_code == 401

        # Bad SHA-256 signature
        r3 = client.post(
            "/webhook",
            content=b"{not-json",
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "d3",
                "X-Hub-Signature-256": "sha256=" + "0" * 64,
            },
        )
        assert r3.status_code == 401


@pytest.mark.unit
def test_webhook_accepts_failure_dedupes_and_filters_unsafe_events(tmp_path: Path) -> None:
    db_path = tmp_path / "ingest.db"
    secret = "webhook-secret-xyz"
    app = create_webhook_app(
        IngestConfig(webhook_secret=secret, db_path=db_path, app_slug="aegis-ci[bot]")
    )

    with TestClient(app) as client:
        valid_body = _workflow_run_payload()
        resp = client.post(
            "/webhook",
            content=valid_body,
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "deliv-100",
                "X-Hub-Signature-256": _sign_body(secret, valid_body),
            },
        )
        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "queued"
        run_id = data["run_id"]

        # Duplicate delivery ID is ignored cleanly
        dup = client.post(
            "/webhook",
            content=valid_body,
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "deliv-100",
                "X-Hub-Signature-256": _sign_body(secret, valid_body),
            },
        )
        assert dup.status_code == 202
        assert dup.json()["status"] == "duplicate"

        # Fork PR -> skipped
        fork_body = _workflow_run_payload(fork=True, run_id=999002)
        fork_resp = client.post(
            "/webhook",
            content=fork_body,
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "deliv-101",
                "X-Hub-Signature-256": _sign_body(secret, fork_body),
            },
        )
        assert fork_resp.status_code == 202
        assert fork_resp.json()["status"] == "skipped"
        assert "fork" in fork_resp.json()["reason"]

        # Public repo in v1 default -> skipped
        pub_body = _workflow_run_payload(private=False, run_id=999003)
        pub_resp = client.post(
            "/webhook",
            content=pub_body,
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "deliv-102",
                "X-Hub-Signature-256": _sign_body(secret, pub_body),
            },
        )
        assert pub_resp.json()["status"] == "skipped"

        # Own branch aegis/* -> skipped
        own_branch = _workflow_run_payload(branch="aegis/fix/run-1", run_id=999004)
        own_resp = client.post(
            "/webhook",
            content=own_branch,
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "deliv-103",
                "X-Hub-Signature-256": _sign_body(secret, own_branch),
            },
        )
        assert own_resp.json()["status"] == "skipped"

        # Own actor bot -> skipped
        self_actor = _workflow_run_payload(sender_login="aegis-ci[bot]", run_id=999005)
        self_resp = client.post(
            "/webhook",
            content=self_actor,
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "deliv-104",
                "X-Hub-Signature-256": _sign_body(secret, self_actor),
            },
        )
        assert self_resp.json()["status"] == "skipped"

        # Passing workflow_run -> skipped
        pass_body = _workflow_run_payload(conclusion="success", run_id=999006)
        pass_resp = client.post(
            "/webhook",
            content=pass_body,
            headers={
                "X-GitHub-Event": "workflow_run",
                "X-GitHub-Delivery": "deliv-105",
                "X-Hub-Signature-256": _sign_body(secret, pass_body),
            },
        )
        assert pass_resp.json()["status"] == "skipped"

    with EventLogStore(db_path) as store:
        chain = store.verify_chain(run_id, raise_on_error=True)
        assert chain.valid is True
        assert chain.event_count == 1
        queued = store.list_queued_runs()
        assert [q.run_id for q in queued] == [run_id]


@pytest.mark.unit
def test_github_client_jwt_caching_log_fetch_and_no_secret_leak(
    caplog: pytest.LogCaptureFixture,
) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_private = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    public_key = private_key.public_key()

    token_value = "ghs_secret_installation_token_TEST_DUMMY_VALUE"
    token_requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal token_requests
        assert request.headers.get("x-github-api-version") == "2026-03-10"
        if request.url.path == "/app/installations/77/access_tokens":
            token_requests += 1
            auth_header = request.headers.get("authorization", "")
            assert auth_header.startswith("Bearer ")
            decoded = jwt.decode(auth_header.removeprefix("Bearer "), public_key, algorithms=["RS256"])
            assert decoded["iss"] == "555"
            return httpx.Response(
                201,
                json={"token": token_value, "expires_at": "2099-01-01T00:00:00Z"},
            )
        if request.url.path == "/repos/acme/repo/actions/runs/888/jobs":
            assert request.headers.get("authorization") == f"Bearer {token_value}"
            return httpx.Response(
                200,
                json={
                    "jobs": [
                        {"id": 10, "name": "lint", "conclusion": "success"},
                        {"id": 11, "name": "pytest", "conclusion": "failure"},
                    ]
                },
            )
        if request.url.path == "/repos/acme/repo/actions/jobs/11/logs":
            assert request.headers.get("authorization") == f"Bearer {token_value}"
            return httpx.Response(200, text="FAILED tests/test_a.py::test_x - AssertionError\n")
        if request.url.path == "/repos/acme/repo/actions/jobs/999/logs":
            return httpx.Response(500, text="server error")
        return httpx.Response(404)

    caplog.set_level(logging.DEBUG)
    transport = httpx.MockTransport(handler)
    auth = GitHubAppAuth(app_id="555", private_key_pem=pem_private)
    with GitHubClient(auth=auth, transport=transport) as gh:
        logs = gh.fetch_failed_job_logs(owner="acme", repo="repo", installation_id=77, workflow_run_id=888)
        assert list(logs.keys()) == ["pytest"]
        assert "AssertionError" in logs["pytest"]
        # Second call uses cached installation token without hitting access_tokens again
        logs2 = gh.fetch_failed_job_logs(owner="acme", repo="repo", installation_id=77, workflow_run_id=888)
        assert logs2 == logs
        assert token_requests == 1
        with pytest.raises(GitHubClientError):
            gh.fetch_job_log_raw(owner="acme", repo="repo", installation_id=77, job_id=999)

    combined_logs = "\n".join(rec.getMessage() for rec in caplog.records)
    assert token_value not in combined_logs
    assert "BEGIN PRIVATE KEY" not in combined_logs
