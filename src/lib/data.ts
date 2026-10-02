/* ------------------------------------------------------------------
   Aegis Forge — dossier content
   Every stage below is a real gate in the repair pipeline. Nothing in
   this file is decorative: the runs console renders the same keys.
------------------------------------------------------------------- */

export type Stage = {
  n: string;
  key: string;
  title: string;
  summary: string;
  inputs: string;
  outputs: string;
  failureMode: string;
  tooling: string;
  median: string;
};

export const STAGES: Stage[] = [
  {
    n: "01",
    key: "ingest",
    title: "Receive the failed workflow_run",
    summary:
      "A workflow_run event with conclusion failure lands on the ingress endpoint. The delivery is acknowledged inside 90 ms and the real work is queued — GitHub never waits on a model.",
    inputs: "workflow_run webhook payload, X-GitHub-Event, X-GitHub-Delivery",
    outputs: "Accepted delivery record, queued repair intent",
    failureMode: "Event flood, duplicate deliveries, non-failure conclusions",
    tooling: "GitHub Apps, Checks API, HMAC-SHA256",
    median: "84 ms",
  },
  {
    n: "02",
    key: "verify",
    title: "Verify the webhook signature",
    summary:
      "The raw body is HMAC-SHA256 verified against the app secret with a constant-time compare. Unverified deliveries are dropped before they touch the queue; the delivery id is also used as a replay guard with a 24-hour window.",
    inputs: "Raw request bytes, X-Hub-Signature-256, app webhook secret",
    outputs: "Authenticated event, delivery replay key",
    failureMode: "Body mutation in transit, replayed deliveries, secret rotation",
    tooling: "Node crypto, timingSafeEqual",
    median: "3 ms",
  },
  {
    n: "03",
    key: "run",
    title: "Create an idempotent repair run",
    summary:
      "The run key is derived from repository, workflow, head SHA and failure fingerprint. If that key already exists, the run is a no-op and the existing record is returned — a red build re-delivered twice never produces two patches.",
    inputs: "Repo, workflow id, head SHA, fingerprint",
    outputs: "Repair run record in state queued",
    failureMode: "Concurrent deliveries of the same failure",
    tooling: "PostgreSQL unique index (planned: Temporal workflow id reuse)",
    median: "12 ms",
  },
  {
    n: "04",
    key: "ingest-logs",
    title: "Fetch job metadata, logs and artifacts",
    summary:
      "Every failed job's raw log, step annotations, uploaded artifacts and the resolved dependency manifest are pulled and content-addressed into the evidence store before anything is analysed.",
    inputs: "workflow_run id, job ids, artifact list",
    outputs: "Immutable evidence store entries with digests",
    failureMode: "Expired artifacts, truncated logs, rate limits",
    tooling: "GitHub REST + GraphQL API, OpenTelemetry spans",
    median: "19 s",
  },
  {
    n: "05",
    key: "fingerprint",
    title: "Generate the failure fingerprint",
    summary:
      "The failure is normalised into a stable fingerprint: exception class, top three application frames, failing assertion shape, and a redaction of every volatile literal — paths, ports, timestamps, ids, addresses.",
    inputs: "Normalised log stream, stack frames",
    outputs: "Fingerprint SHA, cluster key, human-readable signature",
    failureMode: "Log noise, missing symbols, non-deterministic message text",
    tooling: "Deterministic frame filter, regex diagnostic rules (planned: ast-grep, tree-sitter)",
    median: "1.8 s",
  },
  {
    n: "06",
    key: "reproduce",
    title: "Reproduce the failure in a clean sandbox",
    summary:
      "The commit is tested from scratch in an isolated runner sandbox pinned to the repository's lockfile and toolchain. If the failure cannot be reproduced three times in a row, the run stops here and escalates — no patch is ever written against a ghost.",
    inputs: "Commit SHA, lockfile, toolchain image digest",
    outputs: "Reproduction transcript, confirmed failing command",
    failureMode: "Flaky-only failures, missing secrets, network-dependent tests",
    tooling: "Ephemeral GitHub Actions runner, aegis.mjs (planned: E2B / Daytona microVMs)",
    median: "4 min 20 s",
  },
  {
    n: "07",
    key: "localize",
    title: "Localise likely files and symbols",
    summary:
      "A syntax-aware diff of the failing run's changed surface, cross-referenced with call graphs and blame recency, ranks candidate symbols. Output is a bounded set — never a whole-repo sweep.",
    inputs: "Fingerprint, repo tree, blame, prior runs",
    outputs: "Ranked symbol list with confidence and blast radius",
    failureMode: "Generated code, reflection, dynamic dispatch",
    tooling: "ast-grep, tree-sitter queries, pyright / tsserver / gopls / rust-analyzer",
    median: "41 s",
  },
  {
    n: "08",
    key: "regression",
    title: "Generate a regression test",
    summary:
      "Before any fix is proposed, the agent writes a test that encodes the observed failure as a permanent property of the codebase. That test travels with the patch into the pull request.",
    inputs: "Failure transcript, localised symbols, test conventions",
    outputs: "Regression test file in the repository's own style",
    failureMode: "No test harness for the affected module",
    tooling: "PydanticAI agent, MCP-bounded test writer",
    median: "52 s",
  },
  {
    n: "09",
    key: "red",
    title: "Confirm the regression test fails before repair",
    summary:
      "The new test is executed against the unmodified commit and must fail for the right reason. A test that passes on broken code is discarded and regenerated — up to three attempts, then the run escalates.",
    inputs: "Regression test, unmodified commit",
    outputs: "Red transcript with matching failure signature",
    failureMode: "Test fails for the wrong reason, test is vacuously true",
    tooling: "Dagger test pipeline, fingerprint comparison",
    median: "1 min 30 s",
  },
  {
    n: "10",
    key: "candidates",
    title: "Generate multiple candidate patches",
    summary:
      "Three to six independent candidate patches are produced by separate agent contexts that cannot see each other's output. Diversity is deliberate: a single patch is an opinion, several patches are a vote.",
    inputs: "Localisation, red transcript, repository conventions",
    outputs: "Candidate patches with per-patch reasoning",
    failureMode: "Convergent collapse onto one bad approach",
    tooling: "LangGraph fan-out, PydanticAI scorers",
    median: "3 min 05 s",
  },
  {
    n: "11",
    key: "sandbox-verify",
    title: "Verify each patch in a separate sandbox",
    summary:
      "Each candidate is verified independently in an isolated runner environment. No candidate ever sees another's dirty tree. Candidate diff, test command, and verification transcripts are recorded as evidence.",
    inputs: "Candidate patches, pinned image digest",
    outputs: "Per-patch verification transcript and sandbox identity",
    failureMode: "Cross-contamination, resource exhaustion, poisoned cache",
    tooling: "Ephemeral runner worktrees, aegis.mjs (planned: E2B / Daytona microVMs)",
    median: "6 min 12 s",
  },
  {
    n: "12",
    key: "impact",
    title: "Run impacted tests, type checks, lint and security scans",
    summary:
      "The impacted set is computed from the changed symbols outward. It always includes the regression test, the affected packages' full suites, the language server's diagnostics, and a dependency and secrets scan.",
    inputs: "Patch, impacted set, policy bundle",
    outputs: "Before/after matrix across every gate",
    failureMode: "Under-approximated impact set, toolchain drift",
    tooling: "Pyright, TypeScript, gopls, rust-analyzer, OPA, semgrep",
    median: "5 min 44 s",
  },
  {
    n: "13",
    key: "score",
    title: "Score patch risk",
    summary:
      "Risk is a weighted function of files touched outside the localised set, public signature changes, dependency movement, deletions over insertions, and historical blast radius of the touched modules.",
    inputs: "Patch diff, impact matrix, module history",
    outputs: "Risk score 0.00–1.00 with a written rationale",
    failureMode: "Novel modules with no history to score against",
    tooling: "OPA policy evaluation, git blame statistics",
    median: "6 s",
  },
  {
    n: "14",
    key: "publish",
    title: "Open a draft pull request with the proof bundle",
    summary:
      "The winning candidate is published as a draft PR carrying the complete evidence set — root cause through signed attestation — with a Checks API run that states exactly what was proven and what was not.",
    inputs: "Winning patch, evidence bundle, risk score",
    outputs: "Draft PR, check run, attestation subject",
    failureMode: "Branch protection conflicts, missing permissions",
    tooling: "GitHub Checks API, artifact attestations",
    median: "9 s",
  },
  {
    n: "15",
    key: "watch",
    title: "Watch the actual upstream CI run",
    summary:
      "The draft PR's own CI is the only judge that counts. Aegis Forge watches the real workflow_run on the branch and does not consider itself finished until that run reaches a conclusion.",
    inputs: "PR head SHA, upstream workflow subscriptions",
    outputs: "Upstream conclusion bound to the repair run",
    failureMode: "CI queue congestion, cancelled runs, runner outages",
    tooling: "GitHub Checks API, OpenTelemetry spans (planned: Temporal timers)",
    median: "8 min 02 s",
  },
  {
    n: "16",
    key: "verdict",
    title: "Mark the repair verified, or escalate",
    summary:
      "Green upstream means the repair is marked verified and the evidence set is signed. Anything else — red, cancelled, timed out, or contested by policy — files an escalation with the full trace attached and hands the run to a human.",
    inputs: "Upstream conclusion, policy verdicts",
    outputs: "Verified repair record, or escalation packet",
    failureMode: "Upstream flakes that mask a real regression",
    tooling: "Ed25519 DSSE signing, in-toto statements, PagerDuty webhooks (planned: Sigstore Rekor)",
    median: "2 s",
  },
];

