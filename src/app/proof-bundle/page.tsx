import Link from "next/link";
import type { Metadata } from "next";
import { PageCover, SectionHead } from "@/components/Chrome";
import { Reveal } from "@/components/Motion";
import { PROOF_FIELDS } from "@/lib/data";

export const metadata: Metadata = {
  title: "The Proof Bundle — Aegis Forge",
  description:
    "Thirteen fields travel with every Aegis Forge patch: root cause, failure fingerprint, failing command, regression test, diff, before/after matrix, impacted-test rationale, policy results, sandbox identity, dependency hashes, tool trace, cost and a signed verification artifact.",
};

const AUDIT_STEPS = [
  {
    n: "01",
    h: "Read the root cause before the diff",
    b: "If the explanation does not name a mechanism you recognise, stop. Everything below is downstream of that sentence, and a bundle whose root cause is vague will have a diff that is vague for the same reason.",
  },
  {
    n: "02",
    h: "Replay the failing command",
    b: "It is one line on an unmodified checkout. Under a minute. If the failure you see is not the failure described, the fingerprint is wrong and the whole bundle collapses — this is the cheapest possible falsification.",
  },
  {
    n: "03",
    h: "Read the regression test, not the patch",
    b: "The test is what remains after the fix is forgotten. It should look like it was written by someone on your team, use your fixtures, and fail for the documented reason if you check it out on the parent commit.",
  },
  {
    n: "04",
    h: "Check the impacted-test rationale",
    b: "The number of tests run means nothing without the derivation. Look for the exclusions: what was left out, and why was leaving it out safe? That paragraph is where honest systems show their working.",
  },
  {
    n: "05",
    h: "Verify the signature",
    b: "One command. If it does not verify, everything above is an unverified document on the internet. The check run says the same thing in plain language on the pull request itself.",
  },
];

