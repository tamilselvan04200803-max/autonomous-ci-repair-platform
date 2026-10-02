import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { patchCandidates, repairRuns, runEvents, runStages, type RepairRun } from "@/db/schema";
import { STAGES } from "@/lib/data";
import { analyzeLog, type Analysis } from "./analyze";
import { canonicalJson, getSigningKey, hmacHex, sha256Hex, signStatement } from "./crypto";
import {
  commentOnIssue,
  createCheckRun,
  dispatchVerify,
  fetchFailedLogs,
  getFileAtRef,
  getToken,
  githubConfigured,
  openDraftPr,
  updateCheckRun,
} from "./github";
import { generateCandidates, llmConfigured, llmModel } from "./llm";
import { evaluatePolicy, parseUnifiedDiff, RISK_CEILING, scoreRisk } from "./policy";

export const BRANCH_PREFIX = "aegis-forge/";

/* ------------------------------------------------------------ helpers */

export async function recordEvent(runId: string, kind: string, message: string, data?: unknown) {
  await db.insert(runEvents).values({ runId, kind, message, data: data ?? null });
}

async function setStage(runId: string, key: string, status: "passed" | "failed" | "running" | "skipped" | "pending", detail?: string, durationSec = 0) {
  const set: Record<string, unknown> = { status, durationSec };
  if (detail) set.detail = detail;
  await db.update(runStages).set(set).where(and(eq(runStages.runId, runId), eq(runStages.key, key)));
}

