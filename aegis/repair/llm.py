"""LLM client protocol, OpenAI-compatible httpx client, and zero-cost cassette replay client."""

from __future__ import annotations

import hashlib
import os
from typing import TYPE_CHECKING, Any, Protocol

import httpx
from pydantic import BaseModel, ConfigDict

from aegis.localization.localizer import estimate_tokens
from aegis.repair.cassettes import (
    CassetteMissError,
    CassetteStore,
    compute_cassette_key,
    hash_messages,
    hash_params,
)

if TYPE_CHECKING:
    from aegis.repair.governor import BudgetGovernor


class LLMClientError(RuntimeError):
    """Raised when an LLM request fails after bounded retries or lacks credentials."""


class LLMResponse(BaseModel):
    """Normalized LLM generation result including provenance hashes and token counts."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    model_id: str
    parameter_hash: str
    prompt_sha256: str
    response_sha256: str
    raw_content: str
    prompt_tokens: int
    completion_tokens: int
    cached_replay: bool = False


class LLMClient(Protocol):
    """Protocol implemented by both live HTTP clients and offline cassette replay clients."""

    def generate(
        self,
        *,
        run_id: str,
        model_id: str,
        messages: list[dict[str, str]],
        params: dict[str, Any],
    ) -> LLMResponse: ...


class RecordedReplayClient:
    """Offline deterministic client reading exclusively from CassetteStore at zero token cost."""

    def __init__(self, cassette_store: CassetteStore) -> None:
        self.cassette_store = cassette_store

    def generate(
        self,
        *,
        run_id: str,
        model_id: str,
        messages: list[dict[str, str]],
        params: dict[str, Any],
    ) -> LLMResponse:
        del run_id
        key = compute_cassette_key(model_id, params, messages)
        entry = self.cassette_store.lookup(key)
        if entry is None:
            raise CassetteMissError(
                f"No recorded cassette found for key={key[:12]} model={model_id}"
            )
        return LLMResponse(
            model_id=entry.model_id,
            parameter_hash=entry.parameter_hash,
            prompt_sha256=entry.prompt_sha256,
            response_sha256=entry.response_sha256,
            raw_content=entry.raw_content,
            prompt_tokens=0,
            completion_tokens=0,
            cached_replay=True,
        )


class OpenAICompatibleClient:
    """OpenAI-compatible chat-completions client with BudgetGovernor and CassetteStore."""

    def __init__(
        self,
        *,
        base_url: str = "https://api.openai.com",
        api_key_env: str = "AEGIS_LLM_API_KEY",
        fallback_api_key_env: str = "OPENAI_API_KEY",
        governor: BudgetGovernor,
        cassette_store: CassetteStore | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key_env = api_key_env
        self.fallback_api_key_env = fallback_api_key_env
        self.governor = governor
        self.cassette_store = cassette_store
        self.transport = transport
        self.timeout = timeout

    def _read_api_key(self) -> str:
        key = os.environ.get(self.api_key_env, "").strip()
        if not key:
            key = os.environ.get(self.fallback_api_key_env, "").strip()
        if not key:
            raise LLMClientError(
                f"Missing API key in env vars {self.api_key_env} / {self.fallback_api_key_env}"
            )
        return key

    def generate(
        self,
        *,
        run_id: str,
        model_id: str,
        messages: list[dict[str, str]],
        params: dict[str, Any],
    ) -> LLMResponse:
        key = compute_cassette_key(model_id, params, messages)
        if self.cassette_store is not None:
            cached = self.cassette_store.lookup(key)
            if cached is not None:
                self.governor.reserve(run_id, 0, cached_replay=True)
                return LLMResponse(
                    model_id=cached.model_id,
                    parameter_hash=cached.parameter_hash,
                    prompt_sha256=cached.prompt_sha256,
                    response_sha256=cached.response_sha256,
                    raw_content=cached.raw_content,
                    prompt_tokens=0,
                    completion_tokens=0,
                    cached_replay=True,
                )

        api_key = self._read_api_key()
        prompt_text = "\n".join(m.get("content", "") for m in messages)
        est_tokens = max(1, estimate_tokens(prompt_text) + int(params.get("max_tokens", 512)))
        reservation_id = self.governor.reserve(run_id, est_tokens, cached_replay=False)

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "response_format": {"type": "json_object"},
            **params,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        max_retries = self.governor.config.max_retries_on_429

        last_status = 0
        with httpx.Client(
            base_url=self.base_url,
            transport=self.transport,
            timeout=self.timeout,
        ) as client:
            for retry_idx in range(max_retries + 1):
                resp = client.post("/v1/chat/completions", json=payload, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    content = str(data["choices"][0]["message"]["content"])
                    usage = data.get("usage", {})
                    p_tok = int(usage.get("prompt_tokens", est_tokens // 2))
                    c_tok = int(usage.get("completion_tokens", estimate_tokens(content)))
                    self.governor.settle_reservation(reservation_id, p_tok + c_tok)
                    if self.cassette_store is not None:
                        entry = self.cassette_store.record(
                            key=key,
                            model_id=model_id,
                            params=params,
                            messages=messages,
                            raw_content=content,
                            prompt_tokens=p_tok,
                            completion_tokens=c_tok,
                        )
                        return LLMResponse(
                            model_id=entry.model_id,
                            parameter_hash=entry.parameter_hash,
                            prompt_sha256=entry.prompt_sha256,
                            response_sha256=entry.response_sha256,
                            raw_content=entry.raw_content,
                            prompt_tokens=p_tok,
                            completion_tokens=c_tok,
                            cached_replay=False,
                        )
                    return LLMResponse(
                        model_id=model_id,
                        parameter_hash=hash_params(params),
                        prompt_sha256=hash_messages(messages),
                        response_sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
                        raw_content=content,
                        prompt_tokens=p_tok,
                        completion_tokens=c_tok,
                        cached_replay=False,
                    )

                last_status = resp.status_code
                if resp.status_code in {429, 502, 503, 504} and retry_idx < max_retries:
                    delay = self.governor.compute_backoff_seconds(
                        retry_idx,
                        retry_after_header=resp.headers.get("Retry-After"),
                    )
                    self.governor.sleep(delay)
                    continue
                break

        raise LLMClientError(f"LLM completion failed with HTTP {last_status}")
