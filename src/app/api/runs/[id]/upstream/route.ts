import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/forge/auth";
import { BRANCH_PREFIX, handleUpstream } from "@/lib/forge/pipeline";

export const dynamic = "force-dynamic";

/** For non-GitHub CI (GitLab, Buildkite, Jenkins): report the upstream verdict of the repair branch. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { conclusion?: string };
  if (!body.conclusion) return NextResponse.json({ ok: false, error: "conclusion is required" }, { status: 400 });
  await handleUpstream(`${BRANCH_PREFIX}${id}`, body.conclusion);
  return NextResponse.json({ ok: true });
}
