"""TDD tests for Milestone A6: Bounded Repair Loop, Governor & Cassettes."""

from __future__ import annotations

import json
import random
import textwrap
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import pytest
from aegis.domain.models import (
    ContextManifest,
    Diagnosis,
    FailureClass,
    RunState,
    SearchReplaceEdit,
    VerificationReport,
)
from aegis.repair.cassettes import CassetteStore, compute_cassette_key
from aegis.repair.diff_utils import (
    DiffValidationError,
    edits_to_unified_diff,
    validate_unified_diff,
)
from aegis.repair.governor import BudgetConfig, BudgetExceededError, BudgetGovernor
from aegis.repair.llm import OpenAICompatibleClient, RecordedReplayClient
from aegis.repair.loop import RepairLoop, RepairLoopConfig


def _sample_repo(root: Path) -> Path:
    (root / "pkg").mkdir(parents=True, exist_ok=True)
    (root / "pkg" / "__init__.py").write_text("", encoding="utf-8")
    (root / "pkg" / "calc.py").write_text(
        textwrap.dedent(
            """\
            def add(a: int, b: int) -> int:
                return a - b
            """
        ),
        encoding="utf-8",
    )
    return root


def _sample_diagnosis() -> Diagnosis:
    return Diagnosis(
        failure_class=FailureClass.F1_TEST_REGRESSION,
        parser="pytest",
        failing_command="pytest",
        error_summary="AssertionError: assert -1 == 5",
        failing_test_ids=("tests/test_calc.py::test_add",),
        error_files=("pkg/calc.py",),
        confidence=0.95,
        evidence_excerpt="E   assert add(2, 3) == 5",
    )


def _sample_manifest() -> ContextManifest:
    return ContextManifest(
        method="B1",
        files=("pkg/calc.py",),
        token_counts={"pkg/calc.py": 20},
        total_tokens=20,
        symbols=("add",),
    )


def test_edits_to_unified_diff_validates_uniqueness_and_git_apply(tmp_path: Path) -> None:
    repo = _sample_repo(tmp_path / "repo")
    edit = SearchReplaceEdit(
        path="pkg/calc.py",
        search="    return a - b",
        replace="    return a + b",
    )
    diff = edits_to_unified_diff(repo, [edit])
    assert "--- a/pkg/calc.py" in diff
    assert "+++ b/pkg/calc.py" in diff
    validate_unified_diff(repo, diff)

    # Ambiguous search block rejected
    (repo / "pkg" / "dup.py").write_text("x = 1\nx = 1\n", encoding="utf-8")
    with pytest.raises(DiffValidationError):
        edits_to_unified_diff(
            repo,
            [SearchReplaceEdit(path="pkg/dup.py", search="x = 1", replace="x = 2")],
        )

    # Path traversal rejected
    with pytest.raises(DiffValidationError):
        edits_to_unified_diff(
            repo,
            [SearchReplaceEdit(path="../outside.py", search="a", replace="b")],
        )


def test_budget_governor_enforces_caps_and_429_backoff(tmp_path: Path) -> None:
    now = 1_700_000_000.0
    slept: list[float] = []

    def fake_clock() -> float:
        return now

    def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    gov = BudgetGovernor(
        tmp_path / "budget.db",
        BudgetConfig(
            max_tokens_per_case=100,
            max_tokens_per_minute=150,
            max_tokens_per_day=200,
            max_attempts_per_case=3,
            base_backoff_seconds=0.5,
            max_backoff_seconds=4.0,
        ),
        clock=fake_clock,
        sleeper=fake_sleep,
        rng=random.Random(42),
    )

    gov.reserve("run-1", 60)
    with pytest.raises(BudgetExceededError) as case_exc:
        gov.reserve("run-1", 50)
    assert case_exc.value.scope == "case"

    # Per-minute cap across cases
    gov.reserve("run-2", 60)
    with pytest.raises(BudgetExceededError) as min_exc:
        gov.reserve("run-3", 40)
    assert min_exc.value.scope == "minute"

    # Advance > 60s resets minute window, but daily cap 200 still holds (120 used)
    now += 65.0
    gov.reserve("run-3", 70)
    with pytest.raises(BudgetExceededError) as day_exc:
        gov.reserve("run-4", 20)
    assert day_exc.value.scope == "daily"

    # Concurrent reservations cannot overshoot cap
    conc_gov = BudgetGovernor(
        tmp_path / "conc.db",
        BudgetConfig(max_tokens_per_case=500, max_tokens_per_minute=100, max_tokens_per_day=100),
    )
    successes = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [
            pool.submit(lambda i=i: conc_gov.reserve(f"c-{i}", 30))
            for i in range(8)
        ]
        for fut in futures:
            try:
                fut.result()
                successes += 1
            except BudgetExceededError:
                pass
    assert successes == 3
    conc_gov.close()

    # Backoff bounds check
    for attempt in range(6):
        delay = gov.compute_backoff_seconds(attempt)
        assert 0.0 < delay <= 4.0
    gov.close()


