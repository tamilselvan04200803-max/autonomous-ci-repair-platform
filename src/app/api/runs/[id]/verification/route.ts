import { NextResponse } from "next/server";
import { requireRunner } from "@/lib/forge/auth";
import { applyVerification, type VerificationReport } from "@/lib/forge/pipeline";

export const dynamic = "force-dynamic";

/** The runner reports reproduction, red/green and check results here. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireRunner(req);
  if (denied) return denied;
  const { id } = await params;
  let report: VerificationReport;
  try {
    report = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "expected JSON" }, { status: 400 });
  }
  if (!report?.reproduce || !Array.isArray(report.candidates)) {
    return NextResponse.json({ ok: false, error: "malformed verification report" }, { status: 422 });
  }
  try {
    const result = await applyVerification(id, report);
    return NextResponse.json({ ok: true, certifiable: result.ok, gates: result.gates });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