function newRunId() {
  const d = new Date();
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `AF-${yy}${mm}-${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

async function updateRun(id: string, patch: Partial<typeof repairRuns.$inferInsert>) {
  await db.update(repairRuns).set(patch).where(eq(repairRuns.id, id));
}

async function tokenFor(run: Pick<RepairRun, "installationId">): Promise<string | null> {
  if (!githubConfigured()) return null;
  try {
    return await getToken(run.installationId);
  } catch {
    return null;
  }
}

function isRealRepo(repo: string) {
  return /^[\w.-]+\/[\w.-]+$/.test(repo) && !repo.startsWith("local/");
}

/* ---------------------------------------------------------- creation */

export type CreateRunInput = {
  log: string;
  repo?: string;
  workflow?: string;
  branch?: string;
  commitSha?: string;
  source: "webhook" | "manual";
  installationId?: number | null;
  workflowRunId?: string | null;
};

export async function createRunFromLog(input: CreateRunInput): Promise<{ run: RepairRun; created: boolean; analysis: Analysis }> {
  await ensureSchema();
  const analysis = analyzeLog(input.log);
  const repo = input.repo?.trim() || "local/manual";
  const workflow = input.workflow?.trim() || "manual submission";
  const sha = input.commitSha?.trim() || "0000000";
  const runKey = sha256Hex([repo, workflow, sha, analysis.fingerprint].join("\0"));

  const [existing] = await db.select().from(repairRuns).where(eq(repairRuns.runKey, runKey)).limit(1);
  if (existing) {
    await recordEvent(existing.id, "dedupe", "Duplicate delivery of an already-known failure — no new run created.", { source: input.source });
    return { run: existing, created: false, analysis };
  }

  const id = newRunId();
  const now = new Date().toISOString();
  const row: typeof repairRuns.$inferInsert = {
    id,
    runKey,
    source: input.source,
    repo,
    workflow,
    branch: input.branch?.trim() || "main",
    commitSha: sha.slice(0, 40),
    failureClass: analysis.classLabel,
    fingerprint: analysis.fingerprint,
    state: analysis.repairable ? "analysed" : "escalated",
    rootCause: analysis.rootCauseHint,
    failingCommand: analysis.failingCommand ?? "— not recovered from log",
    regressionTest: "pending",
    patchTitle: analysis.primaryError ? `fix: ${analysis.primaryError.message.slice(0, 90)}` : "pending",
    patchSummary: analysis.fixStrategies.join(" · ") || "No catalogued strategy.",
    testsBefore: 0,
    testsAfter: 0,
    flakyQuarantined: 0,
    durationSec: 0,
    costUsd: "0",
    model: llmConfigured() ? llmModel() : "none (analysis only)",
    sandboxId: "—",
    depHash: "—",
    candidates: 0,
    riskScore: "0",
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    installationId: input.installationId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    escalationReason: analysis.escalationReason,
    logExcerpt: analysis.excerpt,
    analysis,
    createdAt: now,
  };
  const inserted = await db.insert(repairRuns).values(row).onConflictDoNothing().returning();
  if (!inserted.length) {
    const [race] = await db.select().from(repairRuns).where(eq(repairRuns.runKey, runKey)).limit(1);
    return { run: race, created: false, analysis };
  }

  await db.insert(runStages).values(
    STAGES.map((s, i) => ({ runId: id, seq: i + 1, key: s.key, label: s.title, status: "pending", detail: s.outputs, durationSec: 0 })),
  );
  const pre = input.source === "webhook" ? ["ingest", "verify", "run", "ingest-logs"] : ["run"];
  for (const k of pre) await setStage(id, k, "passed");
  if (input.source === "manual") {
    for (const k of ["ingest", "verify", "ingest-logs"]) await setStage(id, k, "skipped", "Log submitted manually");
  }
  await setStage(id, "fingerprint", "passed", `${analysis.fingerprint.slice(0, 23)}… · cluster ${analysis.cluster}`);
  await setStage(id, "localize", analysis.localised.length ? "passed" : "failed",
    analysis.localised.length ? analysis.localised.slice(0, 3).map((l) => l.file).join(", ") : "No file references in log");

  await recordEvent(id, "analysed", `Classified as ${analysis.classLabel} (${Math.round(analysis.confidence * 100)}% confidence).`, {
    fingerprint: analysis.fingerprint,
    failingCommand: analysis.failingCommand,
  });
  if (!analysis.repairable) {
    await setStage(id, "reproduce", "failed", analysis.escalationReason ?? "Not eligible");
    await recordEvent(id, "escalated", analysis.escalationReason ?? "Not eligible for autonomous repair.");
  }

  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, id));
  return { run, created: true, analysis };
}

/* -------------------------------------------------------- candidates */

export async function proposeCandidates(runId: string): Promise<number> {
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, runId));
  if (!run) throw new Error("run not found");
  const analysis = run.analysis as Analysis | null;
  if (!analysis?.repairable) return 0;
  if (!llmConfigured()) {
    await recordEvent(runId, "info", "No FORGE_LLM_API_KEY configured — analysis-only mode. Set one to generate candidate patches.");
    return 0;
  }

  await updateRun(runId, { state: "repairing" });
  await setStage(runId, "candidates", "running");
  const token = await tokenFor(run);
  const files: { path: string; content: string }[] = [];
  if (token && isRealRepo(run.repo)) {
    for (const l of analysis.localised.slice(0, 5)) {
      const content = await getFileAtRef(run.repo, l.file, run.commitSha, token);
      if (content) files.push({ path: l.file, content });
    }
  }

  const started = Date.now();
  const count = Number(process.env.FORGE_CANDIDATES ?? "3");
  const cands = await generateCandidates({ analysis, repo: run.repo, files, count });
  const localisedFiles = analysis.localised.map((l) => l.file);

  let accepted = 0;
  let tokens = 0;
  for (const [i, c] of cands.entries()) {
    tokens += c.tokens;
    const stats = parseUnifiedDiff(c.patch);
    const risk = scoreRisk({ diff: stats, localised: localisedFiles, rawDiff: c.patch });
    const staticDeny =
      risk.score >= RISK_CEILING ? `risk ${risk.score} ≥ ceiling` :
      risk.touchesSensitive.length ? "touches sensitive paths" :
      risk.deletesTests ? "deletes tests" :
      !c.testPath || !c.testCommand ? "no regression test supplied" : null;
    if (!staticDeny) accepted++;
    await db.insert(patchCandidates).values({
      runId,
      label: `Candidate ${String.fromCharCode(65 + i)}`,
      approach: c.approach,
      filesChanged: stats.filesChanged,
      insertions: stats.insertions,
      deletions: stats.deletions,
      riskScore: risk.score.toFixed(2),
      testsPassed: 0,
      testsTotal: 0,
      status: staticDeny ? "rejected" : "proposed",
      note: staticDeny ? `Rejected before verification: ${staticDeny}.` : c.rationale.slice(0, 400),
      patch: c.patch,
      testPath: c.testPath,
      testContent: c.testContent,
      testCommand: c.testCommand,
    });
    if (i === 0 && c.rootCause) await updateRun(runId, { rootCause: c.rootCause });
  }

  // Rough cost: tokens × configurable price per 1k tokens
  const cost = (tokens / 1000) * Number(process.env.FORGE_LLM_USD_PER_1K ?? "0.002");
  await updateRun(runId, { candidates: cands.length, costUsd: cost.toFixed(2) });
  await setStage(runId, "regression", accepted ? "passed" : "failed", accepted ? "Regression test proposed with each candidate" : "No usable test");
  await setStage(runId, "candidates", accepted ? "passed" : "failed", `${cands.length} generated · ${accepted} passed static policy`, Math.round((Date.now() - started) / 1000));
  await recordEvent(runId, "candidates", `${cands.length} candidate patch(es) generated, ${accepted} eligible for verification.`, { tokens });

  if (!accepted) {
    await escalate(runId, "No candidate patch survived static policy screening.");
  }
  return accepted;
}

export async function dispatchVerification(runId: string): Promise<boolean> {
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, runId));
  const token = run ? await tokenFor(run) : null;
  if (!run || !token || !isRealRepo(run.repo)) {
    await recordEvent(runId, "info", "Verification not dispatched: GitHub is not configured or this is a manual run. Run `node runner/aegis.mjs verify` against this run id to verify locally.");
    return false;
  }
  await dispatchVerify(run.repo, token, runId);
  await setStage(runId, "reproduce", "running", "repository_dispatch: aegis-verify sent");
  await recordEvent(runId, "dispatched", "repository_dispatch aegis-verify sent — waiting for the runner.");
  return true;
}

/* ------------------------------------------------------- runner job */

export type RunnerJob = {
  runId: string;
  repo: string;
  baseSha: string;
  baseBranch: string;
  failingCommand: string;
  branch: string;
  candidates: { id: number; label: string; patch: string; testPath: string; testContent: string; testCommand: string }[];
};

export function runnerSecret(): string | null {
  return process.env.FORGE_RUNNER_SECRET || process.env.AEGIS_RUNNER_SECRET || null;
}

export async function buildJob(runId: string): Promise<{ job: RunnerJob; signature: string } | null> {
  await ensureSchema();
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, runId));
  if (!run) return null;
  const secret = runnerSecret();
  if (!secret) {
    throw new Error("FORGE_RUNNER_SECRET (or AEGIS_RUNNER_SECRET) is required to dispatch runner jobs");
  }
  const cands = await db
    .select()
    .from(patchCandidates)
    .where(and(eq(patchCandidates.runId, runId), eq(patchCandidates.status, "proposed")))
    .orderBy(asc(patchCandidates.riskScore));
  const job: RunnerJob = {
    runId,
    repo: run.repo,
    baseSha: run.commitSha,
    baseBranch: run.branch,
    failingCommand: run.failingCommand,
    branch: `${BRANCH_PREFIX}${runId}`,
    candidates: cands.map((c) => ({
      id: c.id,
      label: c.label,
      patch: c.patch ?? "",
      testPath: c.testPath ?? "",
      testContent: c.testContent ?? "",
      testCommand: c.testCommand ?? "",
    })),
  };
  return { job, signature: `sha256=${hmacHex(secret, canonicalJson(job))}` };
}

/* ----------------------------------------------------- verification */

type Exec = { exitCode: number; tail?: string; durationMs?: number };

export type VerificationReport = {
  reproduce: { attempts: number[] };
  environment?: Record<string, string | undefined>;
  lockfiles?: Record<string, string>;
  candidates: {
    id: number;
    applied: boolean;
    applyError?: string;
    red?: Exec;
    green?: Exec;
    command?: Exec;
    checks?: (Exec & { command: string })[];
    diff?: string;
    testsPassed?: number;
    testsTotal?: number;
  }[];
  winner?: number | null;
  pushed?: boolean;
  branch?: string;
  durationSec?: number;
};

export async function applyVerification(runId: string, report: VerificationReport) {
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, runId));
  if (!run) throw new Error("run not found");
  const analysis = run.analysis as Analysis | null;
  const localised = analysis?.localised.map((l) => l.file) ?? [];

  const reproduced = report.reproduce.attempts.length >= 3 && report.reproduce.attempts.every((c) => c !== 0);
  await setStage(runId, "ingest-logs", "passed");
  await setStage(runId, "reproduce", reproduced ? "passed" : "failed",
    `exit codes ${report.reproduce.attempts.join(", ") || "none"}`);
  const sandbox = report.environment?.RUNNER_NAME ? `${report.environment.RUNNER_NAME} · ${report.environment.ImageOS ?? ""} ${report.environment.ImageVersion ?? ""}`.trim() : "external runner";
  const depHash = report.lockfiles ? Object.entries(report.lockfiles).map(([k, v]) => `${k}:${v.slice(0, 12)}`).join(" ") : "—";

  const gates: { gate: string; pass: boolean; detail: string }[] = [{ gate: "reproduce", pass: reproduced, detail: `${report.reproduce.attempts.filter((c) => c !== 0).length}/3 failing` }];
  let chosen: VerificationReport["candidates"][number] | null = null;
  let chosenPolicy: ReturnType<typeof evaluatePolicy> | null = null;
  let chosenRisk: ReturnType<typeof scoreRisk> | null = null;

  for (const c of report.candidates) {
    const red = c.red ? c.red.exitCode !== 0 : false;
    const green = c.green ? c.green.exitCode === 0 : false;
    const cmdGreen = c.command ? c.command.exitCode === 0 : false;
    const checksOk = (c.checks ?? []).every((x) => x.exitCode === 0);
    const diffStats = parseUnifiedDiff(c.diff ?? "");
    const risk = scoreRisk({ diff: diffStats, localised, rawDiff: c.diff ?? "" });
    const policy = evaluatePolicy({ risk, provenRed: red, provenGreen: green, reproduced });
    const ok = c.applied && red && green && cmdGreen && checksOk && policy.allow;
    await db
      .update(patchCandidates)
      .set({
        status: ok && !chosen ? "winner" : ok ? "outscored" : "rejected",
        riskScore: risk.score.toFixed(2),
        testsPassed: c.testsPassed ?? (green ? 1 : 0),
        testsTotal: c.testsTotal ?? 1,
        note: ok
          ? `Verified: red→green, command green, ${c.checks?.length ?? 0} extra checks green.`
          : `Rejected: ${!c.applied ? `patch did not apply (${c.applyError ?? "conflict"})` : !red ? "regression test passed before patch (vacuous)" : !green ? "regression test still failing after patch" : !cmdGreen ? "original failing command still fails" : !checksOk ? "an extra check failed" : policy.deny.join("; ")}`,
      })
      .where(eq(patchCandidates.id, c.id));
    if (ok && !chosen) {
      chosen = c;
      chosenPolicy = policy;
      chosenRisk = risk;
    }
  }

  gates.push(
    { gate: "regression_red", pass: Boolean(chosen?.red && chosen.red.exitCode !== 0), detail: chosen ? `exit ${chosen.red?.exitCode}` : "no candidate" },
    { gate: "regression_green", pass: Boolean(chosen?.green && chosen.green.exitCode === 0), detail: chosen ? `exit ${chosen.green?.exitCode}` : "no candidate" },
    { gate: "failing_command_green", pass: Boolean(chosen?.command && chosen.command.exitCode === 0), detail: chosen?.command ? `exit ${chosen.command.exitCode}` : "—" },
    { gate: "impacted_checks", pass: Boolean(chosen && (chosen.checks ?? []).every((x) => x.exitCode === 0)), detail: `${chosen?.checks?.length ?? 0} checks` },
    { gate: "policy", pass: Boolean(chosenPolicy?.allow), detail: chosenPolicy ? `${chosenPolicy.policy} → ${chosenPolicy.allow ? "allow" : "deny"}` : "not evaluated" },
    { gate: "risk", pass: Boolean(chosenRisk && chosenRisk.score < RISK_CEILING), detail: chosenRisk ? `${chosenRisk.score} < ${RISK_CEILING}` : "—" },
  );

  const stats = parseUnifiedDiff(chosen?.diff ?? "");
  await updateRun(runId, {
    verification: { gates, report, policy: chosenPolicy, risk: chosenRisk },
    sandboxId: sandbox,
    depHash,
    durationSec: (run.durationSec ?? 0) + (report.durationSec ?? 0),
    riskScore: (chosenRisk?.score ?? 0).toFixed(2),
    filesChanged: stats.filesChanged,
    insertions: stats.insertions,
    deletions: stats.deletions,
    testsBefore: chosen?.testsTotal ? (chosen.testsTotal - 1) : 0,
    testsAfter: chosen?.testsPassed ?? 0,
  });
  await setStage(runId, "red", chosen ? "passed" : "failed");
  await setStage(runId, "sandbox-verify", chosen ? "passed" : "failed", sandbox, report.durationSec ?? 0);
  await setStage(runId, "impact", chosen ? "passed" : "failed");
  await setStage(runId, "score", chosenRisk ? "passed" : "failed", chosenRisk ? `risk ${chosenRisk.score}` : undefined);

  if (!chosen || !report.pushed || !report.branch) {
    await escalate(runId, !reproduced ? "Failure did not reproduce three times on the parent commit." : "No candidate passed every gate.");
    return { ok: false, gates };
  }

  const winnerRow = await db.select().from(patchCandidates).where(eq(patchCandidates.id, chosen.id));
  await updateRun(runId, {
    regressionTest: winnerRow[0]?.testPath ?? "—",
    patchTitle: `fix: ${winnerRow[0]?.approach ?? "aegis forge repair"}`,
    patchSummary: winnerRow[0]?.note ?? "",
    prBranch: report.branch,
  });

  const fresh = (await db.select().from(repairRuns).where(eq(repairRuns.id, runId)))[0];
  const token = await tokenFor(fresh);
  if (token && isRealRepo(fresh.repo)) {
    const pr = await openDraftPr(fresh.repo, token, {
      head: report.branch,
      base: fresh.branch,
      title: `[aegis-forge] ${fresh.patchTitle}`.slice(0, 240),
      body: await renderPrBody(runId),
    });
    await updateRun(runId, { prNumber: pr.number, state: "verifying" });
    await setStage(runId, "publish", "passed", `Draft PR #${pr.number}`);
    await setStage(runId, "watch", "running", "Waiting for upstream CI on the draft branch");
    await recordEvent(runId, "published", `Draft PR #${pr.number} opened — watching upstream CI.`, { url: pr.html_url });
    if (fresh.checkRunId) {
      await updateCheckRun(fresh.repo, token, fresh.checkRunId, {
        status: "in_progress",
        output: { title: "Patch verified — awaiting upstream CI", summary: `Draft PR #${pr.number}. All local gates passed; certificate issues when upstream CI is green.` },
      }).catch(() => undefined);
    }
  } else {
    await updateRun(runId, { state: "verifying" });
    await setStage(runId, "publish", "skipped", "GitHub not configured — branch pushed, no PR opened");
  }
  return { ok: true, gates };
}