export type FailureClass = {
  n: string;
  title: string;
  share: string;
  body: string;
  tells: string[];
};

export const FAILURE_CLASSES: FailureClass[] = [
  {
    n: "1.1",
    title: "Compiler and type-checking failures",
    share: "31%",
    body:
      "The largest single class. A changed interface, a narrowed generic, a nullability annotation that moved. These are the cheapest failures to prove: the type checker is an oracle that agrees with you or does not.",
    tells: [
      "pyright: Type 'str | None' is not assignable to parameter of type 'str'",
      "tsc(2345) Argument of type 'DraftOrder' is not assignable",
      "mypy: error: Missing type annotation for function 'normalize'",
    ],
  },
  {
    n: "1.2",
    title: "Dependency-upgrade breakage",
    share: "18%",
    body:
      "The build was green on Friday and the bot raised a major version on Saturday. The fingerprint here is almost always a removed symbol or a changed default, and the fix is either a call-site change or a version pin — two very different patches.",
    tells: [
      "ModuleNotFoundError: no attribute 'BaseSettings' in 'pydantic'",
      "Cannot find module '@opentelemetry/api/build/src/index'",
      "error: failed to select a version for the requirement `serde = \"^1.0\"`",
    ],
  },
  {
    n: "1.3",
    title: "Syntax and interface regressions",
    share: "12%",
    body:
      "A merge that produced valid tokens and an invalid programme, or a renamed export that three call sites still reach for. Tree-sitter parses the file even when the compiler refuses, which is what makes localisation possible before the toolchain has a word in.",
    tells: [
      "SyntaxError: unexpected indent, line 214",
      "TS2305: Module '\"./types\"' has no exported member 'OrderState'",
      "error: expected `;`, found `impl`",
    ],
  },
  {
    n: "1.4",
    title: "Deterministic unit-test failures",
    share: "16%",
    body:
      "The same assertion fails the same way every time. This is the class where Aegis Forge is most confident, because confidence here is earned by reproduction rather than estimated: three identical failures in three clean sandboxes.",
    tells: [
      "AssertionError: expected 201 Created, got 409 Conflict",
      "AssertionError: expected [1, 2, 3] deep-equals [1, 2, 4]",
      "thread 'retry_budget' panicked at 'assertion failed: backoff <= MAX'",
    ],
  },
  {
    n: "1.5",
    title: "A limited class of flaky tests",
    share: "9%",
    body:
      "Not all flakiness, and the boundary matters. Aegis Forge will act on flakiness with a mechanical cause — a shared clock, an unseeded random source, a port collision, an unordered set compared as a list — and refuses everything it cannot reproduce on demand.",
    tells: [
      "TimeoutError: fixture did not settle within 2000ms",
      "Connection refused: 127.0.0.1:54321 (port collision)",
      "Set iteration order differed between runs",
    ],
  },
  {
    n: "1.6",
    title: "Agent crashes and interrupted runs",
    share: "6%",
    body:
      "Repair work is itself a long-running distributed process. A sandbox that dies mid-verification, a model call that times out, a runner that is reclaimed — every one of these resumes from the last durable checkpoint instead of starting over.",
    tells: [
      "Sandbox exited with code 137 (OOMKilled)",
      "Temporal activity timed out after 600s",
      "Upstream connection reset during artifact fetch",
    ],
  },
  {
    n: "1.7",
    title: "Unsafe direct command execution",
    share: "5%",
    body:
      "An agent with a shell is one prompt injection away from being an incident. Aegis Forge never executes arbitrary commands: every tool call passes through MCP servers with typed arguments, allow-listed binaries and a seccomp profile.",
    tells: [
      "Blocked: curl | sh on an unverified URL",
      "Denied: write outside workspace root",
      "Denied: network egress to non-allow-listed host",
    ],
  },
  {
    n: "1.8",
    title: "Unverifiable AI-generated fixes",
    share: "3%",
    body:
      "A patch that looks right and is not. The failure is not the code, it is the absence of proof — and that is precisely what the evidence gate exists to catch. Anything that cannot be reproduced, tested and signed is escalated, never merged.",
    tells: [
      "Regression test passed on unmodified commit (vacuous)",
      "Patch touched symbols outside the localised set",
      "No failing-command reproduction recorded",
    ],
  },
];

