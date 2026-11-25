"""FastAPI GitHub webhook receiver with strict pre-parse HMAC-SHA256 verification (A2)."""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from aegis.domain.models import FailureEvent, RunState
from aegis.ledger.store import EventLogStore

if TYPE_CHECKING:
    from pathlib import Path


@dataclass(frozen=True)
class IngestConfig:
    """Configuration for FastAPI webhook ingress."""

    webhook_secret: str
    db_path: Path
    app_slug: str = "aegis-ci[bot]"
    allow_public_repos: bool = False


def verify_webhook_signature(secret: str, raw_body: bytes, signature_header: str | None) -> bool:
    """Verify GitHub X-Hub-Signature-256 on raw request bytes via constant-time compare."""
    if not secret or not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header.strip())


def _is_fork_workflow_run(payload: dict[str, Any]) -> bool:
    repo_obj = payload.get("repository") or {}
    if isinstance(repo_obj, dict) and repo_obj.get("fork") is True:
        return True
    wf = payload.get("workflow_run") or {}
    if isinstance(wf, dict):
        head_repo = wf.get("head_repository") or {}
        if isinstance(head_repo, dict) and head_repo.get("fork") is True:
            return True
        prs = wf.get("pull_requests") or []
        if isinstance(prs, list):
            for pr in prs:
                if isinstance(pr, dict):
                    head_pr_repo = ((pr.get("head") or {}).get("repo")) or {}
                    if isinstance(head_pr_repo, dict) and head_pr_repo.get("fork") is True:
                        return True
    return False


def _skip_reason(payload: dict[str, Any], config: IngestConfig, event_name: str) -> str | None:
    if event_name != "workflow_run":
        return f"ignored_event:{event_name}"
    action = str(payload.get("action", ""))
    if action != "completed":
        return f"ignored_action:{action}"
    wf = payload.get("workflow_run")
    if not isinstance(wf, dict):
        return "missing_workflow_run"
    conclusion = str(wf.get("conclusion", ""))
    if conclusion != "failure":
        return f"ignored_conclusion:{conclusion}"
    if _is_fork_workflow_run(payload):
        return "skipped_fork_pr"
    repo_obj = payload.get("repository") or {}
    is_private = isinstance(repo_obj, dict) and bool(repo_obj.get("private", False))
    if not is_private and not config.allow_public_repos:
        return "skipped_public_repo_in_v1"
    head_branch = str(wf.get("head_branch", ""))
    if head_branch.startswith("aegis/"):
        return "skipped_own_branch_loop_guard"
    sender = (payload.get("sender") or {}).get("login", "")
    trig = (wf.get("triggering_actor") or {}).get("login", "")
    if config.app_slug and (sender == config.app_slug or trig == config.app_slug):
        return "skipped_own_actor_loop_guard"
    return None


def create_webhook_app(config: IngestConfig) -> FastAPI:
    """Build FastAPI webhook app enforcing signature verification before parsing."""
    app = FastAPI(title="Aegis-CI Webhook Receiver", version="0.1.0")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/webhook", status_code=status.HTTP_202_ACCEPTED)
    async def handle_webhook(request: Request) -> JSONResponse:
        # Step 1: Read raw bytes and verify HMAC-SHA256 BEFORE any JSON parsing
        raw_body = await request.body()
        sig_256 = request.headers.get("X-Hub-Signature-256")
        if not verify_webhook_signature(config.webhook_secret, raw_body, sig_256):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "invalid_or_missing_signature"},
            )

        delivery_id = (request.headers.get("X-GitHub-Delivery") or "").strip()
        event_name = (request.headers.get("X-GitHub-Event") or "").strip()
        if not delivery_id:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error": "missing_delivery_id"},
            )

        payload_hash = hashlib.sha256(raw_body).hexdigest()
        try:
            parsed_obj = json.loads(raw_body.decode("utf-8"))
        except Exception:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error": "invalid_json_payload"},
            )
        if not isinstance(parsed_obj, dict):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error": "payload_must_be_object"},
            )

        wf_obj = parsed_obj.get("workflow_run")
        wf_run_id = int(wf_obj["id"]) if isinstance(wf_obj, dict) and "id" in wf_obj else None

        reason = _skip_reason(parsed_obj, config, event_name)
        with EventLogStore(config.db_path) as store:
            is_new = store.record_delivery_if_new(
                delivery_id=delivery_id,
                workflow_run_id=wf_run_id,
                status="skipped" if reason else "queued",
                payload_sha256=payload_hash,
            )
            if not is_new:
                return JSONResponse(
                    status_code=status.HTTP_202_ACCEPTED,
                    content={"status": "duplicate", "delivery_id": delivery_id},
                )
            if reason is not None:
                return JSONResponse(
                    status_code=status.HTTP_202_ACCEPTED,
                    content={"status": "skipped", "reason": reason, "delivery_id": delivery_id},
                )

            assert isinstance(wf_obj, dict)
            repo_full = str((parsed_obj.get("repository") or {}).get("full_name", ""))
            run_attempt = int(wf_obj.get("run_attempt", 1))
            run_key = f"gh-{wf_obj['id']}-{run_attempt}"
            inst_id = int(((parsed_obj.get("installation") or {}).get("id")) or 0)
            actor_login = str((parsed_obj.get("sender") or {}).get("login", ""))
            failure_event = FailureEvent(
                run_id=run_key,
                repo=repo_full,
                workflow_run_id=int(wf_obj["id"]),
                run_attempt=run_attempt,
                head_sha=str(wf_obj["head_sha"]),
                base_branch=str(wf_obj.get("head_branch", "main")),
                delivery_id=delivery_id,
                is_fork=False,
                actor=actor_login,
                workflow_name=str(wf_obj.get("name", "")),
            )
            store.init_run(
                run_key,
                state=RunState.RECEIVED,
                meta={
                    "repo": repo_full,
                    "installation_id": inst_id,
                    "failure_event": failure_event.model_dump(mode="json"),
                },
            )
            store.append_event(
                run_key,
                "RECEIVED",
                {
                    "delivery_id": delivery_id,
                    "payload_sha256": payload_hash,
                    "workflow_run_id": failure_event.workflow_run_id,
                    "run_attempt": run_attempt,
                    "head_sha": failure_event.head_sha,
                },
                new_state=RunState.RECEIVED,
            )

        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={"status": "queued", "run_id": run_key, "delivery_id": delivery_id},
        )

    return app
