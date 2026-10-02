import Link from "next/link";
import type { Metadata } from "next";
import { PageCover, SectionHead } from "@/components/Chrome";
import { listRuns, runCounts, RUN_STATES, stateTone } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Repair Ledger — Aegis Forge",
  description:
    "Every repair run the control plane has attempted: certified patches, runs still inside the gate, and the escalations it refused to publish. Live from the run ledger.",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const state = params.state ?? params.status ?? "";
  const q = params.q ?? "";

  const [runs, counts] = await Promise.all([listRuns({ state: state || undefined, q: q || undefined }), runCounts()]);

  return (
    <>
      <PageCover
        clause="Section 03"
        eyebrow="The Repair Ledger"
        title={
          <>
            Every run the gate has <em className="italic text-navy">judged</em>, in full
          </>
        }
        standfirst="Certified patches, runs still inside the pipeline, and the ones the system refused to publish. The escalations are not hidden in a support channel — they sit in the same ledger, with the same evidence, and they are usually the most instructive rows on the page."
        meta={[
          { label: "Runs on file", value: String(counts.total) },
          { label: "Certified", value: String(counts.certified) },
          { label: "Escalated", value: String(counts.escalated) },
          { label: "In flight", value: String(counts.repairing + counts.verifying) },
        ]}
      />

      {/* ------------------------------------------------------- CONTROLS */}
      <section className="border-b border-ink/15 px-6 py-10 lg:px-12">
        <div className="mx-auto max-w-[1360px]">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="clause text-stone">Filter by verdict</div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/runs"
                  className={`border px-5 py-3 font-sans text-[15px] tracking-[0.08em] uppercase transition-colors ${
                    !state ? "border-ink bg-ink text-paper" : "border-ink/25 hover:border-ink"
                  }`}
                >
                  All runs
                </Link>
                {RUN_STATES.map((s) => {
                  const tone = stateTone(s);
                  const active = state === s;
                  return (
                    <Link
                      key={s}
                      href={`/runs?state=${s}`}
                      className={`border px-5 py-3 font-sans text-[15px] tracking-[0.08em] uppercase transition-colors ${
                        active
                          ? "border-ink bg-ink text-paper"
                          : "border-ink/25 text-ink hover:border-ink"
                      }`}
                    >
                      {tone.label}
                      <span className="num ml-3 text-[15px] opacity-70">{counts[s]}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <form action="/runs" method="get" className="w-full max-w-[420px]">
              {state ? <input type="hidden" name="state" value={state} /> : null}
              <label htmlFor="q" className="clause text-stone">
                Search repository, workflow, class or fingerprint
              </label>
              <div className="mt-4 flex">
                <input
                  id="q"
                  name="q"
                  defaultValue={q}
                  placeholder="e.g. gateway · AF-04 · sha256:7c1d"
                  className="min-w-0 flex-1 border border-ink/30 bg-paper px-5 py-4 font-mono text-[16px] text-ink placeholder:text-stone"
                />
                <button type="submit" className="btn btn-primary shrink-0 !px-7 !py-4">
                  Search
                </button>
              </div>
            </form>
          </div>

          {(q || state) && (
            <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-ink/15 pt-6">
              <span className="clause text-stone">
                Showing {runs.length} of {counts.total} runs
              </span>
              {q && <span className="mono text-[15px] text-navy">query: “{q}”</span>}
              {state && <span className="mono text-[15px] text-navy">verdict: {state}</span>}
              <Link href="/runs" className="label text-oxide underline underline-offset-4">
                Clear filters
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------- LEDGER */}
      <section className="px-6 py-16 lg:px-12 lg:py-20">
        <div className="mx-auto max-w-[1360px]">
          {runs.length === 0 ? (
            <div className="border border-ink/20 bg-paper-2 px-8 py-20 text-center">
              <h2 className="text-[clamp(26px,3.2vw,38px)] leading-[1.15]">
                No repair runs match that filter
              </h2>
              <p className="measure mt-6 text-[20px] leading-[1.6] text-ink-soft">
                The ledger only contains runs the control plane has actually attempted. If you were
                expecting a failure here, the likely explanation is that it never reached the
                ingress endpoint — check that the workflow_run webhook is subscribed and that its
                signature verifies.
              </p>
              <Link href="/runs" className="btn btn-ghost mt-9">
                Clear the filters
              </Link>
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[142px_1.35fr_1.35fr_145px_92px_92px] gap-6 border-t-[3px] border-ink px-2 py-4 xl:grid">
                <div className="clause text-stone">Run</div>
                <div className="clause text-stone">Repository / workflow</div>
                <div className="clause text-stone">Failure class</div>
                <div className="clause text-stone">Verdict</div>
                <div className="clause text-right text-stone">Risk</div>
                <div className="clause text-right text-stone">Cost</div>
              </div>

              <div>
                {runs.map((run) => {
                  const tone = stateTone(run.state);
                  return (
                    <Link
                      key={run.id}
                      href={`/runs/${run.id}`}
                      className="ledger-row grid gap-x-6 gap-y-4 px-2 py-7 xl:grid-cols-[142px_1.35fr_1.35fr_145px_92px_92px]"
                    >
                      <div>
                        <div className="num text-[19px] text-navy">{run.id}</div>
                        <div className="mono mt-2 text-[15px] text-stone">{run.commitSha}</div>
                        <div className="mono mt-1 text-[15px] text-stone xl:hidden">
                          {fmtDate(run.createdAt)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[19px] leading-[1.35]">{run.repo}</div>
                        <div className="mono mt-2 text-[15px] text-stone">{run.workflow}</div>
                      </div>

                      <div>
                        <div className="text-[18px] leading-[1.4] text-ink-soft">
                          {run.failureClass}
                        </div>
                        <div className="mono mt-2 truncate text-[15px] text-stone">
                          {run.fingerprint.slice(0, 26)}…
                        </div>
                      </div>

                      <div>
                        <span
                          className={`inline-flex items-center gap-2 border px-3 py-2 font-sans text-[15px] tracking-[0.1em] uppercase ${tone.bg} ${tone.fg}`}
                        >
                          <span className={`h-[8px] w-[8px] rounded-full ${tone.dot}`} />
                          {tone.label}
                        </span>
                      </div>

                      <div className="num text-[18px] xl:text-right">{run.riskScore}</div>
                      <div className="num text-[18px] xl:text-right">${run.costUsd}</div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------- NOTES */}
      <section className="border-t border-ink/15 bg-paper-2 px-6 py-24 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="3.1"
            title="How to read a ledger row"
            lead="Five numbers decide whether a repair run was worth doing. The rest of the record exists so you can disagree with the conclusion."
          />

          <div className="mt-14 grid gap-12 lg:grid-cols-3 lg:gap-14">
            {[
              {
                h: "Risk score",
                b: "A weighted function of reach outside the localised set, public signature change, dependency movement and the deletion ratio. The release policy ceiling is 0.35; anything above it is escalated regardless of how green the tests are.",
              },
              {
                h: "Cost",
                b: "Sandbox compute and model spend for the entire run, including candidates that were rejected and stages that failed. Escalations are charged at full cost, because a refused patch is not a free patch.",
              },
              {
                h: "Verdict",
                b: "Certified means the upstream build on the draft branch went green and the bundle was signed. Escalated means it did not, or could not be attempted, and a human has the trace. Rejected means the boundary held.",
              },
            ].map((c) => (
              <div key={c.h} className="border-t-[3px] border-ink pt-6">
                <h3 className="text-[clamp(23px,2.6vw,30px)] leading-[1.2]">{c.h}</h3>
                <p className="mt-5 text-[20px] leading-[1.62] text-ink-soft">{c.b}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 border-t border-ink/20 pt-10">
            <div className="clause text-stone">Legends · duration formatting</div>
            <div className="mt-6 grid gap-px border border-ink/20 bg-ink/20 sm:grid-cols-2 lg:grid-cols-4">
              {runs.slice(0, 4).map((r) => (
                <div key={r.id} className="bg-paper-2 px-6 py-6">
                  <div className="mono text-[15px] text-navy">{r.id}</div>
                  <div className="num mt-3 text-[19px]">{fmtDuration(r.durationSec)}</div>
                  <div className="clause mt-2 text-stone">
                    {r.testsAfter - r.testsBefore >= 0 ? "+" : ""}
                    {r.testsAfter - r.testsBefore} tests
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
