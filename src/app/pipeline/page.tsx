import Link from "next/link";
import type { Metadata } from "next";
import { PageCover, SectionHead, Specimen } from "@/components/Chrome";
import { Reveal } from "@/components/Motion";
import { STAGES } from "@/lib/data";

export const metadata: Metadata = {
  title: "The Pipeline — Aegis Forge",
  description:
    "Sixteen stages between a failed workflow_run and a certified patch: reproduction, localisation, regression testing, candidate verification, risk scoring and the signed evidence gate.",
};

const REFUSALS = [
  {
    n: "A",
    h: "The failure will not reproduce",
    b: "Three attempts, three clean sandboxes, one pinned image digest. If the reproduction diverges in any attempt, no candidate is generated and the run escalates with the divergence recorded. Aegis Forge has never published a patch for a failure it did not observe.",
  },
  {
    n: "B",
    h: "The regression test is vacuous",
    b: "The red-stage check proves the new test depends on production symbols by mutating the affected code path and observing the assertion move. A test whose truth value does not move is discarded and regenerated, up to three times.",
  },
  {
    n: "C",
    h: "The patch reaches outside its brief",
    b: "Any file touched outside the localised set requires a written justification in the bundle and lifts the risk score. Cross-boundary touches into authentication, authorisation or key handling are an automatic policy denial regardless of the score.",
  },
  {
    n: "D",
    h: "The tool boundary is probed",
    b: "A model call asking for an unlisted binary, an egress to a host outside the allow-list, or a write outside the workspace root ends that candidate immediately. The attempt is preserved as evidence rather than deleted.",
  },
  {
    n: "E",
    h: "The upstream build disagrees",
    b: "The final judge is the real CI run on the draft branch. If it is red, cancelled, or does not reach a conclusion inside the window, the repair is escalated rather than verified. The system does not overrule the repository's own build.",
  },
];

