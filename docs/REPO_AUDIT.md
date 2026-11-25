# Aegis-CI & AgentSentinel Repository Audit (Milestone A0)

**Date:** 2026-11-25
**Plan Reference:** `docs/MASTER_PLAN.md` (v1.0, scope frozen)
**Audited Repositories:**
1. **Aegis Forge Control Plane Workspace:** `c:\Users\tamil\OneDrive\Documents\projects\autonomous-ci-repair-platform` (branch base `main` @ `15ca5c2`, Next.js 16.4.3 / TypeScript 5.9.3 / PostgreSQL + Drizzle ORM + `runner/aegis.mjs`)
2. **AgentSentinel Verification Kernel:** `C:\Users\tamil\Downloads\agentsenitnel\agent_sentinel` (`tamilselvan04200803-max/agentsentinel`, `main` @ `c88a0cf`, Python 3.11–3.13)

---

## 1. Architectural Relationship Verdict

AgentSentinel is confirmed to be the Python verification kernel (hardened Docker sandbox, SQLite WAL `CheckpointStore`, deterministic bounded repair loop `RepairStateMachine`, AST `OverfitGuard`, `PatchPolicyValidator`, JCS/DSSE provenance, differential mutation adequacy, strict-v1 solver).
`autonomous-ci-repair-platform` hosts the Aegis Forge web control plane (`src/`) and standalone Node verifier (`runner/aegis.mjs`). Following `docs/MASTER_PLAN.md` Section 0 & Section 4, the Python **Aegis-CI** control plane package (`aegis/`) is co-hosted cleanly in this workspace while importing `agentsentinel` strictly one-way (`aegis` imports `agentsentinel`, never the reverse). Notice that on disk and in `pyproject.toml`, the Python package name exported by AgentSentinel is `agentsentinel` (`src/agentsentinel/`).

---

## 2. Module Map

### 2A. AgentSentinel Kernel (`C:\Users\tamil\Downloads\agentsenitnel\agent_sentinel\src\agentsentinel\`)

