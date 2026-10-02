import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/forge/auth";
import { dispatchVerification, proposeCandidates } from "@/lib/forge/pipeline";

export const dynamic = "force-dynamic";

/** Re-run candidate generation (e.g. after configuring an LLM key) and dispatch verification. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const accepted = await proposeCandidates(id);
    const dispatched = accepted > 0 ? await dispatchVerification(id) : false;
    return NextResponse.json({ ok: true, accepted, dispatched });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
