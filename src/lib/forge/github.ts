import crypto from "node:crypto";

/* Minimal GitHub REST client. Supports either a fine-grained PAT
   (GITHUB_TOKEN) or a GitHub App (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY). */

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

export function githubConfigured(): "app" | "token" | null {
  if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) return "app";
  if (process.env.GITHUB_TOKEN) return "token";
  return null;
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function appJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: process.env.GITHUB_APP_ID }));
  const key = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64url(sig)}`;
}

const tokenCache = new Map<number, { token: string; exp: number }>();

export async function getToken(installationId?: number | null): Promise<string> {
  const mode = githubConfigured();
  if (mode === "token") return process.env.GITHUB_TOKEN!;
  if (mode === "app") {
    if (!installationId) throw new Error("GitHub App mode requires an installation id on the event");
    const hit = tokenCache.get(installationId);
    if (hit && hit.exp > Date.now() + 60_000) return hit.token;
    const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${appJwt()}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`installation token: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { token: string; expires_at: string };
    tokenCache.set(installationId, { token: j.token, exp: Date.parse(j.expires_at) });
    return j.token;
  }
  throw new Error("GitHub is not configured (set GITHUB_TOKEN or GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY)");
}

export async function gh<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; token: string; raw?: boolean },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${init.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "aegis-forge",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  if (init.raw) return (await res.text()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type Job = { id: number; name: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] };

/** Concatenated logs of every failed job in a workflow run (tail-capped per job). */
export async function fetchFailedLogs(repo: string, runId: number | string, token: string): Promise<{ log: string; jobs: string[] }> {
  const jobs = await gh<{ jobs: Job[] }>(`/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=50`, { token });
  const failed = jobs.jobs.filter((j) => j.conclusion === "failure");
  const parts: string[] = [];
  for (const job of failed.slice(0, 4)) {
    try {
      const text = await gh<string>(`/repos/${repo}/actions/jobs/${job.id}/logs`, { token, raw: true });
      parts.push(`##[group]Job ${job.name}\n##[endgroup]\n${text.slice(-400_000)}`);
    } catch (e) {
      parts.push(`(log for job ${job.name} unavailable: ${e instanceof Error ? e.message : e})`);
    }
  }
  return { log: parts.join("\n"), jobs: failed.map((j) => j.name) };
}

export async function getFileAtRef(repo: string, path: string, ref: string, token: string): Promise<string | null> {
  try {
    const j = await gh<{ content?: string; encoding?: string; size?: number }>(
      `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${ref}`,
      { token },
    );
    if (!j.content || (j.size ?? 0) > 200_000) return null;
    return Buffer.from(j.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export async function createCheckRun(repo: string, token: string, body: Record<string, unknown>) {
  return gh<{ id: number }>(`/repos/${repo}/check-runs`, { method: "POST", token, body: { name: "aegis-forge / evidence-gate", ...body } });
}

export async function updateCheckRun(repo: string, token: string, id: string | number, body: Record<string, unknown>) {
  return gh(`/repos/${repo}/check-runs/${id}`, { method: "PATCH", token, body });
}

export async function dispatchVerify(repo: string, token: string, runId: string) {
  return gh(`/repos/${repo}/dispatches`, {
    method: "POST",
    token,
    body: { event_type: "aegis-verify", client_payload: { run_id: runId } },
  });
}

export async function openDraftPr(repo: string, token: string, p: { head: string; base: string; title: string; body: string }) {
  return gh<{ number: number; html_url: string }>(`/repos/${repo}/pulls`, {
    method: "POST",
    token,
    body: { ...p, draft: true, maintainer_can_modify: true },
  });
}

export async function commentOnIssue(repo: string, token: string, num: number, body: string) {
  return gh(`/repos/${repo}/issues/${num}/comments`, { method: "POST", token, body: { body } });
}