export default function ProofBundlePage() {
  return (
    <>
      <PageCover
        clause="Section 02"
        eyebrow="The Proof Bundle"
        title={
          <>
            The pull request is the evidence, not a{" "}
            <em className="italic text-navy">summary</em> of it
          </>
        }
        standfirst="Thirteen fields travel with every patch Aegis Forge publishes. Together they answer the only three questions a reviewer actually has: why did it break, why does this fix it, and what would it mean if you were wrong?"
        meta={[
          { label: "Fields", value: "13" },
          { label: "Format", value: "in-toto v1" },
          { label: "Retention", value: "7 years" },
          { label: "Verify with", value: "one command" },
        ]}
      />

      {/* ------------------------------------------------ WHAT A REVIEWER GETS */}
      <section className="px-6 py-20 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="2.1"
            title="What lands in your pull requests"
            lead="A draft PR, a check run, and a description long enough to be worth reading. Nothing is summarised away — the summary is at the top and the evidence is underneath it, in full."
          />

          <div className="mt-14">
            <div className="mx-auto max-w-[900px] border border-ink/25 bg-paper-2 shadow-[0_28px_60px_-38px_rgba(22,24,28,0.55)]">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/20 px-8 py-6">
                <div>
                  <div className="clause text-stone">Draft pull request</div>
                  <h3 className="mt-3 text-[clamp(22px,2.6vw,29px)] leading-[1.25]">
                    fix(gateway): type serialize() against the narrowed OrderState union
                  </h3>
                </div>
                <div className="border border-certified/45 bg-certified/10 px-4 py-2">
                  <div className="clause text-certified">Certified</div>
                </div>
              </div>

              <div className="px-8 py-8">
                <pre className="paper-slab whitespace-pre-wrap break-words leading-[1.75]">
{`## Root cause

PR #4412 narrowed OrderState to a discriminated union while the gateway
serializer still returns a free-form object. The annotation \`any\` at the
return site is the defect: it silenced the checker exactly where the
contract changed. The fix types the serializer explicitly and widens the
union's fallback arm so downstream readers stay exhaustive.

## Evidence

| Field                 | Value                                        |
|-----------------------|----------------------------------------------|
| Failure fingerprint   | fp:sha256:7c1d9a02e4b6f38c…c2d4e6f81          |
| Failing command       | pnpm --filter @aegis/gateway test:unit serialize.spec.ts |
| Regression test       | serialize.spec.ts › emits a discriminated OrderState payload |
| Red on parent commit  | yes · TypeError, matching fingerprint         |
| Green on patch        | yes · 814/814                                 |
| Impact rationale      | 3 modules, 1 public entry point               |
| Security policy       | aegis.patch.release/v4 → allow                |
| Sandbox identity      | sbx_7f3a91c4 @ sha256:4b19…e0a7               |
| Risk score            | 0.12 (ceiling 0.35)                           |
| Cost / duration       | $3.33 / 23m 14s                               |
| Verification artifact | bundle.intoto.jsonl · signed · log 18422019971 |

## What this does not claim

- The patch does not change runtime behaviour for existing callers.
- Type-level only: no serialisation format change is asserted here.
- The impacted set excludes services/billing, which imports order-types
  through type positions only (erased at compile time). Derivation is in
  the trace under span impact.graph/3.`}
                </pre>
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-ink/20 px-8 py-6">
                <span className="clause text-certified">✓ aegis-forge / evidence-gate</span>
                <span className="mono text-[15px] text-ink-soft">
                  7 checks passed · 0 neutral · 0 failed
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- THE 13 FIELDS */}
      <section className="border-y border-ink/15 bg-paper-2 px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="2.2"
            title="The thirteen fields, in full"
            lead="Each field is mandatory. A bundle missing any one of them is not published — the run escalates instead, and the missing field is named in the escalation."
          />

          <div className="mt-16 space-y-px bg-ink/15">
            {PROOF_FIELDS.map((f, i) => (
              <Reveal key={f.key} delay={Math.min(i * 0.02, 0.2)}>
                <article
                  id={f.key}
                  className="scroll-mt-28 bg-paper-2 px-5 py-11 lg:px-10 lg:py-12"
                >
                  <div className="grid gap-9 lg:grid-cols-[120px_1fr] lg:gap-14">
                    <div>
                      <div className="num text-[clamp(30px,3.6vw,42px)] leading-[1] text-oxide">
                        {f.clause}
                      </div>
                      <div className="mono mt-4 break-all text-[15px] text-stone">{f.key}</div>
                    </div>

                    <div>
                      <h3 className="text-[clamp(26px,3.2vw,38px)] leading-[1.14]">{f.label}</h3>
                      <p className="mt-6 max-w-[68ch] text-[21px] leading-[1.62] text-ink-soft">
                        {f.body}
                      </p>

                      <div className="mt-8">
                        <div className="clause text-stone">Specimen from run AF-04-1187</div>
                        <pre className="paper-slab mt-4 whitespace-pre-wrap break-words">
                          {f.specimen}
                        </pre>
                      </div>
                    </div>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- AUDIT */}
      <section id="regression" className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="2.3"
            title="Auditing a bundle in ten minutes"
            lead="The bundle is designed to be falsifiable quickly. You do not need to trust the system to review its output — you need about ten minutes and a checkout of the parent commit."
          />

          <div className="mt-16 border-t-[3px] border-ink">
            {AUDIT_STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.05}>
                <div className="ledger-row grid gap-8 px-2 py-10 lg:grid-cols-[120px_1fr_1fr] lg:gap-14">
                  <div className="num text-[clamp(34px,4vw,50px)] leading-[1] text-navy">
                    {s.n}
                  </div>
                  <h3 className="text-[clamp(24px,2.8vw,33px)] leading-[1.18]">{s.h}</h3>
                  <p className="text-[20px] leading-[1.62] text-ink-soft">{s.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------- WHAT IT DOESN'T CLAIM */}
      <section id="attestation" className="border-y border-ink/15 bg-navy px-6 py-24 text-paper lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1080px]">
          <SectionHead
            clause="2.4"
            dark
            title="What the certificate deliberately does not claim"
            lead="An evidence set that claims too much is worse than one that claims nothing, because it spends trust it has not earned. These four limitations are printed in every bundle."
          />

          <div className="mt-14 grid gap-px border border-paper/25 bg-paper/25 sm:grid-cols-2">
            {[
              [
                "It does not claim the fix is the best fix",
                "It claims the patch turns the regression test green, leaves the impacted surface clean, and is inside the risk policy. A better patch may exist; three to six independent candidates reduce the chance of missing it, they do not eliminate it.",
              ],
              [
                "It does not claim the tests are sufficient",
                "It claims the impacted set was computed from the changed symbols by a recorded derivation. Untested behaviour that was already untested remains untested, and the bundle says so rather than implying coverage it does not have.",
              ],
              [
                "It does not claim the failure will never recur",
                "The regression test guards the mechanism that was observed. A different mechanism producing a similar symptom produces a different fingerprint and a different repair — this is a feature of the fingerprint, not a defect.",
              ],
              [
                "It does not claim autonomy is appropriate here",
                "Some changes are refused on policy grounds and routed to a human regardless of how good the patch is. Authentication boundaries, key handling and migration scripts are always escalated, every time.",
              ],
            ].map(([h, b]) => (
              <div key={h} className="bg-navy px-8 py-10">
                <h3 className="text-[clamp(22px,2.5vw,28px)] leading-[1.22] text-paper">{h}</h3>
                <p className="mt-5 text-[19px] leading-[1.62] text-paper/80">{b}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 flex flex-col items-center gap-6 text-center">
            <Link href="/runs/AF-04-1187" className="btn btn-on-dark">
              Open a real evidence set
            </Link>
            <Link href="/architecture" className="btn border-paper/50 text-paper hover:bg-paper hover:text-navy">
              How the signing path works
            </Link>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- TRACE */}
      <section id="execution-trace" className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="2.5"
            title="The model and tool trace is part of the evidence"
            lead="Every model call and every tool call, in order, with token counts and latency. This is not observability for its own sake — it is the record of what the agent was allowed to do, and what it attempted."
          />

          <div className="mt-14 grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div>
              <div className="clause text-stone">Trace extract · run AF-04-1187</div>
              <pre className="code-slab mt-5">
{`00:00:00  event   workflow_run.completed        ci · gateway services
00:00:01  verify  hmac-sha256                   PASS (3ms)
00:00:02  store   logs + artifacts              14 objects, 41.2 MiB
00:00:21  model   failure.normalise             12.4k tok   3.1s
00:00:25  tool    tree-sitter.parse              args:{lang:"typescript"}
00:00:28  model   localize.symbols               9.8k tok    2.7s
00:00:33  tool    ast-grep.find                  args:{pattern:"serialize"}
00:00:37  sandbox boot sbx_7f3a91c4              image sha256:4b19…e0a7
00:04:52  sandbox reproduce ×3                  3/3 identical
00:05:01  model   test.write_regression          18.1k tok   6.4s
00:05:09  tool    dagger.run_test                args:{suite:"gateway"}
00:06:41  gate    red-check                      TypeError matches fp  PASS
00:06:44  model   patch.candidate ×4             41.7k tok  12.8s
00:09:49  sandbox verify ×4 (isolated)          4 microVMs
00:16:02  tool    opa.eval                       args:{policy:"release/v4"}
00:16:09  tool    semgrep.scan                   args:{ruleset:"pinned"}
00:22:55  github  pulls.create (draft)          #4431
00:23:11  sign    in-toto Statement v1           transparency log 18422019971`}
              </pre>
            </div>

            <div>
              <div className="clause text-stone">Tool boundaries</div>
              <p className="mt-6 text-[20px] leading-[1.62] text-ink-soft">
                Every tool call crosses an MCP server with a published schema. Arguments are typed
                and validated before execution; the binary set is allow-listed; the process runs
                under a seccomp profile with egress denied. There is no tool in the trace named
                <span className="mono text-[16px] text-oxide"> shell</span>, because there is no
                such tool in the system.
              </p>
              <p className="mt-6 text-[20px] leading-[1.62] text-ink-soft">
                Attempted boundary violations are recorded rather than dropped. In the production
                corpus they are rare and almost always benign — a candidate reaching for a
                formatting binary that is not installed — but the ones that are not benign are the
                reason the record exists.
              </p>

              <div className="mt-8 grid grid-cols-2 gap-px border border-ink/20 bg-ink/20">
                {[
                  ["MCP servers", "11"],
                  ["Allow-listed binaries", "24"],
                  ["Denied calls, corpus", "1,284"],
                  ["Trace retention", "90 days"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-paper px-5 py-5">
                    <div className="clause text-stone">{k}</div>
                    <div className="num mt-2 text-[19px]">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
