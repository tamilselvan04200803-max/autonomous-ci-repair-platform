import type { Metadata } from "next";
import Link from "next/link";
import { PageCover, SectionHead } from "@/components/Chrome";
import { integrationStatus } from "@/lib/forge/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Setup & integration status — Aegis Forge",
  description: "Live status of this Aegis Forge control plane and step-by-step instructions to connect a GitHub repository.",
};

const MODE_COPY: Record<string, { title: string; body: string }> = {
  analysis: { title: "Analysis mode", body: "Logs can be analysed and runs opened manually. Add a patch model and GitHub access to enable autonomous repair." },
  autonomous: { title: "Autonomous mode", body: "Patch generation and GitHub are configured. Make sure the webhook secret and runner secret are set too." },
  full: { title: "Fully configured", body: "Every integration is live. Failed workflow runs will be repaired and certified end to end." },
  degraded: { title: "Degraded", body: "The database is unreachable. Nothing can be recorded until DATABASE_URL points at a running PostgreSQL." },
};

export default async function SetupPage() {
  const s = await integrationStatus();
  const mode = MODE_COPY[s.mode] ?? MODE_COPY.analysis;

  return (
    <>
      <PageCover
        clause="Operate"
        eyebrow="Setup & status"
        title={<>Connect a repository in <em className="italic text-navy">fifteen</em> minutes</>}
        standfirst="This page reads the live configuration of this control plane. Secrets are never displayed — only whether they are present. Follow the steps in order; each one unlocks a stage of the pipeline."
        meta={[
          { label: "Mode", value: mode.title },
          { label: "Risk ceiling", value: String(s.riskCeiling) },
          { label: "Signing key", value: s.keyid.slice(0, 22) },
          { label: "Public URL", value: s.publicUrl.replace(/^https?:\/\//, "").slice(0, 22) },
        ]}
      />

      <section className="px-6 py-20 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead clause="S.1" title="Integration status" lead={mode.body} />
          <div className="mt-12 border-t-[3px] border-ink">
            {s.capabilities.map((c) => (
              <div key={c.key} className="ledger-row grid gap-4 px-2 py-6 lg:grid-cols-[48px_1fr_1.3fr_1fr] lg:gap-8">
                <span className={`mt-1 inline-block h-4 w-4 rounded-full ${c.ok ? "bg-certified" : c.required ? "bg-oxide" : "bg-amber"}`} role="status" aria-label={c.ok ? "configured" : "not configured"}>
                  <span className="sr-only">{c.ok ? "configured" : "not configured"}</span>
                </span>
                <div>
                  <div className="text-[21px] leading-[1.3]">{c.label}</div>
                  <div className="clause mt-2 text-stone">{c.ok ? "configured" : c.required ? "required" : "optional"}</div>
                </div>
                <p className="text-[18px] leading-[1.55] text-ink-soft">{c.detail}</p>
                <div className="mono text-[15px] text-navy">{c.env.join("  ·  ")}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-ink/15 bg-paper-2 px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-[1080px]">
          <SectionHead clause="S.2" title="Connect a GitHub repository" lead="Six steps. Steps 1–2 give you analysis on every red build; steps 3–6 turn on autonomous, evidence-gated repair." />
          <ol className="mt-14 space-y-12">
            {[
              {
                h: "Expose the control plane",
                b: "Deploy with Docker (see README) or any Node host, and set FORGE_PUBLIC_URL to its HTTPS address. GitHub must be able to reach it.",
                code: `FORGE_PUBLIC_URL=https://forge.example.com\nFORGE_ADMIN_TOKEN=$(openssl rand -hex 32)`,
              },
              {
                h: "Add the webhook",
                b: "Repository → Settings → Webhooks → Add webhook. Content type application/json, select only “Workflow runs”. Use the same random secret on both sides.",
                code: `Payload URL:  ${s.publicUrl}/api/webhooks/github\nSecret:       GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)\nEvents:       Workflow runs`,
              },
              {
                h: "Give the control plane GitHub access",
                b: "Either a fine-grained PAT, or a GitHub App for organisations. Permissions: Actions read, Checks write, Contents read, Pull requests write, Metadata read.",
                code: `GITHUB_TOKEN=github_pat_…\n# or\nGITHUB_APP_ID=123456\nGITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n…"`,
              },
              {
                h: "Configure a patch model",
                b: "Any OpenAI-compatible endpoint works: OpenAI, Azure, OpenRouter, Together, a local vLLM or Ollama. The model only produces text; it never executes anything.",
                code: `FORGE_LLM_API_KEY=sk-…\nFORGE_LLM_BASE_URL=https://api.openai.com/v1\nFORGE_LLM_MODEL=gpt-4o-mini\nFORGE_CANDIDATES=3`,
              },
              {
                h: "Install the verification workflow",
                b: "Copy the template into the repository. The GitHub-hosted runner is the clean sandbox. Add AEGIS_URL as a repository variable and AEGIS_RUNNER_SECRET as a secret, matching FORGE_RUNNER_SECRET here.",
                code: `curl -fsSL ${s.publicUrl}/runner/aegis-verify.yml \\\n  -o .github/workflows/aegis-verify.yml\ngh variable set AEGIS_URL --body ${s.publicUrl}\ngh secret set AEGIS_RUNNER_SECRET`,
              },
              {
                h: "Break a build on purpose",
                b: "Push a commit that renames an export. Within a minute a check run appears on the commit; a few minutes later a draft PR with the proof bundle, which is certified once its own CI is green.",
                code: `git commit -am "chore: rename OrderState" && git push\n# then watch: ${s.publicUrl}/runs`,
              },
            ].map((step, i) => (
              <li key={step.h} className="grid gap-8 border-t-[3px] border-ink pt-8 lg:grid-cols-[90px_1fr_1.1fr] lg:gap-12">
                <div className="num text-[44px] leading-[1] text-oxide">{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <h3 className="text-[clamp(23px,2.6vw,30px)] leading-[1.2]">{step.h}</h3>
                  <p className="mt-4 text-[19px] leading-[1.6] text-ink-soft">{step.b}</p>
                </div>
                <pre className="code-slab whitespace-pre-wrap break-words">{step.code}</pre>
              </li>
            ))}
          </ol>
          <div className="mt-16 flex flex-wrap justify-center gap-4">
            <Link href="/analyze" className="btn btn-primary">Try the analyser now</Link>
            <a href="/api/status" className="btn btn-ghost">Status JSON</a>
          </div>
        </div>
      </section>
    </>
  );
}
