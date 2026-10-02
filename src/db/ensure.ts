import { pool } from "@/db";

/**
 * Idempotent bootstrap so a fresh `git clone && npm run dev` works without a
 * migration step. Mirrors src/db/schema.ts — keep the two in sync.
 */
const DDL = `
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
`;

const SPECIMEN_RUN = {
  id: "AF-04-1187",
  repo: "aegis/commerce-platform",
  workflow: "ci · gateway services",
  branch: "main",
  commit_sha: "7c1d9a02e4b6",
  failure_class: "Compiler and type-checking failures",
  fingerprint: "sha256:7c1d9a02e4b6f38c1d5a77b90cc2e4a1",
  state: "certified",
  root_cause:
    "PR #4412 narrowed OrderState to a discriminated union while the gateway serializer still returns a free-form object. The annotation `any` at the return site is the defect, not the serializer itself.",
  failing_command: "pnpm --filter @aegis/gateway test:unit serialize.spec.ts",
  regression_test: "serialize.spec.ts › emits a discriminated OrderState payload",
  patch_title: "type(gateway): type serialize() against the narrowed OrderState union",
  patch_summary:
    "Replaces the `any` return annotation with SerializedOrder, casts the spread explicitly, and widens the union's fallback arm so downstream readers remain exhaustive.",
  tests_before: 812,
  tests_after: 814,
  flaky_quarantined: 0,
  duration_sec: 1394,
  cost_usd: "3.33",
  model: "pydantic-ai / claude-sonnet-4.5",
  sandbox_id: "sbx_7f3a91c4",
  dep_hash: "sha256:9f2c41ab7de0c814",
  candidates: 4,
  risk_score: "0.12",
  files_changed: 1,
  insertions: 2,
  deletions: 1,
  pr_number: 4431,
  created_at: "2026-03-04T11:22:33+00:00",
  verified_at: "2026-03-04T11:45:47+00:00",
  source: "demo",
};

const SPECIMEN_STAGES = [
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

async function seedSpecimenRun() {
  try {
    const existing = await pool.query("SELECT id FROM repair_runs WHERE id = $1", [SPECIMEN_RUN.id]);
    if (existing.rows.length > 0) return;

    await pool.query(
      `INSERT INTO repair_runs (
        id, repo, workflow, branch, commit_sha, failure_class, fingerprint, state,
        root_cause, failing_command, regression_test, patch_title, patch_summary,
        tests_before, tests_after, flaky_quarantined, duration_sec, cost_usd, model,
        sandbox_id, dep_hash, candidates, risk_score, files_changed, insertions,
        deletions, pr_number, created_at, verified_at, source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
      [
        SPECIMEN_RUN.id, SPECIMEN_RUN.repo, SPECIMEN_RUN.workflow, SPECIMEN_RUN.branch,
        SPECIMEN_RUN.commit_sha, SPECIMEN_RUN.failure_class, SPECIMEN_RUN.fingerprint,
        SPECIMEN_RUN.state, SPECIMEN_RUN.root_cause, SPECIMEN_RUN.failing_command,
        SPECIMEN_RUN.regression_test, SPECIMEN_RUN.patch_title, SPECIMEN_RUN.patch_summary,
        SPECIMEN_RUN.tests_before, SPECIMEN_RUN.tests_after, SPECIMEN_RUN.flaky_quarantined,
        SPECIMEN_RUN.duration_sec, SPECIMEN_RUN.cost_usd, SPECIMEN_RUN.model,
        SPECIMEN_RUN.sandbox_id, SPECIMEN_RUN.dep_hash, SPECIMEN_RUN.candidates,
        SPECIMEN_RUN.risk_score, SPECIMEN_RUN.files_changed, SPECIMEN_RUN.insertions,
        SPECIMEN_RUN.deletions, SPECIMEN_RUN.pr_number, SPECIMEN_RUN.created_at,
        SPECIMEN_RUN.verified_at, SPECIMEN_RUN.source,
      ],
    );

    let seq = 1;
    for (const [key, label, detail, dur] of SPECIMEN_STAGES) {
      await pool.query(
        `INSERT INTO run_stages (run_id, seq, key, label, status, detail, duration_sec)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [SPECIMEN_RUN.id, seq++, key, label, "passed", detail, dur],
      );
    }

    await pool.query(
      `INSERT INTO patch_candidates (
        run_id, label, approach, files_changed, insertions, deletions,
        risk_score, tests_passed, tests_total, status, note, patch
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        SPECIMEN_RUN.id,
        "Candidate 1 (Certified Winner)",
        "type(gateway): cast spread explicitly and narrow OrderState union return type",
        1, 2, 1, "0.12", 814, 814, "verified",
        "Certified by evidence gate: zero test deletions, passes all type checks and regression tests.",
        `--- a/packages/gateway/src/serialize.ts\n+++ b/packages/gateway/src/serialize.ts\n@@ -14,3 +14,4 @@\n-export function serializeOrder(order: unknown): any {\n+export function serializeOrder(order: unknown): SerializedOrder {\n   return { ...order } as SerializedOrder;\n }`,
      ],
    );
  } catch (err: any) {
    console.warn("[aegis-forge] Failed to auto-seed specimen run AF-04-1187:", err?.message ?? err);
  }
}

const g = globalThis as typeof globalThis & { __aegisSchema?: Promise<void> };

export function ensureSchema(): Promise<void> {
  if (!g.__aegisSchema) {
    g.__aegisSchema = pool
      .query(DDL)
      .then(() => seedSpecimenRun())
      .then(() => undefined)
      .catch((err) => {
        g.__aegisSchema = undefined;
        throw err;
      });
  }
  return g.__aegisSchema;
}
