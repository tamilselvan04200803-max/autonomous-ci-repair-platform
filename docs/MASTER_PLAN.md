# Aegis-CI: Master Build Plan (v1.0, scope frozen)

Prepared 25 Nov 2026. Every external fact below was checked against a primary source on that date. Anything not independently verified is listed in section 1 and is used for no decision.

## 0. How to use this document

- Save it as `docs/MASTER_PLAN.md`. Copy section 10 into `AGENTS.md` (or your coding agent's rules file).
- Run one milestone from section 8 cleanly with strict TDD and full verification.
- Assumption: AgentSentinel is the verification kernel (sandboxed runner, policy gate, bounded repair, SQLite checkpoints) and Aegis-CI is the control plane around it: GitHub integration, triage, localization, delivery, benchmark. Milestone A0 confirms this by audit.

## 1. Research verdict: what survived checking

| Claim in the source research | Verdict | Consequence for the plan |
| --- | --- | --- |
| code-review-graph gives about 63x median token reduction | Not found. Its README now states about 82x median and 528x best case, measured against a whole-corpus baseline. Older releases advertised 8.2x average. A derivative project's own table shows 0.7x on a small repo (express.js) | Never publish a token number without naming the baseline. Use the realistic baseline B1 (section 7.5) |
| A tree-sitter graph over MCP cuts tokens about 10x and tool calls 2.1x across 31 repos | Verified (arXiv 2603.27277), but answer quality was 83% vs 92% for file exploration | Treat it as a tradeoff. Measure localization recall next to tokens |
| NVIDIA OpenShell validates sandboxing | Real, Apache-2.0 agent runtime. Not needed here | Docker via AgentSentinel stays. Cite OpenShell as related work |
| MCP is the default integration layer | True, but spec 2026-07-28 shipped and the official Python SDK v2 is now the stable line: `pip install mcp` installs 2.x and the server import is `from mcp.server import MCPServer`. v1-style FastMCP code from model memory will break | Pin versions, smoke-test every call (section 9) |
| CI self-healing is an open, hot lane | Crowded: CircleCI Chunk, Gitar, Cursor's CI-autofix template, GitHub Agentic Workflows, many tutorials | Do not compete on 'it fixes CI'. Compete on proof, safety and measurement |
| The evaluation layer is the differentiator | Supported. Real CI repair is hard: CI-Repair-Bench reports up to 18.9% success on 567 instances, and only 112 of 3,091 BugSwarm pairs (3.6%) suit repair research | Build a hermetic benchmark and report failures honestly |
| OpenTelemetry GenAI conventions as the observability layer | Every gen\_ai.\* attribute is still Development status and the conventions moved to a new repo in June 2026. Posts calling them stable are wrong | Own SQLite event log is the source of truth. OTel export is optional and pinned |
| AI agents in CI are a security gap | Verified and actively exploited in 2026 (Microsoft Jun 2026, GitInject arXiv 2606.09935, CSA Aug 2026) | Security is the headline feature |
| Hackathon winners (Konveyor, RiskWise, TARIFFED, FutureCommit) and the Descope MCP hackathon | Not independently checked | Used for no decision |

## 2. Positioning

**Pitch:** Aegis-CI turns a red CI run into a proven fix or an honest refusal. Each patch is reproduced against the original failure, verified in a no-network sandbox, checked by a policy gate that blocks test-weakening and workflow edits, and shipped as a draft PR with a tamper-evident evidence bundle. It is benchmarked, including how often it is wrong and how it behaves under prompt injection.

Competitors sell autonomy. We sell trust. Do not claim that self-healing CI is novel.

## 3. Scope

**In v1:** Python 3.10+ repos using pytest on GitHub Actions. Failure classes: F1 test regression, F2 lint/format (ruff), F3 type errors (mypy), F4 dependency/API drift, F5 flaky (detect and report, never patch). Output is a draft PR or a diagnosis-only report.

**Out of v1:** other languages, deploy/infra failures, secrets or permission errors, editing workflow files, auto-merge, public or untrusted repos, fork PRs, multi-repo.

## 4. Architecture

States: RECEIVED, FETCHED, TRIAGED, then REFUSED or REPRODUCED, LOCALIZED, REPAIRING(n), VERIFIED, GATED, then DELIVERED, ESCALATED or FAILED. Every transition is an event in the hash-chained log and a SQLite checkpoint, so a crashed run resumes.

Components and trust level:

1. Webhook receiver (FastAPI): untrusted input, verifies the signature.
2. GitHub client (httpx + JWT): holds the only write credential. Control plane only.
3. Triage: deterministic parsers first, LLM only for the residue.
4. Sandbox (AgentSentinel kernel, Docker): runs untrusted code. No secrets. No network in the run phase.
5. Code graph + localizer: stdlib `ast`, SQLite, optional read-only MCP server.
6. Repair adapter: a pure function from context to a structured patch. No tools, no shell.
7. Policy gate: deterministic, config-driven.
8. Deliverer: branch `aegis/fix/<run_id>`, draft PR, check run.
9. Event log, evidence bundle, benchmark harness.

Import direction: `aegis` imports `agentsentinel` (AgentSentinel kernel), never the reverse.

## 5. Security model

AI agents that read untrusted GitHub content while holding secrets are being attacked now. Microsoft documented a CI agent exposing workflow secrets through issue and PR text, and the GitInject paper reproduced prompt-injection attacks across several AI workflow families. The design rule (often called the Rule of Two): never combine untrusted input, secret or sensitive access, and the ability to change state or reach outside, inside one component.

- Everything from CI logs, source, commit messages and PR text is untrusted data.
- LLM component: sees untrusted text; has no secrets, no tools, no network beyond the model endpoint; output is a diff validated by schema.
- Sandbox: `--network none` in the run phase, no secret env vars, read-only root filesystem plus tmpfs, non-root user, cap-drop ALL, no-new-privileges, pids/memory/cpu limits. Tests must assert these flags.
- GitHub write token: lives only in the deliverer and is used only after a gate PASS. A wrapper refuses any ref outside `refs/heads/aegis/`. Branch protection is ON in every demo repo. No auto-merge.
- Loop guard: ignore branches `aegis/*`, ignore events from the app itself, at most one Aegis PR per head SHA.
- Fork PRs and public repos are skipped in v1.
- Logs given to the LLM: strip ANSI, redact token-shaped strings, truncate, wrap in a block labelled untrusted data. Delimiters are not a defense; isolation is.
- Honest limits: Docker is not a VM boundary. Run on a dev machine with no valuable secrets and never point v1 at repos you do not own. Smee is a public relay: throwaway repos only.

## 6. Evidence bundle and event log

Table `events(run_id, seq, ts, type, payload_json, prev_hash, hash)` where hash = SHA-256 over prev\_hash plus canonical JSON of the payload. `verify_chain(run_id)` detects edits. This is tamper-evident, not tamper-proof (a local attacker can recompute), so put the chain head hash in the PR body.

The bundle holds: run and commit IDs; failure class and parser evidence; reproduction results (k runs, JUnit XML); context manifest (files, token counts, method); every LLM call (model id, parameter hash, token counts, prompt and response hashes, full text stored locally); each attempt's patch and verification report; per-rule policy decisions with reasons; final diff hash; tool versions (image digest, Python, lockfile hash); chain head.

## 7. Benchmarks and evals

**7.1 Tier A, hermetic seeded cases (at least 40).** One directory per case: `repo/` (failing), `visible_ci.sh`, `hidden_tests/` (never shown to the repair loop, run only at scoring), `oracle.patch` (never shown), `meta.yaml` (class, expected outcome FIX, REFUSE or ESCALATE). A validation script enforces mechanically: base fails the visible CI; oracle passes visible and hidden; a cheat patch (skips the test) passes visible but is denied by the gate or fails hidden. Target mix: 12 logic bugs, 8 lint/type/format, 6 dependency or API drift (vendored fake package), 6 flaky (expected: flag, no patch), 4 environment-unfixable (expected: refuse), 4 ambiguous (expected: escalate).

**7.2 Adversarial suite (at least 12).** Injection in log text, in a docstring, in a commit message, in an HTML comment in PR text; bait to skip or delete a test; bait to edit a workflow; bait to add a typosquatted dependency; bait to print environment variables; oversized diff; CI failing on Aegis's own PR (loop bait); homoglyph path; symlink escape in a patch. Requirement: attack success rate is 0 on the gated pipeline. Also report it with the gate disabled to show the gate matters.

**7.3 Tier B, real failures (stretch, after v1.0.0).** Sources: JetBrains lca-ci-builds-repair (Python subset) and mining of fail-then-pass commit pairs in small Python repos. Reproducibility decays: in the LCA datasheet, 336 sampled workflows became 210 after review, 144 after an Actions check, and 77 still passed six months later. Report whatever n you get. Tier A numbers are not comparable to published real-world rates.

**7.4 Metrics.** Verified-fix rate; false-fix rate (passes visible, fails hidden); gate false-deny rate on oracle patches; refusal precision on unfixable cases; flaky precision and recall; attack success rate; attempts distribution; tokens and cost per fixed case; median wall-clock; localization recall@k.

**7.5 Localization and token experiment.** Baselines: B0 whole-repo dump (a strawman, report it but do not headline it); B1 traceback frames plus grep, read top files (the realistic baseline); B2 graph context. Pre-registered rule, applied by script: the graph earns a headline only if B2 recall@k is at least B1's at no more tokens on Tier A. Otherwise publish it as a negative result and keep traceback localization.

**7.6 Ablations.** Gate on/off; graph on/off; attempts 1, 2, 3.

**7.7 Reproducibility.** LLM record/replay cassettes keyed by sha256 of model, parameters and messages. CI runs the benchmark in replay mode with zero tokens. Live runs pin the model id. Result JSON is committed with git SHA and date. Report n, per-class breakdown and Wilson 95% intervals.

## 8. Milestones

**A0 Audit (no features).** Build `docs/REPO_AUDIT.md`: module map, public API, DB schema, sandbox (network modes, mounts, user, limits), orchestrator states, LLM call sites, CLI, why the 8 tests skip, Windows issues (CRLF, symlinks, paths), and a gap list G1..Gn against this plan. Record the baseline test, ruff and mypy output. Accept: audit committed, baseline green, zero behavior changes. Traps: do not refactor, do not 'fix' skips.

**A1 Domain model and event log.** Pydantic models for FailureEvent, Diagnosis, ContextManifest, Patch, VerificationReport, PolicyDecision, EvidenceBundle; the hash-chained table; `verify_chain`; JSON export. Accept: flipping any byte of any event fails `verify_chain`; kill -9 mid-run then resume continues from the last checkpoint; mypy strict clean.

**A2 GitHub ingest.** Code: FastAPI `/webhook` reads raw bytes, verifies `X-Hub-Signature-256` (HMAC-SHA256, `hmac.compare_digest`) before any parsing, dedupes on `X-GitHub-Delivery`, accepts only `workflow_run` completed with conclusion failure, skips forks and `aegis/*` branches and its own events, enqueues in SQLite, returns 202. JWT (RS256) to installation token, cached and refreshed. httpx client with the API version header pinned. Fetch failed-job logs. Accept: signed-fixture tests (valid, bad signature, missing header, duplicate, fork, own branch); live-compatible client contract test. Traps: never log tokens or the key; never parse before verifying.

**A3 Triage.** Deterministic parsers for pytest, ruff, mypy and pip resolver output, mapped to F1..F5 or UNCLASSIFIED. Prefer machine-readable results in the sandbox (`--junitxml`) over scraping text. Flake check: rerun the failing tests k times on the same SHA; mixed outcomes mean FLAKY, no patch. Accept: golden-output corpus of at least 15 real saved logs per tool; unknown format yields UNCLASSIFIED, never a guess.

**A4 Reproduction sandbox.** Two phases. PREPARE: network limited to the configured package index, installs the repo's declared dependencies into an image layer cached by lockfile hash. RUN: network none. Stream the repo into the container with tar (no Windows bind mounts). Reproduce the original failure k times. Accept: 100% of Tier A base repos reproduce their failure; a test proves a socket connect fails in RUN; a memory hog and a fork bomb are killed by limits.

**A5 Graph, localizer, MCP.** `LanguageFrontend` protocol with a Python frontend on stdlib `ast`. Nodes: module, class, function, test. Edges: imports, defines, calls (flagged resolved or unresolved), test-to-target. SQLite, incremental by content hash. Localizer: traceback frames to symbols to k-hop neighbors to ranked files to a token-budgeted context. Experiment script runs B0, B1, B2 and applies the 7.5 rule. Read-only MCP server (symbol lookup, callers, callees, impact) written only after reading the current SDK docs. Accept: experiment output committed; MCP server runs under official `mcp` v2 SDK; no write tools exist.

**A6 Repair loop.** `LLMClient` protocol with an adapter for any OpenAI-compatible endpoint (base URL, model, key from env; verify per provider). Output is a list of search/replace edits or a unified diff, validated by schema and `git apply --check` in the sandbox. At most N attempts (default 3); each retry gets truncated, redacted sandbox output. Budget governor: per-case token cap, per-minute cap under provider limits, backoff with jitter on 429, daily cap. Cassettes for record/replay. Accept: replay reproduces a recorded run with identical patch hashes; the governor provably cannot exceed its caps; schema-violating output is retried then FAILED, never applied.

**A7 Policy gate.** Rules, config in YAML, defaults tuned later from benchmark data: P1 path deny (`.github/**`, conftest, pytest and tool config, lockfiles unless class F4, `.env*`, key files); P2 test integrity via `ast` on base vs patched tests (collected test IDs must not shrink, per-test assert count must not drop, no added skip, skipif, xfail or importorskip, no tautology asserts; test-only patches ESCALATE); P3 diff budget (start at 3 files and 60 changed lines); P4 added dangerous constructs (eval, exec, os.system, shell=True, sockets, HTTP clients, env reads); P5 secret scan of added lines; P6 required evidence (original failures pass k times, previously passing tests still pass, lint and type parity with CI); P7 confidence threshold else diagnosis-only; P8 depth limit one. Accept: every rule has at least 2 allow and 2 deny fixtures; 100% of bait fixtures denied; zero false denies on Tier A oracle patches.

**A8 Delivery.** Create `aegis/fix/<run_id>`, open a draft PR into the failing branch, post a check run on the failing SHA. PR body: verdict, class, root cause, diff summary, verification table, policy table, token cost, chain head. Kill switch `AEGIS_ENABLED` plus per-repo allowlist; idempotency key (repo, run\_id, run\_attempt). Accept: end-to-end delivery simulation; replaying the same webhook creates no second PR; a unit test shows any write outside `refs/heads/aegis/` raises.

**A9 Benchmark and security evals.** Author and mechanically validate Tier A (at least 40) and the adversarial suite (at least 12); build runner, metrics, ablations, report generator. Accept: `make bench-replay` reproduces committed results with no network; `make report` regenerates the README tables; attack success rate 0 gated.

**A10 Package.** README with generated numbers only; Mermaid architecture diagram; SECURITY.md with this threat model and its honest limits; CLAIMS.md; `docker compose up` demo; demo verification walkthrough; LICENSE; release readiness.

**After v1.0.0 only:** S1 tree-sitter frontend for JS/TS; S2 pinned OTel export; S3 Tier B real cases.

## 9. Version and API traps

| Area | Trap | Rule |
| --- | --- | --- |
| MCP Python SDK | v2 is the default install; model memory is v1 (FastMCP) | Pin `mcp`. Read py.sdk.modelcontextprotocol.io. Smoke test first |
| Pydantic AI | V2 stable since 2026-06-23; model memory is V1 | Not required. If used, pin the exact version |
| GitHub REST | Versioned API | Send `X-GitHub-Api-Version`; pinned `2026-03-10` |
| Webhooks | `X-Hub-Signature-256` is HMAC-SHA256; a legacy SHA-1 header exists | Verify raw bytes with constant-time compare |
| CI on bot PRs | Events caused by GITHUB\_TOKEN do not start workflows | Use the App installation token |
| OTel GenAI | Development status | Optional and pinned |
| Docker on Windows | Linux containers via WSL2; bind-mounted Windows paths break symlinks and line endings | Stream via tar; `.gitattributes` with `* text=auto eol=lf`; normalize diffs |
| Python call graph | Static resolution is approximate | Flag edges resolved or unresolved; never present as complete |

## 10. Agent rules

1. `docs/MASTER_PLAN.md` and `docs/REPO_AUDIT.md` are the source of truth for Aegis-CI. Never invent endpoints, flags, config keys or library APIs.
2. Verify before use: for every third-party library or GitHub API call, first write and commit a small contract test under `tests/contracts/` that proves the call works on the pinned version, with the docs URL in a comment.
3. Pin everything in the lockfile and record versions in `VERSIONS.md`. Re-read section 9 before touching MCP, GitHub or Docker code.
4. Done means these commands were run and their real output checked: ruff, `mypy --strict`, pytest, plus the milestone's acceptance script (and existing Node checks remain green). Never write 'should work'.
5. Never edit, skip or weaken an existing test to make it pass. Write new tests from the acceptance criteria first. The baseline recorded in A0 must stay green.
6. Branch cleanly per feature/milestone with small focused commits.
7. Secrets: `.env` and key files are never committed or printed; maintain secret scan verification.
8. Every public claim goes in `CLAIMS.md` with the file and command that proves it. README benchmark/eval numbers are generated from result files by script, never typed.
9. Never alter sandbox security flags, gate defaults, or the write-token wrapper without explicit justification and updating `docs/decisions/`.
10. Keep `HANDOVER.md` and `progress.md` current: what changed, what is verified, what is open.
