import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { repairRuns } from "@/db/schema";
import { buildBundle, signRunBundle } from "@/lib/forge/pipeline";

export const dynamic = "force-dynamic";

/** Downloads the DSSE-signed proof bundle. Uncertified runs get a freshly signed FAILED/preview statement. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();
  const [run] = await db.select().from(repairRuns).where(eq(repairRuns.id, id));
  if (!run) return NextResponse.json({ ok: false, error: "run not found" }, { status: 404 });
  if (!(await buildBundle(id))) return NextResponse.json({ ok: false, error: "run not found" }, { status: 404 });
  const envelope = run.state === "certified" && run.bundle ? run.bundle : await signRunBundle(id, false);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return new NextResponse(JSON.stringify(envelope, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${safeId}.proof-bundle.dsse.json"`,
      "cache-control": "no-store",
    },
  });
}
