import { NextResponse } from "next/server";
import { integrationStatus } from "@/lib/forge/status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await integrationStatus());
}
