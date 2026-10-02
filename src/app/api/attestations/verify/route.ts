import { NextResponse } from "next/server";
import { getSigningKey, verifyEnvelope, type DsseEnvelope } from "@/lib/forge/crypto";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Body is not valid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, reason: "Expected a JSON object envelope" }, { status: 400 });
  }
  const envelope = ("envelope" in body && body.envelope ? body.envelope : body) as DsseEnvelope;
  if (!envelope || typeof envelope !== "object" || !envelope.payload || !envelope.payloadType) {
    return NextResponse.json({ ok: false, reason: "Invalid DSSE envelope format" }, { status: 400 });
  }

  let publicKey: string;
  if ("publicKey" in body && typeof body.publicKey === "string" && body.publicKey.trim()) {
    publicKey = body.publicKey.trim();
  } else {
    try {
      publicKey = (await getSigningKey()).publicPem;
    } catch (err: any) {
      return NextResponse.json({ ok: false, reason: `Failed to retrieve platform public key: ${err?.message ?? "database error"}` }, { status: 503 });
    }
  }

  const result = verifyEnvelope(envelope, publicKey);
  const predicate = result.statement?.predicate as { verificationResult?: string; timeVerified?: string; bundle?: { run_id?: string; repository?: string } } | undefined;
  return NextResponse.json({
    ok: result.ok,
    reason: result.reason,
    keyid: result.keyid ?? null,
    subjectDigestMatches: result.subjectDigestMatches ?? null,
    verificationResult: predicate?.verificationResult ?? null,
    timeVerified: predicate?.timeVerified ?? null,
    runId: predicate?.bundle?.run_id ?? null,
    repository: predicate?.bundle?.repository ?? null,
  }, { status: result.ok ? 200 : 422 });
}
