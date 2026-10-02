import { pool } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { getSigningKey } from "./crypto";
import { githubConfigured } from "./github";
import { llmConfigured, llmModel } from "./llm";
import { publicUrl } from "./pipeline";
import { RISK_CEILING } from "./policy";

export type Capability = { key: string; label: string; ok: boolean; detail: string; env: string[]; required: boolean };

/** Never returns secret values — only whether they are present. */
export async function integrationStatus() {
  let dbOk = false;
  let dbDetail = "";
  try {
    await ensureSchema();
    await pool.query("select 1");
    dbOk = true;
    dbDetail = "Connected, schema ensured";
  } catch (e) {
    dbDetail = e instanceof Error ? e.message : "unreachable";
  }
  let keyid = "unavailable";
  let keySource = "";
  try {
    keyid = (await getSigningKey()).keyid;
    keySource = process.env.FORGE_SIGNING_KEY ? "from FORGE_SIGNING_KEY" : "auto-generated, stored in Postgres";
  } catch {
    /* db down */
  }
  const gh = githubConfigured();
  const caps: Capability[] = [
    { key: "db", label: "PostgreSQL ledger", ok: dbOk, detail: dbDetail, env: ["DATABASE_URL"], required: true },
    { key: "signing", label: "Ed25519 signing key", ok: keyid !== "unavailable", detail: `${keyid} · ${keySource}`, env: ["FORGE_SIGNING_KEY (optional)"], required: true },
    { key: "webhook", label: "GitHub webhook secret", ok: Boolean(process.env.GITHUB_WEBHOOK_SECRET), detail: "Needed to accept workflow_run deliveries", env: ["GITHUB_WEBHOOK_SECRET"], required: false },
    { key: "github", label: "GitHub API access", ok: gh !== null, detail: gh === "app" ? "GitHub App (installation tokens)" : gh === "token" ? "Personal access token" : "Logs, check runs and draft PRs are disabled", env: ["GITHUB_TOKEN", "or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY"], required: false },
    { key: "llm", label: "Patch model", ok: llmConfigured(), detail: llmConfigured() ? `${llmModel()} via ${process.env.FORGE_LLM_BASE_URL ?? "api.openai.com"}` : "Analysis-only mode — no candidate patches", env: ["FORGE_LLM_API_KEY", "FORGE_LLM_BASE_URL", "FORGE_LLM_MODEL"], required: false },
    { key: "runner", label: "Runner shared secret", ok: Boolean(process.env.FORGE_RUNNER_SECRET), detail: "Authenticates the verification runner", env: ["FORGE_RUNNER_SECRET"], required: false },
    { key: "admin", label: "Admin token", ok: Boolean(process.env.FORGE_ADMIN_TOKEN), detail: process.env.FORGE_ADMIN_TOKEN ? "Admin API locked" : "Open local mode — set before exposing publicly", env: ["FORGE_ADMIN_TOKEN"], required: false },
  ];
  const mode = !dbOk ? "degraded" : caps.every((c) => c.ok) ? "full" : llmConfigured() && gh ? "autonomous" : "analysis";
  return { ok: dbOk, mode, publicUrl: publicUrl(), riskCeiling: RISK_CEILING, keyid, capabilities: caps };
}
