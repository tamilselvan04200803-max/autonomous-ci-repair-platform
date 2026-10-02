import { NextResponse } from "next/server";
import { getSigningKey } from "@/lib/forge/crypto";

export const dynamic = "force-dynamic";

/** Public verification key. `?format=pem` returns the raw PEM for offline verifiers. */
export async function GET(req: Request) {
  const key = await getSigningKey();
  if (new URL(req.url).searchParams.get("format") === "pem") {
    return new NextResponse(key.publicPem, { headers: { "content-type": "application/x-pem-file" } });
  }
  return NextResponse.json({ keyid: key.keyid, algorithm: "ed25519", format: "spki-pem", publicKey: key.publicPem });
}