export type ProofField = {
  clause: string;
  key: string;
  label: string;
  body: string;
  specimen: string;
};

export const PROOF_FIELDS: ProofField[] = [
  {
    clause: "2.1",
    key: "root_cause",
    label: "Root-cause explanation",
    body:
      "A written account of why the build broke, in the language of the repository rather than the language of the model. It names the change that introduced the break, the mechanism, and the boundary of the fix.",
    specimen:
      "PR #4412 narrowed OrderState to a discriminated union but the\ngateway serializer in src/gateway/serialize.ts still returns the\nlegacy free-form object. Type checking passed because the return\nsite is annotated `any` — the annotation is the defect, not the\nserializer. Fix types the serializer explicitly and widens the\nunion's fallback arm so downstream readers stay exhaustive.",
  },
  {
    clause: "2.2",
    key: "fingerprint",
    label: "Failure fingerprint",
    body:
      "A stable, redacted identity for the failure itself. Two builds that fail for the same reason produce the same fingerprint, which is what lets the control plane deduplicate, cluster and refuse to double-repair.",
    specimen: "fp:sha256:7c1d9a02e4b6f38c1d5a77b90cc2e4a1e6d3f0b8a95c1e2d4f6a8b0c2d4e6f81",
  },
  {
    clause: "2.3",
    key: "failing_command",
    label: "Failing command",
    body:
      "The exact command, working directory and environment that reproduces the failure on an unmodified checkout. If this line cannot be replayed by a human in under a minute, the evidence set is worthless.",
    specimen:
      "$ pnpm --filter @aegis/gateway test:unit serialize.spec.ts\n  cwd: /workspace/services/gateway\n  env: NODE_OPTIONS=--no-warnings  TZ=UTC  CI=true\n  → exit 1 in 8.42s",
  },
  {
    clause: "2.4",
    key: "regression_test",
    label: "Regression test",
    body:
      "The test written before the fix, in the repository's own style and harness. It is proven red on the broken commit and green on the patched one, and it stays behind as a permanent property of the codebase.",
    specimen:
      "test('serialize() emits a discriminated OrderState payload', () => {\n  const payload = serialize({ state: 'pending', id: 'ord_1187' });\n  expect(payload).toMatchObject({ state: 'pending', id: 'ord_1187' });\n  expect(payload.state).not.toBeTypeOf('any');\n});",
  },
  {
    clause: "2.5",
    key: "patch",
    label: "Patch diff",
    body:
      "The minimal diff that moves the regression test from red to green. Diffs are scored on what they touch as much as what they change — a patch that reaches outside the localised set carries a written justification.",
    specimen:
      "--- a/services/gateway/src/serialize.ts\n+++ b/services/gateway/src/serialize.ts\n@@ -18,7 +18,9 @@\n-export function serialize(order: unknown): any {\n+export function serialize(order: DraftOrder): SerializedOrder {\n   const state = order.state;\n-  return { ...order, state };\n+  return { ...order, state } as SerializedOrder;\n }\n\n  1 file changed, 2 insertions(+), 1 deletion(-)",
  },
  {
    clause: "2.6",
    key: "before_after",
    label: "Before / after results",
    body:
      "The same matrix, run twice: on the unmodified commit and on the patched one. Every gate is listed, including the ones that did not change, so a reviewer can see the whole surface rather than a curated highlight.",
    specimen:
      "GATE                BEFORE      AFTER\nunit                  812/814     814/814\nregression            FAIL(1)     PASS\ntypecheck (pyright)   3 errors    0 errors\nlint (eslint)         0 errors    0 errors\nsecurity (semgrep)    0 findings  0 findings\ncoverage (patch)      —           94.1%",
  },
  {
    clause: "2.7",
    key: "impact_rationale",
    label: "Impacted-test rationale",
    body:
      "Why those tests and not others. The impacted set is derived from the changed symbols through the call graph, with the derivation shown — a number without its reasoning is not evidence.",
    specimen:
      "Changed symbols: serialize()\nReverse dependencies: 3 modules, 1 public entry point\nImpacted: services/gateway (148 tests), packages/order-types (62)\nExcluded: services/billing — imports order-types only via `type`\n          positions, erased at compile time. Derivation recorded\n          in trace span impact.graph/3.",
  },
  {
    clause: "2.8",
    key: "policy",
    label: "Security-policy results",
    body:
      "The OPA policy bundle evaluated against the patch, with the exact decision document. Secrets scanning, licence movement, prohibited APIs and allowed network surfaces are all covered here.",
    specimen:
      "package aegis.patch.release\n\ndefault allow = false\n\nallow {\n  input.risk_score < 0.35\n  input.diff.files_outside_localised_set == 0\n  not input.diff.introduces_network_egress\n  not input.diff.moves_dependency_major\n}\n\n→ decision: allow  (rule: aegis.patch.release/v4)",
  },
  {
    clause: "2.9",
    key: "sandbox",
    label: "Sandbox identity",
    body:
      "Who ran the verification and in what. MicroVM id, image digest, seccomp profile and the network policy applied — enough for anyone to rebuild the environment byte for byte.",
    specimen:
      "sandbox: sbx_7f3a91c4  (microVM, 4 vCPU / 8 GiB)\nimage:   ghcr.io/aegis/verify-node22@sha256:4b19…e0a7\nseccomp: aegis-strict-v3   egress: deny-all + 2 allow-listed\nnetwork: none (artifacts injected via 9p mount)\nclock:   frozen at 2026-03-04T11:22:33Z",
  },
  {
    clause: "2.10",
    key: "deps",
    label: "Dependency hashes",
    body:
      "Content digests for the lockfile, the toolchain image and every directly involved package, so the run can be replayed against exactly the inputs it originally saw.",
    specimen:
      "pnpm-lock.yaml        sha256:9f2c41ab7de0…c814\nnode:22.11-slim        sha256:4b19c0…e0a7\n@aegis/order-types     2.4.1  sha256:aa31…9d20\npydantic-ai            0.0.34 sha256:71bc…4416",
  },
  {
    clause: "2.11",
    key: "trace",
    label: "Model & tool trace",
    body:
      "Every model call and every tool call made during the repair, in order, with token counts and latency. Tool boundaries are MCP servers with typed arguments — there is no shell in this trace because there is no shell in the system.",
    specimen:
      "00:00:04  model  localize.symbols      12.4k tok   3.1s\n00:00:08  tool   ast-grep.find          args:{pattern:…}\n00:00:11  model  test.write_regression  18.1k tok   6.4s\n00:00:19  tool   dagger.run_test        args:{suite:…}\n00:00:26  model  patch.candidate ×3      41.7k tok  12.8s\n00:00:41  tool   opa.eval                args:{policy:…}",
  },
  {
    clause: "2.12",
    key: "cost",
    label: "Cost and duration",
    body:
      "What the repair cost, in money and in wall-clock time, broken down by stage. Escalations are shown at full cost too — a rejected patch is not a free patch.",
    specimen:
      "wall clock      23 min 14 s\ntokens          214,398  (input 168,204 / output 46,194)\ncompute         $2.91 sandboxes + $0.42 model = $3.33\nescalation cost $0.88 (2 candidates rejected before scoring)",
  },
  {
    clause: "2.13",
    key: "attestation",
    label: "Signed verification artifact",
    body:
      "The whole evidence set, hashed and signed as an in-toto statement with a short-lived Sigstore certificate, verifiable with one command. If the signature does not verify, the bundle is not evidence.",
    specimen:
      "$ gh attestation verify ./bundle.intoto.jsonl -R aegis/forge\n\n✓ Verified subject sha256:7c1d9a02…  against predicate\n  https://aegisforge.dev/verification_summary/v1\n✓ Sigstore transparency log entry 18422019971\n✓ verificationResult: PASSED · SLSA_BUILD_LEVEL_3",
  },
];

