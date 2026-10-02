import {
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const repairRuns = pgTable("repair_runs", {
  id: text("id").primaryKey(),
  runKey: text("run_key").unique(),
  source: text("source").notNull().default("demo"), // demo | webhook | manual
  repo: text("repo").notNull(),
  workflow: text("workflow").notNull(),
  branch: text("branch").notNull(),
  commitSha: text("commit_sha").notNull(),
  failureClass: text("failure_class").notNull(),
  fingerprint: text("fingerprint").notNull(),
  state: text("state").notNull(), // analysed | repairing | verifying | certified | escalated | rejected
  rootCause: text("root_cause").notNull(),
  failingCommand: text("failing_command").notNull(),
  regressionTest: text("regression_test").notNull(),
  patchTitle: text("patch_title").notNull(),
  patchSummary: text("patch_summary").notNull(),
  testsBefore: integer("tests_before").notNull(),
  testsAfter: integer("tests_after").notNull(),
  flakyQuarantined: integer("flaky_quarantined").notNull().default(0),
  durationSec: integer("duration_sec").notNull(),
  costUsd: numeric("cost_usd", { precision: 8, scale: 2 }).notNull(),
  model: text("model").notNull(),
  sandboxId: text("sandbox_id").notNull(),
  depHash: text("dep_hash").notNull(),
  candidates: integer("candidates").notNull(),
  riskScore: numeric("risk_score", { precision: 4, scale: 2 }).notNull(),
  filesChanged: integer("files_changed").notNull(),
  insertions: integer("insertions").notNull(),
  deletions: integer("deletions").notNull(),
  prNumber: integer("pr_number"),
  installationId: integer("installation_id"),
  workflowRunId: text("workflow_run_id"),
  checkRunId: text("check_run_id"),
  prBranch: text("pr_branch"),
  escalationReason: text("escalation_reason"),
  logExcerpt: text("log_excerpt").notNull().default(""),
  analysis: jsonb("analysis"),
  verification: jsonb("verification"),
  bundle: jsonb("bundle"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
});

export const runStages = pgTable("run_stages", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().references(() => repairRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull(), // passed | failed | skipped | running
  detail: text("detail").notNull(),
  durationSec: integer("duration_sec").notNull(),
});

export const patchCandidates = pgTable("patch_candidates", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().references(() => repairRuns.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  approach: text("approach").notNull(),
  filesChanged: integer("files_changed").notNull(),
  insertions: integer("insertions").notNull(),
  deletions: integer("deletions").notNull(),
  riskScore: numeric("risk_score", { precision: 4, scale: 2 }).notNull(),
  testsPassed: integer("tests_passed").notNull(),
  testsTotal: integer("tests_total").notNull(),
  status: text("status").notNull(), // winner | rejected | outscored | proposed
  note: text("note").notNull(),
  patch: text("patch"),
  testPath: text("test_path"),
  testContent: text("test_content"),
  testCommand: text("test_command"),
});

export const runEvents = pgTable("run_events", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().references(() => repairRuns.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  data: jsonb("data"),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  outcome: text("outcome").notNull(),
});

export const signingKeys = pgTable("signing_keys", {
  id: text("id").primaryKey(),
  publicPem: text("public_pem").notNull(),
  privatePem: text("private_pem").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export type RepairRun = typeof repairRuns.$inferSelect;
export type RunStage = typeof runStages.$inferSelect;
export type PatchCandidate = typeof patchCandidates.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type SigningKey = typeof signingKeys.$inferSelect;