/* -------------------------------------------------- upstream verdict */

export async function handleUpstream(branch: string, conclusion: string | null) {
  const runId = branch.slice(BRANCH_PREFIX.length);
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, runId));
  if (!run || run.state === "certified") return;
  if (conclusion === "success") {
    await certify(runId, conclusion);
  } else {
    await setStage(runId, "watch", "failed", `upstream conclusion: ${conclusion}`);
    await escalate(runId, `Upstream CI on ${branch} concluded "${conclusion}". The local gates passed but the repository's own build disagrees.`);
  }
}

export async function certify(runId: string, upstream: string) {
  await setStage(runId, "watch", "passed", `upstream conclusion: ${upstream}`);
  await updateRun(runId, { state: "certified", verifiedAt: new Date().toISOString() });
  const envelope = await signRunBundle(runId);
  await setStage(runId, "verdict", "passed", `Signed · ${envelope.signatures[0].keyid}`);
  await recordEvent(runId, "certified", "Upstream CI green — bundle signed and certified.");
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, runId));
  const token = await tokenFor(run);
  if (token && isRealRepo(run.repo)) {
    if (run.checkRunId) {
      await updateCheckRun(run.repo, token, run.checkRunId, {
        status: "completed",
        conclusion: "success",
        output: { title: "Certified by the evidence gate", summary: `Proof bundle signed with ${envelope.signatures[0].keyid}.` },
      }).catch(() => undefined);
    }
    if (run.prNumber) {
      await commentOnIssue(run.repo, token, run.prNumber, `✅ **Certified.** Upstream CI is green and the proof bundle is signed.\n\nDownload: \`${publicUrl()}/api/runs/${runId}/bundle\`\nVerify: \`node runner/aegis.mjs verify-bundle bundle.json --key ${publicUrl()}/api/keys\``).catch(() => undefined);
    }
  }
}

