import { after, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { webhookDeliveries } from "@/db/schema";
import { verifyGithubSignature } from "@/lib/forge/crypto";
import { handleWorkflowRun } from "@/lib/forge/pipeline";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "GITHUB_WEBHOOK_SECRET is not configured" }, { status: 503 });
  }

  const raw = await req.text();
  if (!verifyGithubSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ ok: false, error: "signature verification failed" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "unknown";
  const delivery = req.headers.get("x-github-delivery");
  if (!delivery) return NextResponse.json({ ok: false, error: "missing X-GitHub-Delivery" }, { status: 400 });

  await ensureSchema();
  // Replay guard: a delivery id is processed at most once.
  const inserted = await db
    .insert(webhookDeliveries)
    .values({ id: delivery, event, outcome: "accepted" })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    return NextResponse.json({ ok: true, outcome: "duplicate delivery ignored" }, { status: 200 });
  }

  if (event === "ping") return NextResponse.json({ ok: true, outcome: "pong" });
  if (event !== "workflow_run") {
    await db.update(webhookDeliveries).set({ outcome: `ignored event ${event}` }).where(eq(webhookDeliveries.id, delivery));
    return NextResponse.json({ ok: true, outcome: `ignored event ${event}` }, { status: 202 });
  }

  let payload: Parameters<typeof handleWorkflowRun>[0];
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // Acknowledge GitHub fast; do the expensive work after the response.
  after(async () => {
    let outcome: string;
    try {
      outcome = await handleWorkflowRun(payload);
    } catch (e) {
      outcome = `error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("[aegis] webhook processing failed", e);
    }
    await db.update(webhookDeliveries).set({ outcome: outcome.slice(0, 500) }).where(eq(webhookDeliveries.id, delivery));
  });

  return NextResponse.json({ ok: true, outcome: "accepted" }, { status: 202 });
}
