# Aegis-CI Implementation Progress & Master To-Do Ledger

**Current Branch:** `feat/aegis-ci-v1` (cut from `main` @ `15ca5c2`)
**Last Updated:** 2026-11-25
**Master Plan:** [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md)
**Audit Baseline:** [`docs/REPO_AUDIT.md`](docs/REPO_AUDIT.md)

---

## Current Status Summary

- **Aegis Forge (Existing Next.js / TypeScript UI & Runner):** Green (`npm test` 9/9, `npm run bench` 8/8, `tsc --noEmit` 0 errors, `eslint src` clean).
- **AgentSentinel Kernel (`C:\Users\tamil\Downloads\agentsenitnel\agent_sentinel`):** Audited live. `ruff check` & `mypy --strict` pass on all 67 files; `1510` non-Docker unit/adversarial tests pass (1 Windows symlink skip; 14 require live Docker Desktop daemon).
- **Aegis-CI Control Plane (`aegis/` package in this workspace):** Milestones **A0 through A10** complete and verified on `feat/aegis-ci-v1`.

---

## Next Immediate Steps

1. Review `feat/aegis-ci-v1` diff against `main` (`15ca5c2`) and merge/PR when authorized by the maintainer.
2. Optional post-v1.0.0 stretch items: Tree-sitter JS/TS frontend (`S1`), pinned OTel export (`S2`), and Tier B real-world cases (`S3`).

---

## Long Implementation To-Do Checklist (A0–A10)

### Milestone A0 — Audit & Environment Scaffolding
- [x] Freeze Master Plan to `docs/MASTER_PLAN.md`
- [x] Add `.gitattributes` enforcing `* text=auto eol=lf` for Windows/Docker parity
- [x] Update `.gitignore` for Python `.venv/`, SQLite DBs, caches, and scratch artifacts
- [x] Update `AGENTS.md` with Section 10 Aegis-CI engineering rules while preserving existing rules
- [x] Create `pyproject.toml` with strict `ruff`, `mypy --strict`, `pytest`, and exact dependency versions
- [x] Write `docs/REPO_AUDIT.md` (module map, DB schema, sandbox flags, skips analysis, Windows issues, gaps G1..G14, baseline logs)
- [x] Finish `.venv` install and verify editable install `-e .` + `-e AgentSentinel`
- [x] Record exact resolved versions in `VERSIONS.md` and `requirements-py.lock`
- [x] Add `scripts/check_secrets.py` pre-commit secret scanner
- [x] Verify baseline gates: `ruff`, `mypy --strict`, `pytest`, and existing `npm test` / `npm run bench`

### Milestone A1 — Domain Model & Hash-Chained Event Log
- [x] Write `tests/contracts/test_pydantic_v2_contract.py` (frozen, `model_validate_json`, `model_dump(mode="json")`)
- [x] Create `aegis/__init__.py` & `aegis/domain/models.py` (`RunState`, `FailureClass`, `FailureEvent`, `Diagnosis`, `ContextManifest`, `SearchReplaceEdit`, `Patch`, `VerificationReport`, `PolicyDecision`, `LLMCallRecord`, `ToolVersions`, `EvidenceBundle`)
- [x] Enforce unidirectional import invariant test (`agentsentinel` never imported backwards or mutated; `aegis` -> `agentsentinel`)
- [x] Write failing TDD tests `tests/unit/test_a1_domain_and_chain.py` (chain tamper detection per-byte on payload/seq/prev_hash/hash, subprocess kill-9 mid-run & resume from checkpoint, JSON bundle round-trip)
- [x] Implement `aegis/ledger/store.py` (SQLite WAL, `runs`, hash-chained `events` table using canonical JCS JSON, `verify_chain(run_id)`, `export_bundle_json`, checkpoint resume)
- [x] Run ruff, `mypy --strict`, pytest & verify all A1 acceptance criteria pass

