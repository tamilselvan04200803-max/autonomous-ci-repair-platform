import { NextResponse } from "next/server";
import { requireRunner } from "@/lib/forge/auth";
import { buildJob, recordEvent } from "@/lib/forge/pipeline";

export const dynamic = "force-dynamic";

/** The runner pulls its job here. The body is HMAC-signed so the runner can trust it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireRunner(req);
  if (denied) return denied;
  const { id } = await params;
  const built = await buildJob(id);
  if (!built) return NextResponse.json({ ok: false, error: "run not found" }, { status: 404 });
  if (!built.job.candidates.length) {
    return NextResponse.json({ ok: false, error: "run has no candidates eligible for verification" }, { status: 409 });
  }
  await recordEvent(id, "runner", `Runner fetched job with ${built.job.candidates.length} candidate(s).`);
  return NextResponse.json({ ok: true, job: built.job, signature: built.signature });
}
