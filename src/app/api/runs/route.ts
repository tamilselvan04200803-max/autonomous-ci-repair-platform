import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/forge/auth";
import { createRunFromLog, proposeCandidates } from "@/lib/forge/pipeline";
import { listRuns, runCounts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500) : undefined;
  const offsetParam = searchParams.get("offset");
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : undefined;
  try {
    const [runs, counts] = await Promise.all([listRuns({ state, q, limit, offset }), runCounts()]);
    return NextResponse.json({ ok: true, count: runs.length, counts, runs }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "The repair-run ledger could not be read.", detail: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    );
  }
}

/** Open a repair run from a pasted/uploaded log (any CI system). */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  let body: { log?: string; repo?: string; workflow?: string; branch?: string; commitSha?: string; propose?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "expected JSON body" }, { status: 400 });
  }
  if (!body.log?.trim()) return NextResponse.json({ ok: false, error: "log is required" }, { status: 400 });
  try {
    const { run, created } = await createRunFromLog({ ...body, log: body.log, source: "manual" });
    let candidates = 0;
    if (created && body.propose) candidates = await proposeCandidates(run.id);
    return NextResponse.json({ ok: true, created, id: run.id, state: run.state, candidates, url: `/runs/${run.id}` }, { status: created ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