export async function escalate(runId: string, reason: string) {
  await updateRun(runId, { state: "escalated", escalationReason: reason });
  await setStage(runId, "verdict", "failed", reason.slice(0, 200));
  await recordEvent(runId, "escalated", reason);
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, runId));
  const token = run ? await tokenFor(run) : null;
  if (run && token && isRealRepo(run.repo) && run.checkRunId) {
    await updateCheckRun(run.repo, token, run.checkRunId, {
      status: "completed",
      conclusion: "neutral",
      output: { title: "Escalated to a human", summary: reason },
    }).catch(() => undefined);
  }
}

/* ------------------------------------------------------- webhook flow */

type WorkflowRunPayload = {
  action: string;
  installation?: { id: number };
  repository: { full_name: string };
  workflow_run: { id: number; name: string; head_branch: string; head_sha: string; conclusion: string | null; event: string };
};

export async function handleWorkflowRun(p: WorkflowRunPayload): Promise<string> {
  if (p.action !== "completed") return "ignored: not completed";
  const wr = p.workflow_run;
  if (wr.head_branch?.startsWith(BRANCH_PREFIX)) {
    await handleUpstream(wr.head_branch, wr.conclusion);
    return `upstream verdict recorded for ${wr.head_branch}`;
  }
  if (wr.conclusion !== "failure") return `ignored: conclusion ${wr.conclusion}`;
  const allow = process.env.FORGE_REPO_ALLOWLIST?.split(",").map((s) => s.trim()).filter(Boolean);
  if (allow?.length && !allow.includes(p.repository.full_name)) return "ignored: repository not in allow-list";

  const token = await getToken(p.installation?.id);
  const { log, jobs } = await fetchFailedLogs(p.repository.full_name, wr.id, token);
  const { run, created } = await createRunFromLog({
    log,
    repo: p.repository.full_name,
    workflow: wr.name,
    branch: wr.head_branch,
    commitSha: wr.head_sha,
    source: "webhook",
    installationId: p.installation?.id ?? null,
    workflowRunId: String(wr.id),
  });
  if (!created) return `deduplicated into ${run.id}`;
  await recordEvent(run.id, "ingested", `Fetched logs for ${jobs.length} failed job(s): ${jobs.join(", ")}`);

  const analysis = run.analysis as Analysis;
  try {
    const check = await createCheckRun(p.repository.full_name, token, {
      head_sha: wr.head_sha,
      status: analysis.repairable ? "in_progress" : "completed",
      ...(analysis.repairable ? {} : { conclusion: "neutral" }),
      details_url: `${publicUrl()}/runs/${run.id}`,
      external_id: run.id,
      output: {
        title: `${analysis.classLabel}`,
        summary: [
          `**Fingerprint** \`${analysis.fingerprint.slice(0, 30)}…\``,
          `**Failing command** \`${analysis.failingCommand ?? "unknown"}\``,
          `**Likely files** ${analysis.localised.slice(0, 4).map((l) => `\`${l.file}\``).join(", ") || "—"}`,
          "",
          analysis.rootCauseHint,
          analysis.escalationReason ? `\n> Escalated: ${analysis.escalationReason}` : "",
        ].join("\n"),
      },
    });
    await updateRun(run.id, { checkRunId: String(check.id) });
  } catch (e) {
    await recordEvent(run.id, "warn", `Could not create check run: ${e instanceof Error ? e.message : e}`);
  }

  if (analysis.repairable) {
    const n = await proposeCandidates(run.id);
    if (n > 0) await dispatchVerification(run.id);
  }
  return `created ${run.id}`;
}

/* -------------------------------------------------------- the bundle */

export function publicUrl() {
  return (process.env.FORGE_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function buildBundle(runId: string) {
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, runId));
  if (!run) return null;
  const cands = await db.select().from(patchCandidates).where(eq(patchCandidates.runId, runId));
  const events = await db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.at));
  const analysis = run.analysis as Analysis | null;
  const verification = run.verification as { gates?: unknown; policy?: unknown; risk?: unknown; report?: VerificationReport } | null;
  const winner = cands.find((c) => c.status === "winner");
  return {
    run_id: run.id,
    repository: run.repo,
    workflow: run.workflow,
    commit: run.commitSha,
    state: run.state,
    root_cause: run.rootCause,
    fingerprint: { digest: run.fingerprint, cluster: analysis?.cluster ?? null, input: analysis?.fingerprintInput ?? null },
    failing_command: run.failingCommand,
    regression_test: winner ? { path: winner.testPath, command: winner.testCommand, content: winner.testContent } : run.regressionTest,
    patch: winner?.patch ?? null,
    before_after: verification?.gates ?? null,
    impacted_test_rationale: {
      localised: analysis?.localised ?? [],
      checks: verification?.report?.candidates.find((c) => c.id === winner?.id)?.checks?.map((c) => ({ command: c.command, exitCode: c.exitCode })) ?? [],
    },
    security_policy: verification?.policy ?? null,
    risk: verification?.risk ?? { score: Number(run.riskScore) },
    sandbox: { id: run.sandboxId, environment: verification?.report?.environment ?? null },
    dependency_hashes: verification?.report?.lockfiles ?? null,
    trace: events.map((e) => ({ at: e.at, kind: e.kind, message: e.message })),
    cost: { usd: Number(run.costUsd), duration_sec: run.durationSec, model: run.model },
    pull_request: run.prNumber,
    escalation_reason: run.escalationReason,
  };
}

export async function signRunBundle(runId: string, persist = true) {
  const bundle = await buildBundle(runId);
  if (!bundle) throw new Error("run not found");
  const key = await getSigningKey();
  const digest = sha256Hex(canonicalJson(bundle));
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `aegis-forge/${runId}/proof-bundle.json`, digest: { sha256: digest } }],
    predicateType: "https://aegisforge.dev/verification_summary/v1",
    predicate: {
      verifier: { id: publicUrl(), version: { "aegis-forge": "0.5.0" } },
      timeVerified: new Date().toISOString(),
      resourceUri: `${publicUrl()}/runs/${runId}`,
      policy: { uri: "policy://aegis.patch.release/v4" },
      verificationResult: bundle.state === "certified" ? "PASSED" : "FAILED",
      keyid: key.keyid,
      bundle,
    },
  };
  const envelope = await signStatement(statement);
  if (persist) {
    await updateRun(runId, { bundle: envelope });
  }
  return envelope;
}

export async function renderPrBody(runId: string): Promise<string> {
  const b = await buildBundle(runId);
  if (!b) return "";
  const gates = (b.before_after as { gate: string; pass: boolean; detail: string }[] | null) ?? [];
  const rt = b.regression_test as { path?: string; command?: string } | string;
  return [
    `## Root cause`,
    b.root_cause,
    ``,
    `## Evidence`,
    `| Field | Value |`,
    `|---|---|`,
    `| Failure fingerprint | \`${b.fingerprint.digest.slice(0, 40)}…\` |`,
    `| Failing command | \`${b.failing_command}\` |`,
    `| Regression test | ${typeof rt === "string" ? rt : `\`${rt.path}\` — \`${rt.command}\``} |`,
    `| Risk score | ${(b.risk as { score: number }).score} (ceiling ${RISK_CEILING}) |`,
    `| Sandbox | ${b.sandbox.id} |`,
    `| Cost / duration | $${b.cost.usd} / ${b.cost.duration_sec}s |`,
    ``,
    `## Gates`,
    ...gates.map((g) => `- ${g.pass ? "✅" : "❌"} **${g.gate}** — ${g.detail}`),
    ``,
    `## What this does not claim`,
    `- It does not claim this is the best possible fix, only that it passes every gate.`,
    `- It does not claim the existing tests are sufficient beyond the impacted set listed.`,
    `- The certificate is issued only after **this PR's own CI** goes green.`,
    ``,
    `Full evidence: ${publicUrl()}/runs/${runId}`,
    ``,
    `<sub>Opened as a draft by Aegis Forge. Nothing is merged automatically.</sub>`,
  ].join("\n");
}
