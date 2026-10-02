import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { patchCandidates, repairRuns, runEvents, runStages } from "@/db/schema";

export type RunSummary = {
  id: string;
  repo: string;
  workflow: string;
  branch: string;
  commitSha: string;
  failureClass: string;
  fingerprint: string;
  state: string;
  riskScore: string;
  costUsd: string;
  durationSec: number;
  testsBefore: number;
  testsAfter: number;
  candidates: number;
  prNumber: number | null;
  createdAt: string;
  verifiedAt: string | null;
};

export const RUN_STATES = [
  "analysed",
  "certified",
  "verifying",
  "repairing",
  "escalated",
  "rejected",
] as const;

export function stateTone(state: string): {
  label: string;
  fg: string;
  bg: string;
  dot: string;
} {
  switch (state) {
    case "certified":
      return {
        label: "Certified",
        fg: "text-certified",
        bg: "bg-certified/10 border-certified/35",
        dot: "bg-certified",
      };
    case "verifying":
      return {
        label: "Gate verifying",
        fg: "text-navy",
        bg: "bg-navy/10 border-navy/30",
        dot: "bg-navy",
      };
    case "analysed":
      return {
        label: "Analysed",
        fg: "text-navy-light",
        bg: "bg-navy-light/10 border-navy-light/35",
        dot: "bg-navy-light",
      };
    case "repairing":
      return {
        label: "Repair in flight",
        fg: "text-amber",
        bg: "bg-amber/10 border-amber/40",
        dot: "bg-amber",
      };
    case "escalated":
      return {
        label: "Escalated to human",
        fg: "text-oxide",
        bg: "bg-oxide/10 border-oxide/35",
        dot: "bg-oxide",
      };
    default:
      return {
        label: "Rejected at gate",
        fg: "text-ink-soft",
        bg: "bg-ink/8 border-ink/25",
        dot: "bg-stone",
      };
  }
}

export async function listRuns(
  opts: {
    state?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  await ensureSchema();
  const filters = [];
  if (opts.state && RUN_STATES.includes(opts.state as (typeof RUN_STATES)[number])) {
    filters.push(eq(repairRuns.state, opts.state));
  }
  if (opts.q) {
    const like = `%${opts.q}%`;
    filters.push(
      or(
        ilike(repairRuns.id, like),
        ilike(repairRuns.repo, like),
        ilike(repairRuns.workflow, like),
        ilike(repairRuns.failureClass, like),
        ilike(repairRuns.fingerprint, like),
      ),
    );
  }
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 100;
  const offset = typeof opts.offset === "number" && opts.offset >= 0 ? opts.offset : 0;

  const rows = await db
    .select({
      id: repairRuns.id,
      repo: repairRuns.repo,
      workflow: repairRuns.workflow,
      branch: repairRuns.branch,
      commitSha: repairRuns.commitSha,
      failureClass: repairRuns.failureClass,
      fingerprint: repairRuns.fingerprint,
      state: repairRuns.state,
      riskScore: repairRuns.riskScore,
      costUsd: repairRuns.costUsd,
      durationSec: repairRuns.durationSec,
      testsBefore: repairRuns.testsBefore,
      testsAfter: repairRuns.testsAfter,
      candidates: repairRuns.candidates,
      prNumber: repairRuns.prNumber,
      createdAt: repairRuns.createdAt,
      verifiedAt: repairRuns.verifiedAt,
    })
    .from(repairRuns)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(repairRuns.createdAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

export async function getRun(id: string) {
  await ensureSchema();
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, id)).limit(1);
  if (!run) return null;
  const stages = await db
    .select()
    .from(runStages)
    .where(eq(runStages.runId, id))
    .orderBy(runStages.seq);
  const candidates = await db
    .select()
    .from(patchCandidates)
    .where(eq(patchCandidates.runId, id))
    .orderBy(patchCandidates.id);
  const events = await db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, id))
    .orderBy(runEvents.at);
  return { run, stages, candidates, events };
}

export async function runCounts() {
  await ensureSchema();
  const rows = await db
    .select({ state: repairRuns.state, count: sql<number>`count(*)::int` })
    .from(repairRuns)
    .groupBy(repairRuns.state);
  const out: Record<string, number> = {
    analysed: 0,
    certified: 0,
    verifying: 0,
    repairing: 0,
    escalated: 0,
    rejected: 0,
  };
  for (const r of rows) out[r.state] = r.count;
  out.total = rows.reduce((acc, r) => acc + r.count, 0);
  return out;
}