| Module | Responsibilities | Key Symbols |
|---|---|---|
| `__init__.py` | Package version metadata | `__version__` |
| `domain/models.py` | Frozen dataclasses for case, diff, execution, evidence | `CaseSpec`, `PatchProposal`, `ExecutionResult`, `EvidenceBundle`, `MinimizationSummary`, `MutationAdequacySummary` |
| `domain/exceptions.py` | Typed error hierarchy (policy, overfit, timeout, infra, approval) | `AgentSentinelError`, `HarnessSetupError`, `HarnessTimeoutError`, `PatchPolicyError`, `OverfitPolicyError`, `PathTraversalError`, `SymlinkEscapeError`, `TestFileModificationError`, `ApprovalIntegrityError` |
| `domain/exit_codes.py` | Numeric process exit code classification | `ExitCode` (`OK=0`, `TESTS_FAILED=1`), `classify`, `is_harness_broken` |
| `sandbox/container.py` | Hardened Docker execution runner | `ContainerConfig`, `HardenedContainerRunner`, `resolve_image_digest`, `DEFAULT_IMAGE="agentsentinel-runner:py311"` |
| `sandbox/intake.py` | Symlink/hardlink/traversal-safe bounded regular file reader & snapshot copy | `relative_path`, `excluded_path`, `FileAdmission`, `InputManifest`, `IntakeLimits`, `safe_read`, `copy_snapshot` |
| `sandbox/workspace.py` | Ephemeral workspace creation, Windows read-only `.git` pack cleanup, full `.git` history removal | `WorkspaceManager`, `WorkspaceContext`, `_WindowsSafeTemporaryDirectory` |
| `sandbox/strict_probe.py` | Restricted native/seccomp formal probe runner | `strict_v1` profile runner (`64` PIDs, `<=30s`, `128 MiB`) |
| `orchestrator/checkpoint.py` | SQLite WAL durable store for repair runs & attempts | `CheckpointStore`, `RunRecord`, `AttemptRecord`, `RunState`, `AttemptStatus`, `TerminationReason` |
| `orchestrator/state_machine.py` | Bounded 8-state repair loop with restart recovery & approval binding | `RepairStateMachine` |
| `orchestrator/dedup.py` | Tier-1 normalized diff fingerprint & Tier-2 AST equivalence dedup | `tier1_fingerprint`, `tier2_fingerprint`, `check_tier1_duplicate`, `check_tier2_duplicate_or_noop` |
| `orchestrator/failure_taxonomy.py` | Retry classification guidance for LLM feedback loop | `FailureCategory`, `classify_attempt_failure` |
| `orchestrator/approval_binding.py` | Cryptographic binding of diff + image digest + result hashes | `bind_ordinary_approval`, `validate_approval_binding`, `verify_ordinary_approval` |
| `localization/traceback_parser.py` | Regex parser for pytest and standard Python traceback frames | `TracebackFrame`, `extract_traceback_frames` |
| `localization/ast_slicer.py` | Hop-0 enclosing function/class & Hop-1 callee slicing via stdlib `ast` | `LocalizationSlice`, `localize_faults`, `split_python_source_lines`, `skeletonize_python_source` |
| `localization/context_packer.py` | 5-tier token-bounded AST skeletonization & compaction packer | `TokenBudgetPackResult`, `SkeletonTelemetry`, `pack_file_with_token_budget` |
| `llm/client.py` | Structural protocol + `urllib` OpenAI-compatible & Gemini clients (capped 429 retries, zero 5xx auto-retry) | `LLMClient`, `OpenAICompatibleClient`, `GeminiClient` |
| `llm/prompts.py` | Injection-hardened prompt builder (line numbering, BiDi/control stripping, triple-backtick neutralization) | `PromptBuilder`, `sanitize_diagnostic` |
| `llm/pricing.py` & `llm/exceptions.py` | Token cost attribution & typed LLM transport/auth/rate errors | `ModelUsage`, `CostEstimate`, `PricingRegistry`, `LLMRateLimitError`, `LLMGenerationError` |
| `policy/diff_parser.py`, `diff_healer.py`, `applier.py`, `validator.py` | Unified diff parsing, coordinate/LF healing, `git apply --check`, allowlist + test/infra blocking | `UnifiedDiffParser`, `apply_validated_patch`, `PatchPolicyValidator`, `ValidationResult` |
| `verification/` | AST overfit/reflection/bloat guard, clone detector, CI diff gate (`ci_gate.py`), differential mutation, causal trace, ddmin minimizer, `strict/` formal Z3/native solver | `verify_not_overfitted`, `run_ci_gate_audit`, `run_ddmin_hunk_minimization`, `run_mutation_adequacy_probe` |
| `evaluation/` | Contamination-aware benchmark harness & JVR metrics (`CaseSpec` admission Gates 1 & 2) | `BenchmarkHarness`, `verify_case_admission`, `BenchmarkCase`, `load_fixed_corpus` |
| `cli/` | CLI entrypoint (`agentsentinel`), JCS (RFC 8785) canonicalization + DSSE PAE attestation, exporter, offline bundle verifier | `main`, `canonicalize_jcs`, `loads_strict_jcs`, `export_evidence_bundle`, `verify_exported_bundle` |

### 2B. Existing Aegis Forge (`autonomous-ci-repair-platform/src/` & `runner/`)

| Area | Files | Notes |
|---|---|---|
| Next.js App & UI | `src/app/**/page.tsx`, `src/components/*.tsx` | Web consoles (`/runs`, `/analyze`, `/verify`, `/architecture`, `/pipeline`, `/proof-bundle`, `/setup`) |
| Next.js API Routes | `src/app/api/**` | `/api/webhooks/github`, `/api/runs/*`, `/api/analyze`, `/api/attestations/verify`, `/api/keys`, `/api/health`, `/api/status` |
| Forge Core (TS) | `src/lib/forge/*.ts` | `analyze.ts`, `auth.ts`, `crypto.ts` (Ed25519 DSSE), `github.ts`, `llm.ts`, `pipeline.ts`, `policy.ts`, `status.ts` |
| PostgreSQL / Drizzle | `src/db/{schema,ensure,index}.ts`, `seed.mjs` | 6 relational tables in Postgres |
| Standalone Node Runner | `runner/aegis.mjs` | Zero-dep JS reproduction & red-to-green verifier |

---

## 3. AgentSentinel Database Schema & Orchestrator States

