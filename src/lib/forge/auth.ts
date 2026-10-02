import { NextResponse } from "next/server";
import { safeEqual } from "./crypto";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** Admin actions. If FORGE_ADMIN_TOKEN is unset in development, the instance is in open local mode. In production, it fails closed. */
export function requireAdmin(req: Request): NextResponse | null {
  const expected = process.env.FORGE_ADMIN_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { ok: false, error: "FORGE_ADMIN_TOKEN is required in production environments" },
        { status: 503 },
      );
    }
    return null;
  }
  const got = bearer(req);
  if (got && safeEqual(got, expected)) return null;
  return NextResponse.json({ ok: false, error: "admin token required (Authorization: Bearer $FORGE_ADMIN_TOKEN)" }, { status: 401 });
}

/** Runner endpoints always require FORGE_RUNNER_SECRET (or AEGIS_RUNNER_SECRET). */
export function requireRunner(req: Request): NextResponse | null {
  const expected = process.env.FORGE_RUNNER_SECRET || process.env.AEGIS_RUNNER_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "FORGE_RUNNER_SECRET is not configured on the control plane" }, { status: 503 });
  }
  const got = bearer(req);
  if (got && safeEqual(got, expected)) return null;
  return NextResponse.json({ ok: false, error: "invalid runner credentials" }, { status: 401 });
}
