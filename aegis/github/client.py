"""GitHub App JWT minting, cached installation tokens, and pinned REST client (A2)."""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
import jwt

GITHUB_API_VERSION = "2026-03-10"
DEFAULT_GITHUB_BASE_URL = "https://api.github.com"


class GitHubClientError(RuntimeError):
    """Raised when GitHub REST interaction fails; never leaks tokens or keys."""


class UnsafeRefError(ValueError):
    """Raised when any write attempt targets a ref outside refs/heads/aegis/."""


def assert_safe_aegis_ref(ref_name: str) -> str:
    """Validate that ref_name is strictly under refs/heads/aegis/ (or aegis/)."""
    normalized = ref_name.strip()
    if normalized.startswith("aegis/"):
        normalized = f"refs/heads/{normalized}"
    if (
        not normalized.startswith("refs/heads/aegis/")
        or ".." in normalized
        or " " in normalized
        or len(normalized) <= len("refs/heads/aegis/")
    ):
        raise UnsafeRefError(f"Ref {ref_name!r} violates refs/heads/aegis/ write boundary")
    return normalized


@dataclass(frozen=True)
class _CachedToken:
    token: str
    expires_at_epoch: float


class GitHubAppAuth:
    """Mints short-lived RS256 GitHub App JWTs; never logs secrets or private keys."""

    def __init__(self, *, app_id: str, private_key_pem: str) -> None:
        if not app_id or not private_key_pem.strip():
            raise ValueError("app_id and private_key_pem must be non-empty")
        self.app_id = app_id
        self._private_key_pem = private_key_pem

    def create_jwt(self, *, now_epoch: int | None = None) -> str:
        now = int(time.time()) if now_epoch is None else now_epoch
        payload: dict[str, Any] = {
            "iat": now - 60,
            "exp": now + 540,
            "iss": self.app_id,
        }
        return jwt.encode(payload, self._private_key_pem, algorithm="RS256")


class GitHubClient:
    """Thin httpx REST client pinned to X-GitHub-Api-Version: 2026-03-10."""

    def __init__(
        self,
        *,
        auth: GitHubAppAuth,
        base_url: str = DEFAULT_GITHUB_BASE_URL,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 20.0,
    ) -> None:
        self._auth = auth
        self._token_cache: dict[int, _CachedToken] = {}
        self._client = httpx.Client(
            base_url=base_url,
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": GITHUB_API_VERSION,
                "User-Agent": "aegis-ci/0.1.0",
            },
            transport=transport,
            timeout=timeout,
            follow_redirects=True,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> GitHubClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _get_installation_token(self, installation_id: int) -> str:
        cached = self._token_cache.get(installation_id)
        now = time.time()
        if cached is not None and cached.expires_at_epoch - 60.0 > now:
            return cached.token

        app_jwt = self._auth.create_jwt()
        resp = self._client.post(
            f"/app/installations/{installation_id}/access_tokens",
            headers={"Authorization": f"Bearer {app_jwt}"},
        )
        if resp.status_code >= 400:
            raise GitHubClientError(
                f"Failed to obtain installation token for installation={installation_id}: "
                f"HTTP {resp.status_code}"
            )
        data = resp.json()
        token = str(data.get("token", ""))
        if not token:
            raise GitHubClientError("Empty installation token received from GitHub")
        expires_raw = str(data.get("expires_at", ""))
        try:
            expires_epoch = datetime.fromisoformat(expires_raw.replace("Z", "+00:00")).timestamp()
        except ValueError:
            expires_epoch = now + 3000.0
        self._token_cache[installation_id] = _CachedToken(
            token=token, expires_at_epoch=expires_epoch
        )
        return token

    def _request_with_token(
        self,
        method: str,
        path: str,
        *,
        installation_id: int,
        json_body: dict[str, Any] | None = None,
    ) -> httpx.Response:
        token = self._get_installation_token(installation_id)
        resp = self._client.request(
            method,
            path,
            headers={"Authorization": f"Bearer {token}"},
            json=json_body,
        )
        if resp.status_code >= 400:
            raise GitHubClientError(
                f"GitHub API {method} {path} failed with HTTP {resp.status_code}"
            )
        return resp

    def list_workflow_jobs(
        self, *, owner: str, repo: str, installation_id: int, workflow_run_id: int
    ) -> list[dict[str, Any]]:
        resp = self._request_with_token(
            "GET",
            f"/repos/{owner}/{repo}/actions/runs/{workflow_run_id}/jobs",
            installation_id=installation_id,
        )
        raw_jobs = resp.json().get("jobs", [])
        if not isinstance(raw_jobs, list):
            return []
        return [dict(j) for j in raw_jobs if isinstance(j, dict)]

    def fetch_job_log_raw(
        self, *, owner: str, repo: str, installation_id: int, job_id: int
    ) -> str:
        resp = self._request_with_token(
            "GET",
            f"/repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
            installation_id=installation_id,
        )
        return resp.text

    def fetch_failed_job_logs(
        self, *, owner: str, repo: str, installation_id: int, workflow_run_id: int
    ) -> dict[str, str]:
        jobs = self.list_workflow_jobs(
            owner=owner,
            repo=repo,
            installation_id=installation_id,
            workflow_run_id=workflow_run_id,
        )
        logs: dict[str, str] = {}
        for job in jobs:
            if str(job.get("conclusion", "")).lower() == "failure":
                job_id = int(job["id"])
                job_name = str(job.get("name", f"job-{job_id}"))
                logs[job_name] = self.fetch_job_log_raw(
                    owner=owner,
                    repo=repo,
                    installation_id=installation_id,
                    job_id=job_id,
                )
        return logs

    def create_git_ref(
        self,
        *,
        owner: str,
        repo: str,
        installation_id: int,
        ref: str,
        sha: str,
    ) -> dict[str, Any]:
        safe_ref = assert_safe_aegis_ref(ref)
        resp = self._request_with_token(
            "POST",
            f"/repos/{owner}/{repo}/git/refs",
            installation_id=installation_id,
            json_body={"ref": safe_ref, "sha": sha},
        )
        return dict(resp.json())

    def create_pull_request(
        self,
        *,
        owner: str,
        repo: str,
        installation_id: int,
        title: str,
        head: str,
        base: str,
        body: str,
        draft: bool = True,
    ) -> dict[str, Any]:
        # Validate head branch belongs to aegis/* namespace before calling GitHub API
        branch_part = head.split(":", 1)[-1]
        assert_safe_aegis_ref(branch_part)
        resp = self._request_with_token(
            "POST",
            f"/repos/{owner}/{repo}/pulls",
            installation_id=installation_id,
            json_body={
                "title": title,
                "head": head,
                "base": base,
                "body": body,
                "draft": draft,
            },
        )
        return dict(resp.json())

    def create_check_run(
        self,
        *,
        owner: str,
        repo: str,
        installation_id: int,
        name: str,
        head_sha: str,
        status: str,
        conclusion: str | None = None,
        summary: str = "",
        title: str = "Aegis-CI Verification",
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": name,
            "head_sha": head_sha,
            "status": status,
            "output": {"title": title, "summary": summary},
        }
        if conclusion is not None:
            payload["conclusion"] = conclusion
        if status == "completed":
            payload["completed_at"] = datetime.now(tz=UTC).isoformat()
        resp = self._request_with_token(
            "POST",
            f"/repos/{owner}/{repo}/check-runs",
            installation_id=installation_id,
            json_body=payload,
        )
        return dict(resp.json())