def test_cassettes_and_openai_client_handle_429_and_zero_token_replay(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret_val = "sk-test-" + "secretkey999"
    monkeypatch.setenv("AEGIS_LLM_API_KEY", secret_val)

    calls = 0
    valid_json = json.dumps(
        {
            "rationale": "Fix subtraction typo in calc.add",
            "edits": [
                {
                    "path": "pkg/calc.py",
                    "search": "    return a - b",
                    "replace": "    return a + b",
                }
            ],
        }
    )

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.headers["Authorization"] == f"Bearer {secret_val}"
        if calls == 1:
            return httpx.Response(429, headers={"Retry-After": "0.01"}, json={"error": "rate"})
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": valid_json}}],
                "usage": {"prompt_tokens": 40, "completion_tokens": 25},
            },
        )

    cassettes = CassetteStore(tmp_path / "cassettes")
    slept: list[float] = []
    gov = BudgetGovernor(
        tmp_path / "gov.db",
        BudgetConfig(max_tokens_per_case=1000, max_tokens_per_minute=1000, max_tokens_per_day=5000),
        sleeper=slept.append,
    )
    client = OpenAICompatibleClient(
        base_url="https://api.example.test",
        governor=gov,
        cassette_store=cassettes,
        transport=httpx.MockTransport(handler),
    )

    messages = [{"role": "user", "content": "fix calc.py"}]
    params: dict[str, Any] = {"temperature": 0.0, "max_tokens": 300}
    resp1 = client.generate(run_id="r-1", model_id="gpt-4.1-mini", messages=messages, params=params)
    assert calls == 2
    assert slept == [0.01]
    assert resp1.cached_replay is False
    assert resp1.prompt_tokens == 40
    assert gov.total_tokens_used() == 65

    # Cassette key exists and zero-token offline replay client works without API key or network
    key = compute_cassette_key("gpt-4.1-mini", params, messages)
    assert cassettes.lookup(key) is not None

    monkeypatch.delenv("AEGIS_LLM_API_KEY", raising=False)
    replay_client = RecordedReplayClient(cassettes)
    resp2 = replay_client.generate(
        run_id="r-1", model_id="gpt-4.1-mini", messages=messages, params=params
    )
    assert resp2.cached_replay is True
    assert resp2.prompt_tokens == 0
    assert resp2.completion_tokens == 0
    assert resp2.raw_content == resp1.raw_content
    assert secret_val not in resp1.raw_content
    gov.close()