### SQLite Schema (`agentsentinel.orchestrator.checkpoint.CheckpointStore`)
- `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;`
- `runs(run_id PRIMARY KEY, case_id, state, termination_reason, attempts_used, max_attempts, baseline_result_json, seen_diff_hashes_json, seen_ast_hashes_json, approval_record_json, created_at_utc, updated_at_utc, spec_json)`
- `attempts(run_id, attempt_index, status, proposal_json, usage_json, cost_usd, error_type, error_detail, execution_result_json, diff_hash, ast_hash, timestamp_utc, PRIMARY KEY(run_id, attempt_index))`

### Orchestrator States (`RunState` in `agentsentinel`)
`INIT -> REPRODUCING_BASELINE -> PROPOSING_PATCH -> VALIDATING_POLICY -> APPLYING_PATCH -> VERIFYING_IN_SANDBOX -> AWAITING_HUMAN_APPROVAL -> (APPROVED | REJECTED | TERMINATED_FAILED)`

*Gap vs Aegis-CI Master Plan Section 4:* Aegis-CI adds control-plane intake/delivery states (`RECEIVED`, `FETCHED`, `TRIAGED`, `REFUSED`, `REPRODUCED`, `LOCALIZED`, `REPAIRING(n)`, `VERIFIED`, `GATED`, `DELIVERED`, `ESCALATED`, `FAILED`) and requires an append-only hash-chained `events` table (`prev_hash`, SHA-256 `hash`, `verify_chain`).

---

## 4. Sandbox Configuration & Security Flags (`agentsentinel.sandbox.container`)

- **Network modes:** Single-phase container runner with `network_disabled: bool = True` -> `--network none`. No built-in 2-phase PREPARE/RUN image-layer builder keyed by lockfile hash.
- **Mounts:** Bind mount `-v <host_path>:/workspace:ro` + ephemeral `--tmpfs /tmp:rw,noexec,nosuid,size=64m` and `--tmpfs /run:rw,noexec,nosuid,size=16m`.
  - *Gap on Windows (Section 9):* Bind mounting Windows host directories across WSL2 can mangle file permissions, symlinks, and CRLF line endings; Master Plan A4 requires streaming repositories into containers via `tar`.
- **User & Privileges:** `--user 65534:65534`, `--cap-drop=ALL`, `--security-opt no-new-privileges`, `--security-opt seccomp=<temp_seccomp_profile.json>`, `--read-only`, `--rm`, `--runtime runc`, environment restricted to `PYTHONUNBUFFERED=1`, `PYTHONDONTWRITEBYTECODE=1`, `PYTEST_ADDOPTS=-o cache_dir=/tmp/.pytest_cache`. Post-run inspection `_inspect_runtime` verifies runtime, image ID, user `65534:65534`, network `none`, readonly `True`, `pids_limit`.
- **Limits:** `ordinary regression` defaults to `pids_limit=256`, `timeout_seconds=60` (bounds `1..256` PIDs, `1..300` seconds), `memory=512m`, `cpus=1.0`, `max_output_bytes=262144`. `restricted-v1` / strict probe caps at `pids_limit=64`, `timeout_seconds=30`, `memory=128m`.

---

## 5. LLM Call Sites & CLI

- **Call sites:** `agentsentinel.llm.client.OpenAICompatibleClient.generate_patch` and `GeminiClient.generate_patch` (std `urllib.request`, API key read only from env, retries 429 up to 2 times bounded, attaches `ModelUsage` to `LLMGenerationError` on schema parse failure), invoked only from `RepairStateMachine`.
- **CLI (`agentsentinel`):** Subcommands implemented in `src/agentsentinel/cli/main.py`: `run`, `status`, `approve`, `reject`, `export`, `verify-bundle`, `ci-gate`, `benchmark`.

---

## 6. Why Tests Skip & Fail Under Current Windows Baseline

### Exact Investigation of Skipped Tests ("why the 8 tests skip")
1. **8 Integration Modules Requiring Live Docker & Built Images (`tests/integration/`):**
   AgentSentinel contains **8 integration test files** (`test_docker_live_full_suite.py`, `test_docker_live_m1.py`, `test_docker_live_m13a.py`, `test_docker_live_m16.py`, `test_docker_live_rd.py`, `test_m22_native_live.py`, `test_m22_strict_workflow.py`, `test_pid_profiles_live.py`, totaling 30 collected tests). They use `@skip_without_docker`, `@skip_without_runner_image`, or raise `unittest.SkipTest` when either the Docker daemon pipe (`npipe:////./pipe/dockerDesktopLinuxEngine`) or container images (`agentsentinel-runner:py311`, `agentsentinel-strict:py311`) are absent.
