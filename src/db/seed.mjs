/* Seeds the Aegis Forge repair-run ledger.
   Usage: node src/db/seed.mjs  (reads DATABASE_URL from .env)
   Idempotent: replaces demo rows only, never real runs. */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  console.error("[aegis-forge] Refusing to run demo seed script in production!");
  process.exit(1);
}

for (const envFile of [".env", ".env.local"]) {
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres" });

const STAGE_TEMPLATE = [
  ["ingest", "Receive failed workflow_run", "Delivered by GitHub Hookshot, signature required", 0],
  ["verify", "Verify webhook signature", "HMAC-SHA256 over raw body, constant-time compare", 0],
  ["run", "Create idempotent repair run", "Run key unique on repo + workflow + SHA + fingerprint", 1],
  ["ingest-logs", "Fetch logs and artifacts", "Job logs, annotations, artifacts, resolved manifest", 19],
  ["fingerprint", "Generate failure fingerprint", "Frames normalised, volatile literals redacted", 2],
  ["reproduce", "Reproduce in a clean sandbox", "Three consecutive reproductions required", 260],
  ["localize", "Localise likely files and symbols", "Call-graph walk bounded to 24 candidate symbols", 41],
  ["regression", "Generate regression test", "Written in the repository's own harness and style", 52],
  ["red", "Confirm the test fails before repair", "Red transcript must match the failure signature", 90],
  ["candidates", "Generate candidate patches", "Independent contexts, blind to each other", 185],
  ["sandbox-verify", "Verify each patch separately", "One microVM per candidate, shared image digest", 372],
  ["impact", "Run impacted tests, types, lint, scan", "Impact set derived from changed symbols outward", 344],
  ["score", "Score patch risk", "Weighted over reach, signature change and deletions", 6],
  ["publish", "Open draft PR with proof bundle", "Checks API run opened with the full evidence set", 9],
  ["watch", "Watch the upstream CI run", "Only the real branch run counts as a verdict", 482],
  ["verdict", "Verify, or escalate", "Signature issued only on an upstream green run", 2],
];

const runs = [
  {
    id: "AF-04-1187",
    repo: "aegis/commerce-platform",
    workflow: "ci · gateway services",
    branch: "main",
    commitSha: "7c1d9a02e4b6",
    failureClass: "Compiler and type-checking failures",
    fingerprint: "sha256:7c1d9a02e4b6f38c1d5a77b90cc2e4a1",
    state: "certified",
    rootCause:
      "PR #4412 narrowed OrderState to a discriminated union while the gateway serializer still returns a free-form object. The annotation `any` at the return site is the defect, not the serializer itself.",
    failingCommand: "pnpm --filter @aegis/gateway test:unit serialize.spec.ts",
    regressionTest: "serialize.spec.ts › emits a discriminated OrderState payload",
    patchTitle: "type(gateway): type serialize() against the narrowed OrderState union",
    patchSummary:
      "Replaces the `any` return annotation with SerializedOrder, casts the spread explicitly, and widens the union's fallback arm so downstream readers remain exhaustive.",
    testsBefore: 812,
    testsAfter: 814,
    flakyQuarantined: 0,
    durationSec: 1394,
    costUsd: "3.33",
    model: "pydantic-ai / claude-sonnet-4.5",
    sandboxId: "sbx_7f3a91c4",
    depHash: "sha256:9f2c41ab7de0c814",
    candidates: 4,
    riskScore: "0.12",
    filesChanged: 1,
    insertions: 2,
    deletions: 1,
    prNumber: 4431,
    createdAt: "2026-03-04T11:22:33+00:00",
    verifiedAt: "2026-03-04T11:45:47+00:00",
  },
  {
    id: "AF-04-1186",
    repo: "aegis/ledger-core",
    workflow: "ci · python services",
    branch: "main",
    commitSha: "b82e41d09ac3",
    failureClass: "Dependency-upgrade breakage",
    fingerprint: "sha256:b82e41d09ac37741f0c2e8b6a5d4c392",
    state: "certified",
    rootCause:
      "pydantic-settings 3.0 removed BaseSettings from the pydantic namespace. The settings module imports from the old location and every service fails during collection, before a single test runs.",
    failingCommand: "uv run pytest tests/unit/test_settings.py -x -q",
    regressionTest: "test_settings.py › Settings loads from the environment block",
    patchTitle: "fix(settings): import BaseSettings from pydantic-settings",
    patchSummary:
      "Moves the import to the new package, adds an explicit dependency entry in pyproject.toml and pins the lower bound to 2.2 so the transition is gradual across the workspace.",
    testsBefore: 1204,
    testsAfter: 1211,
    flakyQuarantined: 0,
    durationSec: 1122,
    costUsd: "2.71",
    model: "pydantic-ai / claude-sonnet-4.5",
    sandboxId: "sbx_2b81ee07",
    depHash: "sha256:aa319d20bb71e44c",
    candidates: 3,
    riskScore: "0.19",
    filesChanged: 2,
    insertions: 6,
    deletions: 3,
    prNumber: 2287,
    createdAt: "2026-03-04T09:14:02+00:00",
    verifiedAt: "2026-03-04T09:32:44+00:00",
  },
  {
    id: "AF-04-1185",
    repo: "aegis/edge-router",
    workflow: "ci · rust workspace",
    branch: "main",
    commitSha: "41f7ab9c2210",
    failureClass: "Syntax and interface regressions",
    fingerprint: "sha256:41f7ab9c2210d5e6a7b8c9d0e1f2a3b4",
    state: "verifying",
    rootCause:
      "A merge produced a valid token stream and an invalid programme: the retry module still reaches for the renamed `BackoffPolicy` symbol, which moved into the `retry::policy` module two commits earlier.",
    failingCommand: "cargo test -p edge-router --lib retry::tests",
    regressionTest: "retry::tests::backoff_ceiling_is_respected",
    patchTitle: "fix(retry): import BackoffPolicy from retry::policy",
    patchSummary:
      "Corrects the import path in three call sites and adds a doc-link so the compiler catches future moves at compile time rather than at test time.",
    testsBefore: 388,
    testsAfter: 390,
    flakyQuarantined: 0,
    durationSec: 764,
    costUsd: "1.94",
    model: "langgraph / gpt-5-codex",
    sandboxId: "sbx_9d12c7ab",
    depHash: "sha256:71bc4416dd20aa90",
    candidates: 5,
    riskScore: "0.08",
    filesChanged: 1,
    insertions: 3,
    deletions: 3,
    prNumber: null,
    createdAt: "2026-03-04T08:41:19+00:00",
    verifiedAt: null,
  },
  {
    id: "AF-04-1184",
    repo: "aegis/commerce-platform",
    workflow: "ci · web client",
    branch: "release/2026.03",
    commitSha: "cc41a7b0e293",
    failureClass: "Deterministic unit-test failures",
    fingerprint: "sha256:cc41a7b0e293184d5f6a7b8c9d0e1f2a",
    state: "certified",
    rootCause:
      "The pricing service applies tax before the discount is normalised, so an order with a percentage discount over £100 returns 409 instead of 201. The assertion has been wrong since the discount refactor on Tuesday.",
    failingCommand: "pnpm --filter @aegis/pricing test checkout.spec.ts",
    regressionTest: "checkout.spec.ts › applies discount before tax normalisation",
    patchTitle: "fix(pricing): normalise discount before tax application",
    patchSummary:
      "Reorders the pipeline so the discount is normalised against the pre-tax subtotal, matching the documented contract in docs/pricing.md §4.2.",
    testsBefore: 1442,
    testsAfter: 1447,
    flakyQuarantined: 0,
    durationSec: 1041,
    costUsd: "2.48",
    model: "pydantic-ai / claude-sonnet-4.5",
    sandboxId: "sbx_44c0fe12",
    depHash: "sha256:9f2c41ab7de0c814",
    candidates: 6,
    riskScore: "0.24",
    filesChanged: 3,
    insertions: 18,
    deletions: 7,
    prNumber: 4429,
    createdAt: "2026-03-03T22:07:55+00:00",
    verifiedAt: "2026-03-03T22:25:12+00:00",
  },
  {
    id: "AF-04-1183",
    repo: "aegis/ml-pipelines",
    workflow: "ci · feature store",
    branch: "main",
    commitSha: "5510ef3c9a7b",
    failureClass: "A limited class of flaky tests",
    fingerprint: "sha256:5510ef3c9a7b02d4e6f8a1b2c3d4e5f6",
    state: "escalated",
    rootCause:
      "The fixture asserts on an unordered set compared as a list. Reproduced at 3 of 10 attempts only, which is below the threshold at which Aegis Forge is willing to claim a mechanical cause.",
    failingCommand: "uv run pytest tests/unit/test_features.py::test_row_order -q",
    regressionTest: "— (no regression test generated: reproduction not deterministic)",
    patchTitle: "— (no patch published)",
    patchSummary:
      "Escalated with the full reproduction transcript. The recommended human action is to sort the fixture output and re-run; Aegis Forge will not touch a flake it cannot pin down.",
    testsBefore: 640,
    testsAfter: 640,
    flakyQuarantined: 1,
    durationSec: 903,
    costUsd: "1.88",
    model: "langgraph / gpt-5-codex",
    sandboxId: "sbx_11ab4e63",
    depHash: "sha256:cc1290ff31ba7788",
    candidates: 0,
    riskScore: "0.61",
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    prNumber: null,
    createdAt: "2026-03-03T18:52:41+00:00",
    verifiedAt: null,
  },
  {
    id: "AF-04-1182",
    repo: "aegis/ledger-core",
    workflow: "ci · python services",
    branch: "main",
    commitSha: "903ab51c7d2e",
    failureClass: "Unsafe direct command execution",
    fingerprint: "sha256:903ab51c7d2e6f7a8b9c0d1e2f3a4b5c",
    state: "rejected",
    rootCause:
      "A candidate patch attempted to fetch a shell script from an unverified host inside the sandbox to regenerate a fixture. The tool boundary denied the egress and rejected the candidate before verification began.",
    failingCommand: "uv run pytest tests/unit/test_fixtures.py -q",
    regressionTest: "test_fixtures.py › fixture bundle digest matches the manifest",
    patchTitle: "— (candidate C rejected at the tool boundary)",
    patchSummary:
      "Recorded as evidence of the boundary working. The offending tool call, its arguments and the denial reason are preserved in the model and tool trace for review.",
    testsBefore: 1204,
    testsAfter: 1204,
    flakyQuarantined: 0,
    durationSec: 412,
    costUsd: "0.74",
    model: "langgraph / gpt-5-codex",
    sandboxId: "sbx_67e3b0aa",
    depHash: "sha256:aa319d20bb71e44c",
    candidates: 3,
    riskScore: "0.92",
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    prNumber: null,
    createdAt: "2026-03-03T16:31:08+00:00",
    verifiedAt: null,
  },
  {
    id: "AF-04-1181",
    repo: "aegis/edge-router",
    workflow: "ci · go services",
    branch: "main",
    commitSha: "e71c0b3d4a5f",
    failureClass: "Compiler and type-checking failures",
    fingerprint: "sha256:e71c0b3d4a5f60718293a4b5c6d7e8f9",
    state: "certified",
    rootCause:
      "gopls reports that NewRouter now requires a context argument. Three call sites in the test harness still use the previous signature, so the package fails to compile and every downstream test is masked.",
    failingCommand: "go test ./internal/router/... -run TestRouterConstruction",
    regressionTest: "TestRouterConstruction/test_context_is_propagated_to_the_upstream",
    patchTitle: "fix(router): pass a context into NewRouter at every call site",
    patchSummary:
      "Updates the three harness call sites, propagates the context into the upstream dial, and removes the package-level TODO that allowed the signature drift.",
    testsBefore: 502,
    testsAfter: 506,
    flakyQuarantined: 0,
    durationSec: 878,
    costUsd: "2.12",
    model: "pydantic-ai / claude-sonnet-4.5",
    sandboxId: "sbx_3ce9a140",
    depHash: "sha256:5b77aa12cc90fe31",
    candidates: 4,
    riskScore: "0.16",
    filesChanged: 2,
    insertions: 11,
    deletions: 5,
    prNumber: 912,
    createdAt: "2026-03-03T13:19:27+00:00",
    verifiedAt: "2026-03-03T13:33:41+00:00",
  },
  {
    id: "AF-04-1180",
    repo: "aegis/web-client",
    workflow: "ci · web client",
    branch: "main",
    commitSha: "2ad4f6b8c0e1",
    failureClass: "Agent crashes and interrupted runs",
    fingerprint: "sha256:2ad4f6b8c0e123456789abcdef012345",
    state: "repairing",
    rootCause:
      "The verification sandbox was OOM-killed while running the visual regression suite. The run resumed from the last durable checkpoint at stage 11 without regenerating any candidate patches.",
    failingCommand: "pnpm --filter @aegis/web test:visual",
    regressionTest: "pending — regression test generation in progress",
    patchTitle: "pending — candidate generation in progress",
    patchSummary:
      "Resume in flight. Checkpointed evidence from the interrupted attempt is preserved and the resumed run records both attempts in its trace.",
    testsBefore: 318,
    testsAfter: 318,
    flakyQuarantined: 2,
    durationSec: 1502,
    costUsd: "3.91",
    model: "pydantic-ai / claude-sonnet-4.5",
    sandboxId: "sbx_a012bb77",
    depHash: "sha256:d4e5f6a7b8c90123",
    candidates: 3,
    riskScore: "0.31",
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    prNumber: null,
    createdAt: "2026-03-04T12:02:11+00:00",
    verifiedAt: null,
  },
  {
    id: "AF-04-1179",
    repo: "aegis/ml-pipelines",
    workflow: "ci · feature store",
    branch: "main",
    commitSha: "88ba21d0ffee",
    failureClass: "Unverifiable AI-generated fixes",
    fingerprint: "sha256:88ba21d0ffee123456789abcdefabcde0",
    state: "escalated",
    rootCause:
      "A candidate patch produced a regression test that passed on the unmodified commit. The test was vacuously true — it asserted on a constant — and the gate discarded it as evidence, then escalated the run.",
    failingCommand: "uv run pytest tests/unit/test_parity.py::test_batch_parity -q",
    regressionTest: "discarded — vacuous assertion detected at stage 09",
    patchTitle: "— (no patch published)",
    patchSummary:
      "Escalated with the vacuity analysis attached: the assertion graph proved the predicate independent of any production symbol.",
    testsBefore: 640,
    testsAfter: 640,
    flakyQuarantined: 0,
    durationSec: 688,
    costUsd: "1.42",
    model: "langgraph / gpt-5-codex",
    sandboxId: "sbx_55de0c31",
    depHash: "sha256:cc1290ff31ba7788",
    candidates: 3,
    riskScore: "0.58",
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    prNumber: null,
    createdAt: "2026-03-03T10:44:36+00:00",
    verifiedAt: null,
  },
  {
    id: "AF-04-1178",
    repo: "aegis/commerce-platform",
    workflow: "ci · gateway services",
    branch: "main",
    commitSha: "10ff2e4d6a8b",
    failureClass: "Deterministic unit-test failures",
    fingerprint: "sha256:10ff2e4d6a8b9c0d1e2f3a4b5c6d7e8f",
    state: "certified",
    rootCause:
      "Idempotency keys were compared case-sensitively, so a retried request with a differently-cased key created a duplicate order and returned 409. The retry contract in docs/gateway.md §7 requires normalisation to lowercase.",
    failingCommand: "pnpm --filter @aegis/gateway test idempotency.spec.ts",
    regressionTest: "idempotency.spec.ts › normalises key case before the dedupe lookup",
    patchTitle: "fix(gateway): normalise idempotency keys to lowercase",
    patchSummary:
      "Normalises at the boundary rather than at the lookup, so every consumer of the key observes the same value, and adds the case-varying fixture to the permanent suite.",
    testsBefore: 812,
    testsAfter: 816,
    flakyQuarantined: 0,
    durationSec: 1187,
    costUsd: "2.86",
    model: "pydantic-ai / claude-sonnet-4.5",
    sandboxId: "sbx_8b40c2d9",
    depHash: "sha256:9f2c41ab7de0c814",
    candidates: 5,
    riskScore: "0.14",
    filesChanged: 2,
    insertions: 14,
    deletions: 4,
    prNumber: 4424,
    createdAt: "2026-03-02T20:15:03+00:00",
    verifiedAt: "2026-03-02T20:34:50+00:00",
  },
];

function stageRows(run) {
  return STAGE_TEMPLATE.map(([key, label, detail, baseSec], i) => {
    let status = "passed";
    if (run.state === "repairing" && i > 8) status = "running";
    if (run.state === "escalated" && i === 5) status = "failed";
    if (run.state === "escalated" && i > 5) status = "skipped";
    if (run.state === "rejected" && i === 10) status = "failed";
    if (run.state === "rejected" && i > 10) status = "skipped";
    if (run.state === "verifying" && i === 14) status = "running";
    if (run.state === "verifying" && i > 14) status = "skipped";
    return {
      runId: run.id,
      seq: i + 1,
      key,
      label,
      status,
      detail,
      durationSec: status === "skipped" ? 0 : Math.max(1, Math.round(baseSec * (0.82 + ((i * 7) % 13) / 34))),
    };
  });
}

function candidateRows(run) {
  const notes = [
    "Minimal diff, touches only the localised symbol set.",
    "Alternative: widens the signature instead of the call site. Scored down for public API reach.",
    "Alternative: adds a compatibility shim. Rejected — the shim outlives the fix.",
    "Alternative: suppresses the diagnostic at the call site. Rejected — hides the defect.",
    "Diverse seed: repairs the annotation rather than the return value.",
    "Diverse seed: repairs the caller rather than the callee.",
  ];
  const approaches = [
    "Narrow, symbol-local repair",
    "Signature widening",
    "Compatibility shim",
    "Diagnostic suppression",
    "Annotation repair",
    "Caller-side repair",
  ];
  if (run.candidates === 0) return [];
  return Array.from({ length: run.candidates }, (_, i) => {
    const winner = i === 0;
    const risk = (parseFloat(run.riskScore) + (i + 1) * 0.07).toFixed(2);
    return {
      runId: run.id,
      label: `Candidate ${String.fromCharCode(65 + i)}`,
      approach: approaches[i % approaches.length],
      filesChanged: winner ? run.filesChanged : Math.max(1, run.filesChanged + (i % 3)),
      insertions: winner ? run.insertions : run.insertions + 6 * i,
      deletions: winner ? run.deletions : run.deletions + 2 * i,
      riskScore: winner ? run.riskScore : risk,
      testsPassed: winner ? run.testsAfter : run.testsBefore,
      testsTotal: run.testsAfter,
      status:
        run.state === "certified" || run.state === "verifying"
          ? winner
            ? "winner"
            : i === 1
              ? "outscored"
              : "rejected"
          : i === 0
            ? "outscored"
            : "rejected",
      note: notes[i % notes.length],
    };
  });
}

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repair_runs (
      id text PRIMARY KEY,
      repo text NOT NULL,
      workflow text NOT NULL,
      branch text NOT NULL,
      commit_sha text NOT NULL,
      failure_class text NOT NULL,
      fingerprint text NOT NULL,
      state text NOT NULL,
      root_cause text NOT NULL,
      failing_command text NOT NULL,
      regression_test text NOT NULL,
      patch_title text NOT NULL,
      patch_summary text NOT NULL,
      tests_before integer NOT NULL,
      tests_after integer NOT NULL,
      flaky_quarantined integer NOT NULL DEFAULT 0,
      duration_sec integer NOT NULL,
      cost_usd numeric(8,2) NOT NULL,
      model text NOT NULL,
      sandbox_id text NOT NULL,
      dep_hash text NOT NULL,
      candidates integer NOT NULL,
      risk_score numeric(4,2) NOT NULL,
      files_changed integer NOT NULL,
      insertions integer NOT NULL,
      deletions integer NOT NULL,
      pr_number integer,
      created_at timestamptz NOT NULL,
      verified_at timestamptz
    );
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS run_key text;
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'demo';
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS installation_id integer;
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS workflow_run_id text;
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS check_run_id text;
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS pr_branch text;
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS escalation_reason text;
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS log_excerpt text NOT NULL DEFAULT '';
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS analysis jsonb;
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS verification jsonb;
    ALTER TABLE repair_runs ADD COLUMN IF NOT EXISTS bundle jsonb;
    CREATE UNIQUE INDEX IF NOT EXISTS repair_runs_run_key_unique ON repair_runs(run_key);
    CREATE INDEX IF NOT EXISTS idx_repair_runs_state ON repair_runs(state);

    CREATE TABLE IF NOT EXISTS run_stages (
      id serial PRIMARY KEY,
      run_id text NOT NULL,
      seq integer NOT NULL,
      key text NOT NULL,
      label text NOT NULL,
      status text NOT NULL,
      detail text NOT NULL,
      duration_sec integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_stages_run ON run_stages(run_id);

    CREATE TABLE IF NOT EXISTS patch_candidates (
      id serial PRIMARY KEY,
      run_id text NOT NULL,
      label text NOT NULL,
      approach text NOT NULL,
      files_changed integer NOT NULL,
      insertions integer NOT NULL,
      deletions integer NOT NULL,
      risk_score numeric(4,2) NOT NULL,
      tests_passed integer NOT NULL,
      tests_total integer NOT NULL,
      status text NOT NULL,
      note text NOT NULL
    );
    ALTER TABLE patch_candidates ADD COLUMN IF NOT EXISTS patch text;
    ALTER TABLE patch_candidates ADD COLUMN IF NOT EXISTS test_path text;
    ALTER TABLE patch_candidates ADD COLUMN IF NOT EXISTS test_content text;
    ALTER TABLE patch_candidates ADD COLUMN IF NOT EXISTS test_command text;
    CREATE INDEX IF NOT EXISTS idx_patch_candidates_run ON patch_candidates(run_id);

    CREATE TABLE IF NOT EXISTS run_events (
      id serial PRIMARY KEY,
      run_id text NOT NULL,
      at timestamptz NOT NULL DEFAULT now(),
      kind text NOT NULL,
      message text NOT NULL,
      data jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id text PRIMARY KEY,
      event text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      outcome text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signing_keys (
      id text PRIMARY KEY,
      public_pem text NOT NULL,
      private_pem text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Only demo rows are replaced — real runs are never touched.
  await pool.query(`DELETE FROM run_stages WHERE run_id IN (SELECT id FROM repair_runs WHERE source = 'demo')`);
  await pool.query(`DELETE FROM patch_candidates WHERE run_id IN (SELECT id FROM repair_runs WHERE source = 'demo')`);
  await pool.query(`DELETE FROM run_events WHERE run_id IN (SELECT id FROM repair_runs WHERE source = 'demo')`);
  await pool.query(`DELETE FROM repair_runs WHERE source = 'demo'`);

  for (const run of runs) {
    await pool.query(
      `INSERT INTO repair_runs (
        id, repo, workflow, branch, commit_sha, failure_class, fingerprint, state,
        root_cause, failing_command, regression_test, patch_title, patch_summary,
        tests_before, tests_after, flaky_quarantined, duration_sec, cost_usd, model,
        sandbox_id, dep_hash, candidates, risk_score, files_changed, insertions,
        deletions, pr_number, created_at, verified_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
      [
        run.id, run.repo, run.workflow, run.branch, run.commitSha, run.failureClass,
        run.fingerprint, run.state, run.rootCause, run.failingCommand, run.regressionTest,
        run.patchTitle, run.patchSummary, run.testsBefore, run.testsAfter,
        run.flakyQuarantined, run.durationSec, run.costUsd, run.model, run.sandboxId,
        run.depHash, run.candidates, run.riskScore, run.filesChanged, run.insertions,
        run.deletions, run.prNumber, run.createdAt, run.verifiedAt,
      ],
    );

    for (const s of stageRows(run)) {
      await pool.query(
        `INSERT INTO run_stages (run_id, seq, key, label, status, detail, duration_sec)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [s.runId, s.seq, s.key, s.label, s.status, s.detail, s.durationSec],
      );
    }

    for (const c of candidateRows(run)) {
      await pool.query(
        `INSERT INTO patch_candidates (run_id, label, approach, files_changed, insertions,
           deletions, risk_score, tests_passed, tests_total, status, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [c.runId, c.label, c.approach, c.filesChanged, c.insertions, c.deletions,
          c.riskScore, c.testsPassed, c.testsTotal, c.status, c.note],
      );
    }
  }

  const { rows } = await pool.query("SELECT count(*) FROM repair_runs");
  console.log(`Seeded ${rows[0].count} repair runs with stages and candidates.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