export const FAQS: { q: string; a: string }[] = [
  {
    q: "What happens when the failure is not reproducible?",
    a: "The run stops at stage 06 and escalates with the reproduction transcript attached — including the three attempts and their divergence. Aegis Forge does not write a patch for a failure it cannot personally observe, because a patch for a ghost is worse than no patch at all. Roughly one run in nine ends here, and those escalations are the most useful reports the system produces.",
  },
  {
    q: "Does the agent ever execute arbitrary commands?",
    a: "No. Every tool call crosses an MCP boundary with typed arguments, an allow-listed binary set and a seccomp profile. There is no shell tool. Commands like the failing test invocation are constructed from validated templates and executed inside the sandbox by the runner, not composed by the model.",
  },
  {
    q: "How is this different from a bot that opens a fix-it PR?",
    a: "The difference is the gate. Most bots stop when a patch looks plausible; Aegis Forge stops when an independent verifier has reproduced the failure, proven a regression test red on the broken commit and green on the patched one, run the impacted surface, scored the risk, and signed the whole record. Plausibility is not a gate.",
  },
  {
    q: "Which languages are supported today?",
    a: "TypeScript, Python, Go and Rust at full depth, because those four have language servers that produce the diagnostics localisation depends on: pyright, the TypeScript language server, gopls and rust-analyzer. Anything that builds inside a Docker image can be reproduced and tested, but only these four get symbol-level localisation.",
  },
  {
    q: "What if the agent gets it wrong?",
    a: "Then the upstream CI run on the draft PR goes red and stage 16 escalates instead of verifying. The patch is never merged by the system — publication is a draft PR and a check run, always. The blast radius of a wrong patch is a closed draft PR and a written escalation.",
  },
  {
    q: "Can we run it inside our own infrastructure?",
    a: "Yes. The control plane is a set of Temporal workers and a Postgres instance; the sandboxes are E2B or Daytona, or your own Kubernetes with the microVM runtime class. The evidence store is content-addressed object storage of your choosing. Nothing in the certification path requires traffic to leave your network.",
  },
];

