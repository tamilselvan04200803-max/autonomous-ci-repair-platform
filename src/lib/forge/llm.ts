import type { Analysis } from "./analyze";

/* Candidate patch generation through any OpenAI-compatible chat endpoint
   (OpenAI, Azure OpenAI, OpenRouter, Together, vLLM, Ollama …).
   The model never executes anything: it returns text that the runner
   verifies inside a clean CI job. */

export type Candidate = {
  approach: string;
  rootCause: string;
  testPath: string;
  testContent: string;
  testCommand: string;
  patch: string;
  rationale: string;
  tokens: number;
};

export function llmConfigured(): boolean {
  return Boolean(process.env.FORGE_LLM_API_KEY);
}

export function llmModel(): string {
  return process.env.FORGE_LLM_MODEL ?? "gpt-4o-mini";
}

const SYSTEM = `You are the patch author inside Aegis Forge, an evidence-gated CI repair system.
You receive a classified CI failure and the contents of the localised files.
Return ONLY a JSON object with these keys:
  "approach":      short name of the strategy (e.g. "update call site to new signature")
  "root_cause":    2-4 sentences, in the repository's vocabulary, naming the mechanism
  "test_path":     path of a NEW regression test file in the repo's existing test style
  "test_content":  full content of that test file. It MUST fail on the current code for the
                   reported reason and pass once the patch is applied.
  "test_command":  the narrowest command that runs only that test file
  "patch":         a unified diff (git apply compatible, a/ and b/ prefixes, correct hunk
                   headers) that fixes the defect. Do NOT include the regression test in it.
                   Do NOT touch CI config, lockfiles, auth code or unrelated files.
  "rationale":     why this patch is minimal and correct
Prefer the smallest change inside the localised files. Never delete existing tests.`;

export async function generateCandidates(input: {
  analysis: Analysis;
  repo: string;
  files: { path: string; content: string }[];
  count: number;
}): Promise<Candidate[]> {
  if (!llmConfigured()) return [];
  const base = (process.env.FORGE_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const a = input.analysis;
  const user = [
    `Repository: ${input.repo}`,
    `Failure class: ${a.classLabel} (${a.language}, confidence ${a.confidence})`,
    `Failing command: ${a.failingCommand}`,
    `Primary error: ${a.primaryError ? `${a.primaryError.code ?? ""} ${a.primaryError.message} @ ${a.primaryError.file ?? "?"}:${a.primaryError.line ?? "?"}` : "n/a"}`,
    `Deterministic hint: ${a.rootCauseHint}`,
    `Log excerpt:\n\`\`\`\n${a.excerpt.slice(0, 5000)}\n\`\`\``,
    ...input.files.map((f) => {
      const numbered = f.content.split("\n").slice(0, 500).map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n");
      return `File ${f.path}:\n\`\`\`\n${numbered}\n\`\`\``;
    }),
  ].join("\n\n");

  const temps = [0.1, 0.5, 0.8, 0.3, 0.65, 0.9].slice(0, Math.max(1, Math.min(6, input.count)));
  const results = await Promise.allSettled(
    temps.map(async (temperature) => {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.FORGE_LLM_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: llmModel(),
          temperature,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as {
        choices: { message: { content: string } }[];
        usage?: { total_tokens?: number };
      };
      const rawContent = j.choices?.[0]?.message?.content?.trim() ?? "";
      const cleaned = rawContent.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const o = JSON.parse(cleaned) as Record<string, string>;
      if (!o.patch || !o.patch.includes("@@")) throw new Error("model returned no usable diff");
      return {
        approach: String(o.approach ?? "model patch").slice(0, 120),
        rootCause: String(o.root_cause ?? ""),
        testPath: String(o.test_path ?? ""),
        testContent: String(o.test_content ?? ""),
        testCommand: String(o.test_command ?? ""),
        patch: String(o.patch),
        rationale: String(o.rationale ?? ""),
        tokens: j.usage?.total_tokens ?? 0,
      } satisfies Candidate;
    }),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
