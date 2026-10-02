import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const FILES: Record<string, { path: string; type: string }> = {
  "aegis.mjs": { path: "runner/aegis.mjs", type: "text/javascript; charset=utf-8" },
  "aegis-verify.yml": { path: "templates/aegis-verify.yml", type: "text/yaml; charset=utf-8" },
};

/** Serves the exact runner version this control plane expects. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const entry = FILES[file];
  if (!entry) return new Response("not found", { status: 404 });
  try {
    const body = await readFile(join(/* turbopackIgnore: true */ process.cwd(), entry.path), "utf8");
    return new Response(body, { headers: { "content-type": entry.type, "cache-control": "no-cache" } });
  } catch {
    return new Response("runner file missing from deployment", { status: 500 });
  }
}