2. **1 Windows Environment Skip in Unit Tests (`tests/unit/test_validator.py:93`):**
   `TestPatchPolicyValidator::test_block_symlink_escape` calls `link_path.symlink_to(...)` inside a `try/except (OSError, NotImplementedError)` block and invokes `pytest.skip("Symlink creation not supported in this user environment")` on standard non-elevated Windows accounts lacking `SeCreateSymbolicLinkPrivilege` / Developer Mode symlink permissions. Additionally, `test_m4_state_machine.py:614` skips if Docker + `agentsentinel-runner:py311` is absent when Docker tests are selected.
3. **14 Unit/Adversarial Test Failures When Docker Daemon Is Offline:**
   In `evaluation/harness.py:111` (`_run_tests`) and `:303` (`_make_runner`), benchmark admission/harness paths fail closed with `HarnessSetupError("Benchmark execution requires Docker and the regression image")` rather than skipping when Docker is offline. Under `-m "not integration"` with Docker Desktop stopped on Windows, those 14 tests fail cleanly fail-closed while **1510 unit/adversarial tests pass**.

### Windows-Specific Issues Audited
- **CRLF vs LF line endings:** Git on Windows can check out LF fixtures as CRLF; `ContainerConfig` mounts Linux containers and `PatchPolicyValidator` / `diff_parser` normalize `\r\n` -> `\n` (while rejecting bare `\r` as terminal spoofing). Mitigated in `autonomous-ci-repair-platform` via `.gitattributes` enforcing `* text=auto eol=lf` and tar-streamed container intake in A4.
- **Symlink creation privilege (`WinError 1314`):** Non-admin Windows users cannot create OS symlinks without Developer Mode. `intake.py` checks both `stat.S_ISLNK` and `st_file_attributes & 0x400` (`FILE_ATTRIBUTE_REPARSE_POINT`).
- **Windows reserved names & path separators:** Handled by `intake.relative_path` rejecting `\`, `:`, drive letters, `CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`.
- **Read-only `.git/objects/pack/` cleanup on deletion:** Addressed via `_WindowsSafeTemporaryDirectory` clearing `stat.S_IWRITE` before `rmtree`.
- **Docker Desktop bind mounts across Windows/WSL2:** Slow and prone to permission/line-ending drift -> A4 must replace host bind mounts with in-memory `tar` streams.

---

## 7. Recorded Baseline Verification Output (2026-11-25)

### AgentSentinel (`C:\Users\tamil\Downloads\agentsenitnel\agent_sentinel`)
- `.\.venv\Scripts\python.exe -B -m ruff check src tests` -> **Exit 0**: `All checks passed!`
- `.\.venv\Scripts\python.exe -B -m mypy --strict src` -> **Exit 0**: `Success: no issues found in 67 source files`
- `.\.venv\Scripts\python.exe -B -m pytest tests/unit tests/adversarial -m "not integration" -q --basetemp=.pytest_tmp -rs` -> **Exit 1 (Docker Desktop offline)**: `14 failed, 1510 passed, 1 skipped, 1 deselected in 108.54s` (all 14 failures: `HarnessSetupError: Benchmark execution requires Docker and the regression image`; 1 skip: `tests\unit\test_validator.py:93`).
- `docker info` -> **Exit 1**: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.

### Aegis Forge Workspace (`c:\Users\tamil\OneDrive\Documents\projects\autonomous-ci-repair-platform`)
- `npm test` (`tsx --test tests/forge.test.ts`) -> **Exit 0**: `9/9 pass`
- `npm run bench` (`tsx benchmarks/runner.mjs`) -> **Exit 0**: `8/8 pass (100% accuracy)`
- `npm run typecheck` (`tsc --noEmit`) -> **Exit 0**: zero errors

---

## 8. Gap List (`G1..G14`) Against Aegis-CI Master Build Plan (v1.0)

| Gap ID | Plan Requirement | Current State | Target Milestone |
|---|---|---|---|
| **G1** | Hash-chained immutable SQLite `events` table (`verify_chain`) + Pydantic domain models (`FailureEvent`, `Diagnosis`, `ContextManifest`, `Patch`, `VerificationReport`, `PolicyDecision`, `EvidenceBundle`) | `AgentSentinel` uses dataclasses & unchained `runs`/`attempts` tables; Aegis Forge uses Postgres without Python models | **A1** |
| **G2** | FastAPI `/webhook` receiver verifying `X-Hub-Signature-256` on raw bytes before JSON parsing, delivery dedup, loop guards, 202 queue | Only Next.js `/api/webhooks/github` exists; no Python FastAPI service or delivery queue in SQLite | **A2** |
| **G3** | GitHub App RS256 JWT + cached installation token + `httpx` client pinned to `X-GitHub-Api-Version: 2026-03-10` + failed-job log downloader | Only minimal JS `src/lib/forge/github.ts`; no Python JWT/httpx App client | **A2** |
| **G4** | Deterministic v1 triage parsers (`pytest --junitxml`, `ruff`, `mypy`, `pip` resolver -> F1..F5/UNCLASSIFIED) + 15+ real logs/tool golden corpus + flake rerun detector | `AgentSentinel` has traceback frame extraction & retry taxonomy only; no standalone CI log classifier for ruff/mypy/pip/junitxml | **A3** |
| **G5** | Two-phase sandbox: PREPARE (package-index network only, image cached by lockfile hash) + RUN (`--network=none`, repo streamed via `tar`, zero Windows bind mounts) | `AgentSentinel` runs single-phase Docker with host bind mount (`-v host:/workspace:ro`) | **A4** |
| **G6** | Incremental SQLite AST code graph (`LanguageFrontend`, `module`/`class`/`function`/`test` nodes, `resolved` edge flags, test-to-target) + traceback/grep B1 vs graph B2 experiment + `mcp` v2 read-only server | `AgentSentinel` has per-call Hop-0/Hop-1 slicing only; `codemap` prototype uses old MCP `Server` (v1) + NetworkX without v1 experiment | **A5** |
| **G7** | Structured repair adapter (`SearchReplaceEdit` + unified diff) with `git apply --check`, strict BudgetGovernor (per-case/min/day + 429 jitter backoff), SHA-256 record/replay cassettes | `AgentSentinel` uses `urllib` sync client and simple retry count; lacks SHA-256 cassette replay & multi-tier BudgetGovernor | **A6** |
| **G8** | YAML-configured Policy Gate `P1..P8` (diff budget `<=3 files / <=60 lines`, AST test assert-count/skip/tautology diffing, added dangerous-construct AST checks, F4 lockfile exception, depth limit) | `AgentSentinel` hardcodes allowlist + `ci_gate` test checks without YAML P1..P8 rule table, line budget, or test-only escalation verdict | **A7** |
| **G9** | Write-token Deliverer restricted strictly to `refs/heads/aegis/*`, `aegis/fix/<run_id>`, draft PR body with verification/policy/chain-head tables, check run poster, `AEGIS_ENABLED` kill switch & allowlist | Missing in Python | **A8** |
| **G10** | Hermetic Tier A benchmark suite (>=40 cases: 12 logic, 8 lint/type, 6 drift, 6 flaky, 4 env-unfixable, 4 ambiguous) with hidden tests, oracle patches, cheat patches, mechanical admission validator | Only 3 fixtures in `agent_sentinel/tests/fixtures/benchmark_cases/` and 8 synthetic cases in JS `benchmarks/` | **A9** |
| **G11** | Adversarial security benchmark suite (>=12 prompt injection, loop bait, homoglyph path, symlink escape, typosquatting, workflow edit bait) reporting 0% gated ASR vs ungated ASR | Missing systematic >=12 adversarial harness | **A9** |
| **G12** | Experiment/benchmark report generator (`make bench-replay`, `make report`, Wilson 95% confidence intervals, ablations) + auto-generated Markdown tables | Missing | **A9** |
| **G13** | Third-party SDK contract tests (`tests/contracts/` with docs URLs) & pinned `VERSIONS.md` (notably `mcp` v2 `MCPServer`, Pydantic v2, FastAPI, httpx, PyJWT) | Missing | **A0–A2** |
| **G14** | Public governance/release package: `CLAIMS.md`, `HANDOVER.md`, updated `SECURITY.md` with Rule-of-Two limits, `docker-compose.aegis.yml` demo | Incomplete for Aegis-CI v1.0 | **A10** |