def test_repair_loop_retries_schema_and_test_failures_and_stops_within_budget(
    tmp_path: Path,
) -> None:
    repo = _sample_repo(tmp_path / "repo")
    cassettes = CassetteStore(tmp_path / "cassettes")
    gov = BudgetGovernor(tmp_path / "loop_gov.db")

    leaked_secret = "ghp_" + "A" * 36
    observed_prompts: list[str] = []

    class SequenceLLM:
        def __init__(self) -> None:
            self.idx = 0

        def generate(
            self,
            *,
            run_id: str,
            model_id: str,
            messages: list[dict[str, str]],
            params: dict[str, Any],
        ) -> Any:
            from aegis.repair.llm import LLMResponse

            del run_id
            self.idx += 1
            prompt_blob = "\n".join(m["content"] for m in messages)
            observed_prompts.append(prompt_blob)
            if self.idx == 1:
                content = "not valid json {{"
            elif self.idx == 2:
                content = json.dumps(
                    {
                        "rationale": "Wrong operator attempt",
                        "edits": [
                            {
                                "path": "pkg/calc.py",
                                "search": "    return a - b",
                                "replace": "    return a * b",
                            }
                        ],
                    }
                )
            else:
                content = json.dumps(
                    {
                        "rationale": "Fix subtraction to addition",
                        "edits": [
                            {
                                "path": "pkg/calc.py",
                                "search": "    return a - b",
                                "replace": "    return a + b",
                            }
                        ],
                    }
                )
            key = compute_cassette_key(model_id, params, messages)
            cassettes.record(
                key=key,
                model_id=model_id,
                params=params,
                messages=messages,
                raw_content=content,
                prompt_tokens=30,
                completion_tokens=20,
            )
            return LLMResponse(
                model_id=model_id,
                parameter_hash="p",
                prompt_sha256="ps",
                response_sha256=f"rs-{self.idx}",
                raw_content=content,
                prompt_tokens=30,
                completion_tokens=20,
                cached_replay=False,
            )

    def verify_workspace(ws: Path) -> VerificationReport:
        txt = (ws / "pkg" / "calc.py").read_text(encoding="utf-8")
        if "return a + b" in txt:
            return VerificationReport(
                reproduction_runs=1,
                reproduced_failures=1,
                passed_after_patch=True,
                exit_codes_before=(1,),
                exit_codes_after=(0,),
                lint_clean=True,
                typecheck_clean=True,
                execution_notes="1 passed",
            )
        return VerificationReport(
            reproduction_runs=1,
            reproduced_failures=1,
            passed_after_patch=False,
            exit_codes_before=(1,),
            exit_codes_after=(1,),
            lint_clean=False,
            typecheck_clean=False,
            execution_notes=f"FAILED test_add; env token={leaked_secret}",
        )

    loop = RepairLoop(
        llm_client=SequenceLLM(),
        governor=gov,
        verify_fn=verify_workspace,
        config=RepairLoopConfig(max_attempts=3),
    )
    res = loop.run(
        run_id="repair-1",
        repo_root=repo,
        diagnosis=_sample_diagnosis(),
        context_manifest=_sample_manifest(),
    )

    assert res.succeeded is True
    assert res.final_state == RunState.VERIFIED
    assert res.patch is not None
    assert len(res.llm_calls) == 3
    assert len(res.attempts) == 2  # Attempt 1 schema failure was never turned into a patch
    # Original repo was NEVER mutated
    assert "return a - b" in (repo / "pkg" / "calc.py").read_text(encoding="utf-8")
    # Retry prompt after attempt 2 redacted secret before sending to LLM
    assert leaked_secret not in observed_prompts[2]
    assert "[REDACTED" in observed_prompts[2]

    #Replay identical loop offline from cassettes at zero API cost
    replay_loop = RepairLoop(
        llm_client=RecordedReplayClient(cassettes),
        governor=gov,
        verify_fn=verify_workspace,
        config=RepairLoopConfig(max_attempts=3),
    )
    res_replay = replay_loop.run(
        run_id="repair-1-replay",
        repo_root=repo,
        diagnosis=_sample_diagnosis(),
        context_manifest=_sample_manifest(),
    )
    assert res_replay.succeeded is True
    assert res_replay.patch is not None
    assert res_replay.patch.diff_sha256 == res.patch.diff_sha256
    assert all(c.cached_replay for c in res_replay.llm_calls)
    gov.close()


def test_repair_loop_all_invalid_schema_returns_failed(tmp_path: Path) -> None:
    repo = _sample_repo(tmp_path / "repo")
    gov = BudgetGovernor(tmp_path / "fail_gov.db")

    class BrokenLLM:
        def generate(
            self,
            *,
            run_id: str,
            model_id: str,
            messages: list[dict[str, str]],
            params: dict[str, Any],
        ) -> Any:
            from aegis.repair.llm import LLMResponse

            del run_id, messages, params
            return LLMResponse(
                model_id=model_id,
                parameter_hash="p",
                prompt_sha256="ps",
                response_sha256="rs",
                raw_content='{"edits": "wrong-type"}',
                prompt_tokens=10,
                completion_tokens=10,
                cached_replay=False,
            )

    loop = RepairLoop(
        llm_client=BrokenLLM(),
        governor=gov,
        verify_fn=lambda _ws: VerificationReport(reproduction_runs=1, reproduced_failures=1),
        config=RepairLoopConfig(max_attempts=3),
    )
    res = loop.run(
        run_id="repair-bad",
        repo_root=repo,
        diagnosis=_sample_diagnosis(),
        context_manifest=_sample_manifest(),
    )
    assert res.succeeded is False
    assert res.final_state == RunState.FAILED
    assert res.patch is None
    assert len(res.llm_calls) == 3
    assert len(res.attempts) == 0
    gov.close()