### Milestone A2 — GitHub Webhook Ingest & App Client
- [x] Write `tests/contracts/test_fastapi_contract.py`, `tests/contracts/test_pyjwt_contract.py`, `tests/contracts/test_httpx_contract.py` (with docs URLs)
- [x] Write failing TDD tests `tests/unit/test_a2_ingest_and_github.py` (valid signature, bad sig, legacy SHA-1 only, missing header, duplicate delivery ID, fork PR skip, `aegis/*` branch skip, non-failure conclusion skip, self app ID loop skip, JWT RS256 caching/refresh, `X-GitHub-Api-Version: 2026-03-10`, failed job log fetch, zero token leakage in logs)
- [x] Implement `aegis/ingest/webhook.py` (FastAPI `/webhook`, raw bytes HMAC-SHA256 via `hmac.compare_digest` before JSON parse, SQLite delivery dedup & queue, HTTP 202)
- [x] Implement `aegis/github/client.py` (`GitHubAppAuth` RS256 JWT + cached installation token, `GitHubClient` on `httpx` pinned to `2026-03-10`, log fetcher & redaction-safe error handling)
- [x] Run ruff, `mypy --strict`, pytest & verify all A2 acceptance criteria pass

### Milestone A3 — Deterministic Triage Parsers & Flake Detection
- [x] Create golden corpus under `tests/fixtures/triage_corpus/` (>=15 real-format logs per tool: `pytest`, `ruff`, `mypy`, `pip`, plus `unclassified` cases)
- [x] Write failing TDD tests `tests/unit/test_a3_triage_and_redactor.py` (redactor ANSI/secret stripping & `UNTRUSTED_DATA` wrapping, `--junitxml` parser, pytest console fallback, ruff, mypy, pip resolver, `UNCLASSIFIED` on unknown/deploy errors, flake check `k` reruns mixed pass/fail -> `F5` never patch)
- [x] Implement `aegis/triage/redactor.py` (ANSI strip, token/key redaction, bounded truncate, untrusted wrapper)
- [x] Implement `aegis/triage/parsers.py` (`parse_junit_xml`, `parse_pytest_log`, `parse_ruff_log`, `parse_mypy_log`, `parse_pip_log`, `triage_failure`)
- [x] Implement `aegis/triage/flake.py` (`detect_flaky_failure` rerunning failed tests k times)
- [x] Run ruff, `mypy --strict`, pytest & verify 100% classification accuracy across >=60 corpus logs

### Milestone A4 — Two-Phase Reproduction Sandbox (Tar Stream & AgentSentinel Bridge)
- [x] Write `tests/contracts/test_tarfile_container_contract.py` and failing tests `tests/unit/test_a4_sandbox.py`
- [x] Implement `aegis/sandbox/tar_stream.py` (in-memory deterministic POSIX LF tar builder excluding `.git`, `.env*`, secrets, symlinks, hardlinks)
- [x] Implement `aegis/sandbox/runner.py`:
  - `PrepareConfig` / `prepare_environment` (network limited to configured package index, lockfile SHA-256 image cache key)
  - `RunConfig` / `AegisSandboxRunner` integrating `agentsentinel.sandbox.HardenedContainerRunner` flags (`--network=none`, `--read-only`, `--tmpfs`, `--user 65534:65534`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, PIDs/memory/CPU limits) + tar-stream workspace delivery (no Windows bind mount issues!)
  - Multi-run baseline reproducer (`reproduce_baseline` k times -> `VerificationReport`)
- [x] Include isolated live/simulated container flag assertions, socket-failure probe test, fork-bomb/memory-limit test spec (`tests/integration/test_a4_docker_live.py`), and Windows LF preservation test
- [x] Run ruff, `mypy --strict`, pytest & verify all A4 acceptance criteria pass

