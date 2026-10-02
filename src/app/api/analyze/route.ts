import { NextResponse } from "next/server";
import { analyzeLog } from "@/lib/forge/analyze";

export const dynamic = "force-dynamic";

const MAX = 5 * 1024 * 1024;

/** Stateless analysis. Accepts text/plain or JSON { log }. Writes nothing. */
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  let log = "";
  try {
    if (type.includes("application/json")) {
      const body = await req.json();
      if (!body || typeof body !== "object" || typeof body.log !== "string") {
        return NextResponse.json({ ok: false, error: "json body must contain a 'log' string" }, { status: 400 });
      }
      log = body.log;
    } else {
      log = await req.text();
    }
  } catch {
    return NextResponse.json({ ok: false, error: "could not read request body" }, { status: 400 });
  }

  if (typeof log !== "string" || !log.trim()) {
    return NextResponse.json({ ok: false, error: "empty or invalid log" }, { status: 400 });
  }
  if (log.length > MAX) log = log.slice(-MAX);
  const started = performance.now();
  try {
    const analysis = analyzeLog(log);
    return NextResponse.json({ ok: true, ms: Math.round(performance.now() - started), analysis });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: `Failed to analyze log: ${err?.message ?? "unknown error"}` }, { status: 500 });
  }
}