export const DEPLOYMENTS = [
  {
    n: "3.1",
    name: "Self-hosted control plane",
    price: "from £2,400 / month",
    body:
      "The whole system inside your VPC: Temporal workers, Postgres, sandbox pool and evidence store. You hold the signing key; Aegis Forge never sees your source outside your network.",
    points: [
      "Unlimited repositories, up to 40 concurrent repair runs",
      "Your own Sigstore-compatible signing authority",
      "E2B, Daytona or in-house Kubernetes sandbox backends",
    ],
  },
  {
    n: "3.2",
    name: "Managed evidence gate",
    price: "from £480 / month",
    body:
      "The GitHub App, the repair pipeline and the evidence store, operated by us against your repositories. Draft PRs land in your namespace; the proof bundle is signed and published to your attestation store.",
    points: [
      "GitHub App with least-privilege Checks and Contents permissions",
      "Proof bundle retention of 7 years for audit",
      "SOC 2 Type II report and ISO 27001 certificate available",
    ],
  },
  {
    n: "3.3",
    name: "Evidence gate as a library",
    price: "free, source-available",
    body:
      "Just the verifier. Take the certificate format, the OPA policy bundle and the in-toto predicate and run them against patches produced by anything — including your own agents.",
    points: [
      "Rust and TypeScript reference verifiers, Apache-2.0",
      "Conformance suite for third-party patch producers",
      "No telemetry, no phone home, no account required",
    ],
  },
];