### Milestone A5 — Code Graph, Localizer, Experiment & MCP v2 Server
- [x] Write `tests/contracts/test_mcp_v2_contract.py` proving `from mcp.server import MCPServer` works on pinned `mcp==2.3.0`
- [x] Write failing TDD tests `tests/unit/test_a5_graph_and_mcp.py`
- [x] Implement `aegis/graph/frontend.py` (`LanguageFrontend` Protocol + `PythonAstFrontend` using stdlib `ast` extracting module/class/function/test nodes + imports/defines/calls [with `resolved: bool` flag] + test-to-target edges)
- [x] Implement `aegis/graph/store.py` (SQLite incremental indexer keyed by SHA-256 content hash + k-hop query helpers)
- [x] Implement `aegis/localization/localizer.py` (B0 whole-repo, B1 traceback+grep using `agentsentinel.localization.traceback_parser`, B2 k-hop graph context, token-budgeted `ContextManifest`)
- [x] Implement `aegis/mcp/server.py` (Read-only `MCPServer` exposing ONLY `lookup_symbol`, `find_callers`, `find_callees`, `analyze_impact`; test asserts zero mutating tools exist)
- [x] Run localization experiment B0 vs B1 vs B2 script after Tier A cases exist in A9 (`docs/measurements/localization_experiment.json`: B0=1.000/149 tok, B1=0.964/70 tok, B2=0.964/70 tok -> Selected `B1` per Section 7.5)
- [x] Run ruff, `mypy --strict`, pytest & verify A5 passes (26 passed, 23 mypy files clean)

### Milestone A6 — Bounded Repair Loop, Governor & Cassettes
- [x] Write failing TDD tests `tests/unit/test_a6_repair_loop.py`
- [x] Implement `aegis/repair/models.py` & `diff_utils.py` (`SearchReplaceEdit` -> unified diff converter + `git apply --check` validator + schema checks)
- [x] Implement `aegis/repair/cassettes.py` (record/replay cassette store keyed by `sha256(model + params + messages)` with zero-token deterministic replay)
- [x] Implement `aegis/repair/governor.py` (`BudgetGovernor` enforcing per-case cap, per-minute cap, daily cap in SQLite + bounded 429 exponential backoff with jitter; property/unit tests proving caps cannot be exceeded)
- [x] Implement `aegis/repair/llm.py` (`LLMClient` Protocol + `OpenAICompatibleClient` using `httpx` & env keys + `RecordedReplayClient`)
- [x] Implement `aegis/repair/loop.py` (`RepairLoop` max N attempts [default 3], redacted truncated retry feedback, schema violation retries -> `FAILED`, never applies invalid diffs)
- [x] Run ruff, `mypy --strict`, pytest & verify A6 passes (31 passed, 30 mypy files clean)

### Milestone A7 — YAML-Configured Policy Gate (P1–P8)
- [x] Create `config/policy.yaml` documenting default rules P1..P8
- [x] Write failing TDD tests `tests/unit/test_a7_policy_gate.py` with **>=2 allow AND >=2 deny fixtures per rule P1..P8**
- [x] Implement `aegis/policy/config.py` (YAML loader + Pydantic validation)
- [x] Implement `aegis/policy/ast_test_integrity.py` (AST diff of base vs patched tests: test IDs must not shrink, per-test assert count must not drop, no added `skip`/`skipif`/`xfail`/`importorskip`, no tautology asserts, test-only patch -> `ESCALATE`)
- [x] Implement `aegis/policy/gate.py` evaluating P1 (path deny w/ F4 lockfile exception & homoglyph/traversal/symlink checks), P2 (AST test integrity), P3 (diff budget 3 files / 60 lines), P4 (AST dangerous constructs + AgentSentinel `verify_not_overfitted`), P5 (secret scan), P6 (required evidence), P7 (confidence threshold -> diagnosis-only), P8 (depth limit 1)
- [x] Run ruff, `mypy --strict`, pytest & verify 100% of allow/deny fixtures behave as specified (39 passed, 1 Windows symlink skip, 34 mypy files clean)

### Milestone A8 — Guarded GitHub Deliverer & Pipeline Orchestrator
- [x] Write failing TDD tests `tests/unit/test_a8_deliverer_and_e2e.py` (assert `UnsafeRefError` outside `refs/heads/aegis/*`, `AEGIS_ENABLED` kill switch, repo allowlist, webhook idempotency preventing duplicate PRs, full PR markdown body fields including hash-chain head, check run payload, full end-to-end pipeline `RECEIVED -> DELIVERED/REFUSED/ESCALATED/FAILED` with crash resume)
- [x] Implement `aegis/delivery/deliverer.py` (strict ref wrapper `refs/heads/aegis/*`, draft PR formatter, check run poster, idempotency table, kill switch + allowlist)
- [x] Implement `aegis/orchestrator/pipeline.py` (full Master Plan Section 4 pipeline integrating Ingest -> Triage -> Sandbox -> Localize -> Repair -> Policy Gate -> Deliverer + hash-chained event logging at every transition)
- [x] Implement `aegis/cli.py` (`aegis-ci` CLI subcommands: `webhook`, `run`, `verify-chain`, `export`, `bench`, `status`)
- [x] Run ruff, `mypy --strict`, pytest & verify A8 passes (restored A7 `PolicyGate` contract and fixed A8 lint/type/integration issues)