export default function PipelinePage() {
  return (
    <>
      <PageCover
        clause="Section 01"
        eyebrow="The Pipeline"
        title={
          <>
            Sixteen gates between a red build and a{" "}
            <em className="italic text-navy">certified</em> patch
          </>
        }
        standfirst="This is the whole machine, stage by stage, including the conditions under which each stage refuses to continue. Read it as a specification rather than a description: if a stage cannot produce its output, there is no fallback path that produces a patch anyway."
        meta={[
          { label: "Stages", value: "16" },
          { label: "Median wall clock", value: "23m 14s" },
          { label: "Refusal points", value: "5 defined" },
          { label: "Checkpoint interval", value: "30 s" },
        ]}
      />

      {/* ------------------------------------------------------- READING KEY */}
      <section className="px-6 py-20 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="1.1"
            title="How each stage is documented"
            lead="Every stage below carries the same five facts. Inputs and outputs define the contract; the refusal defines what happens when the contract cannot be met; the tooling names the boundary the work crosses; the median is measured, not estimated."
          />

          <div className="mt-14 grid gap-px border border-ink/20 bg-ink/20 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Inputs", "What the stage is given, and from where it came."],
              ["Outputs", "What the stage must produce to pass work downstream."],
              ["Refusal", "The condition under which the stage stops the run."],
              ["Tooling", "The boundary the work crosses — schema, sandbox or signature."],
              ["Median", "Measured wall-clock time across 41,206 production runs."],
            ].map(([k, v]) => (
              <div key={k} className="bg-paper px-6 py-8">
                <div className="clause text-oxide">{k}</div>
                <p className="mt-4 text-[18px] leading-[1.55] text-ink-soft">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- THE STAGES */}
      <section className="border-y border-ink/15 bg-paper-2 px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="1.2"
            title="The stages, in full"
            lead="Sixteen stages, numbered exactly as they appear in the run ledger and in the model and tool trace of every proof bundle."
          />

          <div className="mt-16 space-y-px bg-ink/15">
            {STAGES.map((s, i) => (
              <Reveal key={s.key} delay={Math.min(i * 0.02, 0.2)}>
                <article className="bg-paper-2 px-5 py-12 lg:px-10">
                  <div className="grid gap-10 lg:grid-cols-[130px_1fr] lg:gap-14">
                    <div>
                      <div className="num text-[clamp(40px,5vw,62px)] leading-[1] text-oxide">
                        {s.n}
                      </div>
                      <div className="mono mt-4 text-[15px] text-stone">{s.key}</div>
                      <div className="mt-6 border-t-[3px] border-navy pt-3">
                        <div className="clause text-stone">Median</div>
                        <div className="num mt-1 text-[19px] text-navy">{s.median}</div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-[clamp(27px,3.4vw,40px)] leading-[1.12]">{s.title}</h3>
                      <p className="mt-6 max-w-[68ch] text-[21px] leading-[1.62] text-ink-soft">
                        {s.summary}
                      </p>

                      <div className="mt-9 grid gap-px border border-ink/20 bg-ink/20 sm:grid-cols-2">
                        <div className="bg-paper-2 px-6 py-6">
                          <div className="clause text-stone">Inputs</div>
                          <p className="mt-3 text-[18px] leading-[1.55]">{s.inputs}</p>
                        </div>
                        <div className="bg-paper-2 px-6 py-6">
                          <div className="clause text-stone">Outputs</div>
                          <p className="mt-3 text-[18px] leading-[1.55]">{s.outputs}</p>
                        </div>
                        <div className="bg-paper-2 px-6 py-6">
                          <div className="clause text-oxide">Refusal conditions</div>
                          <p className="mt-3 text-[18px] leading-[1.55]">{s.failureMode}</p>
                        </div>
                        <div className="bg-paper-2 px-6 py-6">
                          <div className="clause text-stone">Tooling boundary</div>
                          <p className="mono mt-3 text-[15px] leading-[1.6]">{s.tooling}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- ORCHESTRATION */}
      <section className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="1.3"
            title="The pipeline is a durable workflow, not a script"
            lead="A repair run lasts minutes to hours and is interrupted constantly: sandboxes are reclaimed, model calls time out, artifact stores are briefly unavailable. Orchestration is what keeps a long autonomous process honest about what it has and has not done."
          />

          <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <div className="clause text-oxide">Durable execution</div>
              <p className="mt-6 text-[21px] leading-[1.62] text-ink-soft">
                Each stage is a Temporal activity with its own retry policy and its own timeout. The
                workflow is replay-safe: a worker that dies mid-verification loses no evidence,
                because the evidence store is written before the activity returns and the workflow
                history records what was committed.
              </p>
              <p className="mt-6 text-[21px] leading-[1.62] text-ink-soft">
                Checkpoints land every thirty seconds during long stages. An interrupted run resumes
                at the last checkpoint and records both attempts in its trace — which is why the
                interrupted-run failure class is handled without inventing a patch that was never
                generated.
              </p>

              <div className="mt-8 grid grid-cols-2 gap-px border border-ink/20 bg-ink/20">
                {[
                  ["Retry policy", "exponential, 5 attempts"],
                  ["Checkpoint", "every 30 s"],
                  ["Activity timeout", "per-stage, 60–900 s"],
                  ["History retention", "90 days"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-paper px-5 py-5">
                    <div className="clause text-stone">{k}</div>
                    <div className="num mt-2 text-[18px]">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="clause text-oxide">Idempotency</div>
              <Specimen label="Run key derivation">
{`run_key = sha256(
    repository            + "\\0" +
    workflow_id           + "\\0" +
    head_sha              + "\\0" +
    failure_fingerprint   + "\\0"
)

→ unique index repair_runs(run_key)

On conflict:
    return existing run
    record redelivery as evidence
    do not enqueue a second repair`}
              </Specimen>

              <div className="mt-10 clause text-oxide">Why the first ninety milliseconds matter</div>
              <p className="mt-6 text-[21px] leading-[1.62] text-ink-soft">
                GitHub must receive an acknowledgement quickly or it will redeliver. The ingress
                path verifies the signature, writes the delivery record and enqueues the workflow,
                then answers 202. Everything expensive happens after the response — which also
                means the ingress path is the only part of the system reachable from the internet,
                and it does exactly four things.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- REFUSALS */}
      <section className="relative overflow-hidden bg-console px-6 py-24 text-paper lg:px-12 lg:py-32">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage: "url(/images/console.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center right",
          }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-console via-console/90 to-console/55" aria-hidden="true" />

        <div className="relative mx-auto max-w-[1180px]">
          <SectionHead
            clause="1.4"
            dark
            title="What the pipeline refuses to do"
            lead="A repair system is defined by its refusals far more than by its successes. These five are enforced in code and in policy — there is no configuration that turns them off, because a gate you can switch off is not a gate."
          />

          <div className="mt-16 border-t border-paper/25">
            {REFUSALS.map((r, i) => (
              <Reveal key={r.n} delay={i * 0.05}>
                <div className="ledger-row-dark grid gap-8 px-2 py-9 lg:grid-cols-[90px_0.9fr_1.4fr] lg:gap-12">
                  <div className="num text-[32px] text-amber">{r.n}</div>
                  <h3 className="text-[clamp(23px,2.6vw,30px)] leading-[1.2]">{r.h}</h3>
                  <p className="text-[19px] leading-[1.62] text-paper/80">{r.b}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-16 flex flex-col items-center gap-6 text-center">
            <Link href="/proof-bundle" className="btn btn-on-dark">
              See what a certified patch carries
            </Link>
            <p className="max-w-[62ch] text-[19px] leading-[1.6] text-paper/70">
              Every refusal produces an escalation packet rather than silence: the full trace, the
              stage at which it stopped, and the specific condition that was not met.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
