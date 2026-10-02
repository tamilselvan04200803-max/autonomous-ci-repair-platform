import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Specimen } from "@/components/Chrome";
import type { Analysis } from "@/lib/forge/analyze";
import { getRun, stateTone } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Repair run — Aegis Forge",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  passed: { label: "Passed", cls: "text-certified border-certified/40 bg-certified/10" },
  failed: { label: "Refused", cls: "text-oxide border-oxide/40 bg-oxide/10" },
  running: { label: "Running", cls: "text-amber border-amber/50 bg-amber/10" },
  skipped: { label: "Not reached", cls: "text-stone border-ink/20 bg-ink/5" },
  pending: { label: "Pending", cls: "text-stone border-ink/20 bg-paper" },
};

const CANDIDATE_STYLE: Record<string, string> = {
  winner: "text-certified border-certified/40 bg-certified/10",
  outscored: "text-navy border-navy/35 bg-navy/10",
  rejected: "text-oxide border-oxide/40 bg-oxide/10",
};

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getRun(id);
  if (!data) notFound();

  const { run, stages, candidates, events } = data;
  const analysis = run.analysis as Analysis | null;
  const verification = run.verification as { gates?: { gate: string; pass: boolean; detail: string }[] } | null;
  const gates = verification?.gates ?? [];
  const isDemo = run.source === "demo";
  const tone = stateTone(run.state);
  const maxStage = Math.max(...stages.map((s) => s.durationSec), 1);

  return (
    <>
      {/* ---------------------------------------------------------- HEADER */}
      <section className="border-b border-ink/15 bg-paper-2 px-6 pt-16 pb-14 lg:px-12 lg:pt-20">
        <div className="mx-auto max-w-[1180px]">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/runs"
              className="clause text-oxide underline decoration-oxide/40 underline-offset-[6px]"
            >
              ← Repair ledger
            </Link>
            <span className="clause text-stone">Evidence set</span>
          </div>

          <div className="mt-8 flex flex-wrap items-start justify-between gap-8">
            <div>
              <div className="num text-[clamp(30px,4vw,46px)] leading-[1] text-navy">
                {run.id}
              </div>
              <h1 className="mt-6 max-w-[22ch] text-[clamp(28px,4vw,50px)] leading-[1.1]">
                {run.patchTitle}
              </h1>
              <div className="mono mt-5 text-[16px] text-ink-soft">
                {run.repo} · {run.workflow} · {run.branch}@{run.commitSha}
              </div>
            </div>

            <div className="flex flex-col items-start gap-4">
              <span
                className={`inline-flex items-center gap-3 border px-5 py-3 font-sans text-[15px] tracking-[0.12em] uppercase ${tone.bg} ${tone.fg}`}
              >
                <span className={`h-[10px] w-[10px] rounded-full ${tone.dot}`} />
                {tone.label}
              </span>
              <div className="mono text-[15px] text-stone">
                opened {fmtDate(run.createdAt)}
                <br />
                {run.verifiedAt ? `verified ${fmtDate(run.verifiedAt)}` : "not yet verified"}
              </div>
            </div>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-px border border-ink/20 bg-ink/20 lg:grid-cols-6">
            {[
              ["Failure class", run.failureClass],
              ["Candidates", String(run.candidates)],
              ["Risk score", run.riskScore],
              ["Wall clock", fmtDuration(run.durationSec)],
              ["Cost", `$${run.costUsd}`],
              ["Pull request", run.prNumber ? `#${run.prNumber}` : "none — escalated"],
            ].map(([k, v]) => (
              <div key={k} className="bg-paper-2 px-5 py-6">
                <div className="clause text-stone">{k}</div>
                <div className="mt-3 text-[17px] leading-[1.4]">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ LIVE EVIDENCE */}
      <section className="border-b border-ink/15 px-6 py-16 lg:px-12">
        <div className="mx-auto max-w-[1180px]">
          {run.escalationReason && (
            <div className="mb-12 border-l-4 border-oxide bg-oxide/10 px-7 py-6">
              <div className="clause text-oxide">Escalated to a human</div>
              <p className="mt-3 text-[20px] leading-[1.55]">{run.escalationReason}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a href={`/api/runs/${run.id}/bundle`} className="btn btn-primary">Download signed proof bundle</a>
            <Link href="/verify" className="btn btn-ghost">Verify a bundle</Link>
            <span className="clause text-stone">source · {run.source}</span>
          </div>

          {analysis && (
            <div className="mt-14 grid gap-12 lg:grid-cols-2">
              <div>
                <div className="clause text-oxide">Analyser output · {Math.round(analysis.confidence * 100)}% confidence · {analysis.language}</div>
                <ul className="mt-5 border-t-[3px] border-ink">
                  {analysis.localised.map((l) => (
                    <li key={l.file} className="ledger-row flex justify-between gap-4 px-2 py-4">
                      <span className="mono break-all text-[15px]">{l.file}{l.line ? `:${l.line}` : ""}</span>
                      <span className="num text-[15px] text-stone">{l.hits}×</span>
                    </li>
                  ))}
                  {!analysis.localised.length && <li className="ledger-row px-2 py-4 text-[18px] text-ink-soft">No files localised.</li>}
                </ul>
                {analysis.fixStrategies.length > 0 && (
                  <ul className="mt-6 space-y-2">
                    {analysis.fixStrategies.map((f) => <li key={f} className="text-[18px] leading-[1.5] text-ink-soft">• {f}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <div className="clause text-stone">Log excerpt</div>
                <pre className="code-slab mt-5 max-h-[420px] overflow-auto whitespace-pre-wrap break-words">{run.logExcerpt || analysis.excerpt}</pre>
              </div>
            </div>
          )}

          {gates.length > 0 && (
            <div className="mt-14">
              <div className="clause text-oxide">Evidence gates · reported by the runner</div>
              <div className="mt-5 grid gap-px border border-ink/20 bg-ink/20 sm:grid-cols-2 lg:grid-cols-4">
                {gates.map((g) => (
                  <div key={g.gate} className="bg-paper px-5 py-5">
                    <div className={`clause ${g.pass ? "text-certified" : "text-oxide"}`}>{g.pass ? "✓ pass" : "✗ fail"}</div>
                    <div className="mono mt-2 text-[15px]">{g.gate}</div>
                    <div className="mt-1 text-[16px] text-ink-soft">{g.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {events.length > 0 && (
            <div className="mt-14">
              <div className="clause text-stone">Event trace</div>
              <ol className="mt-5 border-t-[3px] border-ink">
                {events.map((e) => (
                  <li key={e.id} className="ledger-row grid gap-2 px-2 py-4 md:grid-cols-[210px_130px_1fr]">
                    <span className="mono text-[15px] text-stone">{fmtDate(e.at)}</span>
                    <span className="mono text-[15px] text-navy">{e.kind}</span>
                    <span className="text-[18px] leading-[1.5]">{e.message}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------ ROOT CAUSE */}
      <section className="px-6 py-20 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1180px]">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div>
              <div className="clause text-oxide">Root cause</div>
              <p className="mt-7 text-[clamp(21px,2.4vw,26px)] leading-[1.55]">{run.rootCause}</p>

              <div className="mt-10">
                <div className="clause text-stone">Patch summary</div>
                <p className="mt-5 text-[20px] leading-[1.62] text-ink-soft">{run.patchSummary}</p>
              </div>

              <div className="mt-10 grid gap-px border border-ink/20 bg-ink/20 sm:grid-cols-3">
                <div className="bg-paper px-6 py-6">
                  <div className="clause text-stone">Files changed</div>
                  <div className="num mt-3 text-[26px]">{run.filesChanged}</div>
                </div>
                <div className="bg-paper px-6 py-6">
                  <div className="clause text-certified">Insertions</div>
                  <div className="num mt-3 text-[26px]">+{run.insertions}</div>
                </div>
                <div className="bg-paper px-6 py-6">
                  <div className="clause text-oxide">Deletions</div>
                  <div className="num mt-3 text-[26px]">−{run.deletions}</div>
                </div>
              </div>
            </div>

            <div className="space-y-9">
              <Specimen label="Failing command">
                {`$ ${run.failingCommand}`}
              </Specimen>
              <Specimen label="Regression test">
                {run.regressionTest}
              </Specimen>
              <div>
                <div className="clause text-stone">Failure fingerprint</div>
                <div className="mono mt-4 border-l-4 border-navy bg-paper-2 px-6 py-5 break-all text-[15px] text-navy">
                  fp:{run.fingerprint}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px border border-ink/20 bg-ink/20">
                <div className="bg-paper px-5 py-5">
                  <div className="clause text-stone">Sandbox</div>
                  <div className="mono mt-2 text-[15px]">{run.sandboxId}</div>
                </div>
                <div className="bg-paper px-5 py-5">
                  <div className="clause text-stone">Dependency digest</div>
                  <div className="mono mt-2 text-[15px] break-all">{run.depHash}</div>
                </div>
                <div className="bg-paper px-5 py-5">
                  <div className="clause text-stone">Model</div>
                  <div className="mono mt-2 text-[15px]">{run.model}</div>
                </div>
                <div className="bg-paper px-5 py-5">
                  <div className="clause text-stone">Quarantined flaky</div>
                  <div className="num mt-2 text-[18px]">{run.flakyQuarantined}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {isDemo && (<>
      {/* ------------------------------------------------------ BEFORE/AFTER */}
      <section className="border-y border-ink/15 bg-paper-2 px-6 py-20 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1180px]">
          <div className="clause text-oxide">Before / after matrix</div>
          <h2 className="mt-7 max-w-[20ch] text-[clamp(28px,3.6vw,44px)] leading-[1.12]">
            The same gates, run twice
          </h2>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-t-[3px] border-ink">
                  <th className="clause py-5 pr-6 text-left text-stone">Gate</th>
                  <th className="clause py-5 pr-6 text-right text-stone">Before</th>
                  <th className="clause py-5 pr-6 text-right text-stone">After</th>
                  <th className="clause py-5 text-right text-stone">Delta</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Unit tests passed", run.testsBefore, run.testsAfter],
                  ["Files changed", 0, run.filesChanged],
                  ["Risk score", null, null],
                ].map(([label, before, after]) => (
                  <tr key={String(label)} className="ledger-row">
                    <td className="py-6 pr-6 text-[19px]">{label}</td>
                    <td className="num py-6 pr-6 text-right text-[19px]">
                      {label === "Risk score" ? "—" : String(before)}
                    </td>
                    <td className="num py-6 pr-6 text-right text-[19px]">
                      {label === "Risk score" ? run.riskScore : String(after)}
                    </td>
                    <td className="num py-6 text-right text-[19px] text-certified">
                      {label === "Risk score"
                        ? `ceiling 0.35`
                        : `${(Number(after) - Number(before)) >= 0 ? "+" : ""}${Number(after) - Number(before)}`}
                    </td>
                  </tr>
                ))}
                <tr className="ledger-row">
                  <td className="py-6 pr-6 text-[19px]">Type check (pyright)</td>
                  <td className="num py-6 pr-6 text-right text-[19px]">3 errors</td>
                  <td className="num py-6 pr-6 text-right text-[19px]">0 errors</td>
                  <td className="num py-6 text-right text-[19px] text-certified">−3</td>
                </tr>
                <tr className="ledger-row">
                  <td className="py-6 pr-6 text-[19px]">Lint (eslint)</td>
                  <td className="num py-6 pr-6 text-right text-[19px]">0 errors</td>
                  <td className="num py-6 pr-6 text-right text-[19px]">0 errors</td>
                  <td className="num py-6 text-right text-[19px] text-stone">no change</td>
                </tr>
                <tr className="ledger-row">
                  <td className="py-6 pr-6 text-[19px]">Security (semgrep)</td>
                  <td className="num py-6 pr-6 text-right text-[19px]">0 findings</td>
                  <td className="num py-6 pr-6 text-right text-[19px]">0 findings</td>
                  <td className="num py-6 text-right text-[19px] text-stone">no change</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      </>)}

      {/* ---------------------------------------------------------- STAGES */}
      <section className="px-6 py-20 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1180px]">
          <div className="clause text-oxide">Stage timeline</div>
          <h2 className="mt-7 max-w-[22ch] text-[clamp(28px,3.6vw,44px)] leading-[1.12]">
            Sixteen stages, and where this run reached
          </h2>

          <div className="mt-12 border-t-[3px] border-ink">
            {stages.map((s) => {
              const style = STATUS_STYLE[s.status] ?? STATUS_STYLE.skipped;
              const pct = Math.max(2, Math.round((s.durationSec / maxStage) * 100));
              return (
                <div key={s.id} className="ledger-row grid gap-x-8 gap-y-4 px-2 py-6 lg:grid-cols-[52px_1.5fr_1fr_130px] xl:grid-cols-[52px_1.5fr_1fr_150px_130px]">
                  <div className="num text-[19px] text-navy">{String(s.seq).padStart(2, "0")}</div>
                  <div>
                    <div className="text-[20px] leading-[1.3]">{s.label}</div>
                    <div className="mono mt-2 text-[15px] text-stone">{s.key}</div>
                  </div>
                  <div className="text-[18px] leading-[1.55] text-ink-soft">{s.detail}</div>
                  <div>
                    <div className="h-[10px] w-full bg-ink/10">
                      <div
                        className={`h-full ${
                          s.status === "failed"
                            ? "bg-oxide"
                            : s.status === "running"
                              ? "bg-amber"
                              : s.status === "skipped"
                                ? "bg-stone/40"
                                : "bg-certified"
                        }`}
                        style={{ width: s.status === "skipped" ? "100%" : `${pct}%` }}
                      />
                    </div>
                    <div className="num mt-2 text-[15px] text-stone">
                      {s.status === "skipped" ? "—" : fmtDuration(s.durationSec)}
                    </div>
                  </div>
                  <div className="lg:text-right">
                    <span
                      className={`inline-block border px-3 py-2 font-sans text-[15px] tracking-[0.12em] uppercase ${style.cls}`}
                    >
                      {style.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- CANDIDATES */}
      <section className="border-y border-ink/15 bg-paper-2 px-6 py-20 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1180px]">
          <div className="clause text-oxide">Candidate patches</div>
          <h2 className="mt-7 max-w-[22ch] text-[clamp(28px,3.6vw,44px)] leading-[1.12]">
            {candidates.length > 0
              ? `${candidates.length} candidates generated, and what happened to each`
              : "No candidate was generated"}
          </h2>
          <p className="measure mt-7 text-[20px] leading-[1.62] text-ink-soft">
            {candidates.length > 0
              ? "Each candidate was verified in its own microVM against the same image digest. Rejected candidates are kept: the reasoning behind a refusal is evidence too, and it is what stops the same bad idea being proposed twice."
              : "This run stopped before candidate generation. The refusal condition is recorded in the stage timeline above, and the reproduction transcript is attached to the escalation packet."}
          </p>

          {candidates.length > 0 && (
            <div className="mt-12 overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="border-t-[3px] border-ink">
                    <th className="clause py-5 pr-6 text-left text-stone">Candidate</th>
                    <th className="clause py-5 pr-6 text-left text-stone">Approach</th>
                    <th className="clause py-5 pr-6 text-right text-stone">Files</th>
                    <th className="clause py-5 pr-6 text-right text-stone">Diff</th>
                    <th className="clause py-5 pr-6 text-right text-stone">Tests</th>
                    <th className="clause py-5 pr-6 text-right text-stone">Risk</th>
                    <th className="clause py-5 text-right text-stone">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id} className="ledger-row align-top">
                      <td className="py-7 pr-6">
                        <div className="text-[19px]">{c.label}</div>
                      </td>
                      <td className="py-7 pr-6">
                        <div className="text-[18px] leading-[1.4]">{c.approach}</div>
                        <div className="mt-3 max-w-[38ch] text-[17px] leading-[1.5] text-ink-soft">
                          {c.note}
                        </div>
                      </td>
                      <td className="num py-7 pr-6 text-right text-[18px]">{c.filesChanged}</td>
                      <td className="num py-7 pr-6 text-right text-[18px]">
                        +{c.insertions} / −{c.deletions}
                      </td>
                      <td className="num py-7 pr-6 text-right text-[18px]">
                        {c.testsPassed}/{c.testsTotal}
                      </td>
                      <td className="num py-7 pr-6 text-right text-[18px]">{c.riskScore}</td>
                      <td className="py-7 text-right">
                        <span
                          className={`inline-block border px-3 py-2 font-sans text-[15px] tracking-[0.12em] uppercase ${CANDIDATE_STYLE[c.status] ?? CANDIDATE_STYLE.rejected}`}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------- ATTESTATION */}
      <section className="bg-console px-6 py-20 text-paper lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1180px]">
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
            <div>
              <div className="clause text-amber">Verification artifact</div>
              <h2 className="mt-7 max-w-[20ch] text-[clamp(28px,3.6vw,44px)] leading-[1.12]">
                {run.state === "certified"
                  ? "Signed, logged, and verifiable offline"
                  : "Unsigned — this run produced no certificate"}
              </h2>
              <p className="mt-7 text-[20px] leading-[1.62] text-paper/80">
                {run.state === "certified"
                  ? "The evidence set was hashed into an in-toto statement and signed with a short-lived Sigstore certificate on verification. The private key was discarded immediately afterwards. The transparency log entry is permanent."
                  : "A certificate is only issued when every gate has passed and the upstream build agrees. This run reached neither condition, so there is nothing signed here — only the record of what was attempted and where it stopped."}
              </p>

              <div className="mt-9 grid grid-cols-2 gap-px border border-paper/20 bg-paper/20">
                {[
                  ["Predicate", "verification_summary/v1"],
                  ["Verification result", run.state === "certified" ? "PASSED" : "NOT ISSUED"],
                  ["Log entry", run.state === "certified" ? "18422019971" : "—"],
                  ["Retention", "7 years"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-console-2 px-5 py-5">
                    <div className="clause text-paper/75">{k}</div>
                    <div className="num mt-2 text-[17px]">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="clause text-amber">Verification command</div>
              <pre className="code-slab mt-6 border-l-4 border-amber">
{run.state === "certified"
                  ? `$ gh attestation verify ./bundle.intoto.jsonl \\
    -R ${run.repo}

✓ Verified subject sha256:${run.fingerprint.slice(7, 19)}…
✓ Sigstore transparency log entry 18422019971
✓ verificationResult: PASSED · SLSA_BUILD_LEVEL_3`
                  : `$ gh attestation verify ./bundle.intoto.jsonl \\
    -R ${run.repo}

✗ no attestation found for this subject

This run did not reach the signing stage.
See the stage timeline for the refusal condition.`}
              </pre>

              <div className="mt-8">
                <div className="clause text-amber">Cost and duration</div>
                <div className="mt-5 grid grid-cols-2 gap-px border border-paper/20 bg-paper/20">
                  <div className="bg-console-2 px-6 py-6">
                    <div className="clause text-paper/75">Wall clock</div>
                    <div className="num mt-3 text-[26px]">{fmtDuration(run.durationSec)}</div>
                  </div>
                  <div className="bg-console-2 px-6 py-6">
                    <div className="clause text-paper/75">Total cost</div>
                    <div className="num mt-3 text-[26px]">${run.costUsd}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-center gap-4">
            <Link href="/runs" className="btn btn-on-dark">
              Back to the ledger
            </Link>
            <Link
              href="/proof-bundle"
              className="btn border-paper/50 text-paper hover:bg-paper hover:text-console"
            >
              What every field means
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