### Milestone A9 — Hermetic Benchmark (Tier A >=40), Adversarial Suite (>=12) & Reports
- [x] Create `benchmarks/aegis_ci/tier_a/` with **42 hermetic cases**:
  - 14 logic bugs (`FIX`)
  - 8 lint/type/format (`ruff`/`mypy`, `FIX`)
  - 6 dependency / vendored API drift (`FIX`)
  - 6 flaky cases (`REFUSE` / flag flaky)
  - 4 environment-unfixable (`REFUSE`)
  - 4 ambiguous / multi-file budget-exceeding (`ESCALATE`)
  (Each with `repo/`, `visible_ci.sh`, `hidden_tests/`, `oracle.patch`, `cheat.patch`, `meta.yaml`, and SHA-256 replay cassette!)
- [x] Create `benchmarks/aegis_ci/adversarial/` with **13 adversarial cases** covering every attack vector listed in Section 7.2 (log injection, docstring injection, commit message injection, PR HTML comment injection, skip-test bait, weaken-assertion bait, workflow edit bait, typosquatted dependency bait, env-exfil bait, oversized diff, own-PR loop bait, homoglyph path, symlink escape patch)
- [x] Implement `scripts/validate_benchmarks.py` mechanically validating all Tier A cases (base fails visible, oracle passes visible + hidden & passes Gate P1-P8, cheat passes visible where applicable and fails Gate or hidden!)
- [x] Implement `aegis/bench/metrics.py` & `aegis/bench/runner.py` (replay mode zero-token runner, Wilson 95% intervals, ablations: Gate ON/OFF, Localization B0/B1/B2, Attempts 1/2/3)
- [x] Execute B0 vs B1 vs B2 localization experiment across Tier A and apply Section 7.5 pre-registered rule cleanly (`docs/measurements/localization_experiment.json`)
- [x] Execute `scripts/generate_report.py` generating `benchmarks/results/tier_a_replay.json` & injecting verified tables into `docs/AEGIS_CI.md`
- [x] Add `Makefile` supporting `make bench-replay`, `make report`, `make verify` (plus Python entrypoint equivalents for Windows!)
- [x] Verify 0% attack success rate (0/13) with Gate ON vs 100% (13/13) Gate OFF!

### Milestone A10 — Package, Docs, Docker Demo, Fresh Review & Final Release Verification
- [x] Update `CLAIMS.md` linking every public claim to exact files & verification commands
- [x] Update `SECURITY.md` with Rule-of-Two architecture, Smee/Docker honest limits, and threat model
- [x] Create `Dockerfile.aegis` and `docker-compose.aegis.yml` for containerized demo stack
- [x] Create `scripts/demo_e2e.py` (self-contained local end-to-end simulation script exercising full pipeline + bundle tamper failure + verification!)
- [x] Update `README.md` / `docs/AEGIS_CI.md` with Mermaid architecture diagram and script-generated metrics tables (strictly matching `benchmarks/results/tier_a_replay.json`)
- [x] Add `.github/workflows/aegis-ci.yml` for Python control-plane CI (`ruff`, `mypy --strict`, `pytest`, secret check, `bench-replay`)
- [x] Dispatch fresh code reviewer / verification across branch (`main..HEAD`)
- [x] Fix every Critical/Important review finding with TDD RED->GREEN, debug edge cases, re-verify full suite (`ruff`, `mypy --strict`, `pytest`, `validate_benchmarks.py`, `bench-replay`, `generate_report.py`, `check_secrets.py`, plus `npm test`, `npm run bench`, `npm run typecheck`, `npm run lint`, `npm run build`)
- [x] Finalize `HANDOVER.md` & mark `progress.md` 100% complete!
