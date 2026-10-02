"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Analysis } from "@/lib/forge/analyze";

type Sample = { key: string; label: string; log: string };

export function AnalyzeConsole({ samples }: { samples: Sample[] }) {
  const router = useRouter();
  const [log, setLog] = useState(samples[0]?.log ?? "");
  const [active, setActive] = useState(samples[0]?.key ?? "");
  const [result, setResult] = useState<{ analysis: Analysis; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState("");
  const [sha, setSha] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(text = log) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ log: text }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "analysis failed");
      setResult({ analysis: j.analysis, ms: j.ms });
      requestAnimationFrame(() => document.getElementById("analysis-result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function openRun() {
    setOpening(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ log, repo: repo || undefined, commitSha: sha || undefined, propose: true }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "could not open run");
      router.push(j.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not open run");
      setOpening(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setLog(text);
    setActive("");
    run(text);
  }

  const a = result?.analysis;

  return (
    <div>
      {/* ------------------------------------------------ input */}
      <div className="mx-auto max-w-[1080px]">
        <div className="clause text-center text-stone">Presets — real-shaped failures</div>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {samples.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => { setLog(s.log); setActive(s.key); setResult(null); }}
              className={`border px-4 py-3 font-sans text-[15px] tracking-[0.04em] transition-colors ${
                active === s.key ? "border-ink bg-ink text-paper" : "border-ink/25 hover:border-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <label htmlFor="log" className="clause text-stone">
              CI log — GitHub Actions, GitLab, CircleCI, Jenkins or plain terminal output
            </label>
            <div className="flex gap-3">
              <button type="button" onClick={() => fileRef.current?.click()} className="label text-navy underline underline-offset-4">
                Upload .log / .txt
              </button>
              <button type="button" onClick={() => { setLog(""); setActive(""); setResult(null); }} className="label text-oxide underline underline-offset-4">
                Clear
              </button>
              <input ref={fileRef} type="file" accept=".log,.txt,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
          </div>
          <textarea
            id="log"
            value={log}
            onChange={(e) => { setLog(e.target.value); setActive(""); }}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            onDragOver={(e) => e.preventDefault()}
            spellCheck={false}
            placeholder="Paste the raw log of a failed job, or drop a file here…"
            className="mt-4 h-[380px] w-full resize-y border border-ink/30 bg-console p-6 font-mono text-[15px] leading-[1.65] text-[#d9e2ec] placeholder:text-paper/50"
          />
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button type="button" onClick={() => run()} disabled={busy || !log.trim()} className="btn btn-primary disabled:opacity-50">
              {busy ? "Analysing…" : "Analyse failure"}
            </button>
            <span className="mono text-[15px] text-stone">
              {log.length.toLocaleString()} chars · runs locally on this server · nothing is stored
            </span>
          </div>
          {error && (
            <div role="alert" className="mx-auto mt-6 max-w-[720px] border-l-4 border-oxide bg-oxide/10 px-6 py-4 text-[18px] text-oxide">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ result */}
      {a && (
        <div id="analysis-result" className="mx-auto mt-20 max-w-[1180px] scroll-mt-28">
          <div className="text-center">
            <div className="clause text-oxide">Analysis · {result!.ms} ms</div>
            <h2 className="mx-auto mt-6 max-w-[24ch] text-[clamp(30px,4vw,48px)] leading-[1.1]">{a.classLabel}</h2>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <span className={`border px-4 py-2 font-sans text-[14px] uppercase tracking-[0.12em] ${a.repairable ? "border-certified/40 bg-certified/10 text-certified" : "border-oxide/40 bg-oxide/10 text-oxide"}`}>
                {a.repairable ? "Eligible for autonomous repair" : "Escalate — do not auto-repair"}
              </span>
              <span className="mono border border-ink/20 px-4 py-2 text-[15px]">confidence {Math.round(a.confidence * 100)}%</span>
              <span className="mono border border-ink/20 px-4 py-2 text-[15px]">{a.language}</span>
            </div>
          </div>

          <div className="mt-12 grid gap-px border border-ink/20 bg-ink/20 md:grid-cols-2">
            <div className="bg-paper px-7 py-7">
              <div className="clause text-stone">Failing command</div>
              <div className="mono mt-3 break-all text-[16px] text-navy">{a.failingCommand ?? "— not recovered"}</div>
              {a.exitCode !== null && <div className="mono mt-2 text-[15px] text-stone">exit code {a.exitCode}</div>}
            </div>
            <div className="bg-paper px-7 py-7">
              <div className="clause text-stone">Failure fingerprint</div>
              <div className="mono mt-3 break-all text-[15px] text-certified">{a.fingerprint}</div>
              <div className="mono mt-2 text-[15px] text-stone">cluster {a.cluster}</div>
            </div>
          </div>

          <div className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="clause text-oxide">Root-cause hint</div>
              <p className="mt-5 text-[21px] leading-[1.6]">{a.rootCauseHint}</p>
              {a.escalationReason && (
                <p className="mt-5 border-l-4 border-oxide pl-5 text-[19px] leading-[1.6] text-oxide">{a.escalationReason}</p>
              )}
              {a.fixStrategies.length > 0 && (
                <>
                  <div className="clause mt-9 text-stone">Fix strategies, in order of preference</div>
                  <ol className="mt-4 space-y-3">
                    {a.fixStrategies.map((f, i) => (
                      <li key={f} className="flex gap-4 text-[19px] leading-[1.55]">
                        <span className="num text-navy">{i + 1}.</span>
                        <span className="text-ink-soft">{f}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
            <div>
              <div className="clause text-oxide">Localised files</div>
              {a.localised.length ? (
                <ul className="mt-5 border-t-[3px] border-ink">
                  {a.localised.map((l) => (
                    <li key={l.file} className="ledger-row flex items-baseline justify-between gap-4 px-2 py-4">
                      <span className="mono break-all text-[15px]">{l.file}{l.line ? `:${l.line}` : ""}</span>
                      <span className="num shrink-0 text-[15px] text-stone">{l.hits}× · {l.score}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 text-[19px] text-ink-soft">No repository file references were found in the log.</p>
              )}
            </div>
          </div>

          {a.errors.length > 0 && (
            <div className="mt-14">
              <div className="clause text-stone">Parsed errors ({a.errors.length})</div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead>
                    <tr className="border-t-[3px] border-ink text-left">
                      <th className="clause py-4 pr-4 text-stone">Tool</th>
                      <th className="clause py-4 pr-4 text-stone">Code</th>
                      <th className="clause py-4 pr-4 text-stone">Location</th>
                      <th className="clause py-4 text-stone">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.errors.slice(0, 12).map((e, i) => (
                      <tr key={i} className="ledger-row align-top">
                        <td className="mono py-4 pr-4 text-[15px]">{e.tool}</td>
                        <td className="mono py-4 pr-4 text-[15px] text-oxide">{e.code ?? "—"}</td>
                        <td className="mono py-4 pr-4 text-[15px] text-navy">{e.file ? `${e.file}${e.line ? `:${e.line}` : ""}` : "—"}</td>
                        <td className="py-4 text-[17px] leading-[1.5]">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-14">
            <div className="clause text-stone">Fingerprint input — what was actually hashed</div>
            <pre className="paper-slab mt-4 whitespace-pre-wrap break-words">{a.fingerprintInput}</pre>
          </div>

          {/* --------------------------------------------- open a run */}
          <div className="mt-16 border border-ink/25 bg-paper-2 px-7 py-10 lg:px-12">
            <div className="text-center">
              <div className="clause text-oxide">Next step</div>
              <h3 className="mx-auto mt-5 max-w-[26ch] text-[clamp(24px,3vw,34px)] leading-[1.18]">
                Open this as a repair run in the ledger
              </h3>
              <p className="measure mt-5 text-[19px] leading-[1.6] text-ink-soft">
                Creates an idempotent run (the same failure on the same commit is never opened twice). If a patch model is configured,
                candidate patches are generated and screened by policy; with GitHub configured, verification is dispatched to your runner.
              </p>
            </div>
            <div className="mx-auto mt-8 grid max-w-[760px] gap-4 sm:grid-cols-2">
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo (optional)" aria-label="Repository owner and name (optional)" className="border border-ink/30 bg-paper px-5 py-4 font-mono text-[16px]" />
              <input value={sha} onChange={(e) => setSha(e.target.value)} placeholder="commit sha (optional)" aria-label="Commit SHA (optional)" className="border border-ink/30 bg-paper px-5 py-4 font-mono text-[16px]" />
            </div>
            <div className="mt-8 text-center">
              <button type="button" onClick={openRun} disabled={opening} className="btn btn-primary disabled:opacity-50">
                {opening ? "Opening run…" : "Open repair run"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
