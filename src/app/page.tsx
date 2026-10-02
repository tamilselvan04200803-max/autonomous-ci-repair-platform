import Link from "next/link";
import type { Metadata } from "next";
import { AegisMark } from "@/components/AegisMark";
import { SectionHead } from "@/components/Chrome";
import { Counter, Reveal } from "@/components/Motion";
import { EvidenceSeal } from "@/components/EvidenceSeal";
import { DEPLOYMENTS, FAILURE_CLASSES, FAQS, PROOF_FIELDS, STAGES } from "@/lib/data";

export const metadata: Metadata = {
  title: "Aegis Forge — A patch is not a fix until the evidence gate certifies it",
};

const HERO_META = [
  { label: "Document", value: "AF-TR-04" },
  { label: "Revision", value: "2.7 / 2026" },
  { label: "Stages", value: "16 gates" },
  { label: "Languages", value: "TS · Py · Go · Rs" },
];



export default function HomePage() {
  return (
    <>
      {/* ---------------------------------------------------------- COVER */}
      <section className="relative overflow-hidden px-6 pt-16 pb-10 lg:pt-24">
        <div className="mx-auto max-w-[1120px] text-center">
          <div className="clause flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-stone">
            <span>Aegis Forge</span>
            <span className="h-[2px] w-8 bg-stone/60" />
            <span>Autonomous CI Repair</span>
            <span className="h-[2px] w-8 bg-stone/60" />
            <span className="text-oxide">Evidence-Gated Publication</span>
          </div>

          <h1 className="mx-auto mt-10 max-w-[15ch] text-[clamp(46px,8.6vw,104px)] leading-[0.98] tracking-[-0.028em]">
            A patch is not a fix until the{" "}
            <em className="font-[400] italic text-navy">evidence gate</em> certifies it.
          </h1>

          <div className="measure mt-10 text-[clamp(20px,2.2vw,25px)] leading-[1.58] text-ink-soft">
            Aegis Forge watches your continuous integration, reproduces every failure in a clean
            sandbox, writes the regression test before it writes the fix, and publishes nothing at
            all until an independent gate has tested the patch, scored its risk and signed the
            record. What reaches your pull requests is not a suggestion. It is a certificate.
          </div>

          <div className="mt-11 flex flex-wrap items-center justify-center gap-4">
            <Link href="/analyze" className="btn btn-primary">
              Analyse a failing log
            </Link>
            <Link href="/setup" className="btn btn-ghost">
              Connect a repository
            </Link>
            <Link href="/verify" className="btn btn-ghost">
              Verify a proof bundle
            </Link>
          </div>

          <div className="mx-auto mt-14 grid max-w-[880px] grid-cols-2 gap-px border border-ink/20 bg-ink/20 md:grid-cols-4">
            {HERO_META.map((m) => (
              <div key={m.label} className="bg-paper px-5 py-6">
                <div className="clause text-stone">{m.label}</div>
                <div className="num mt-3 text-[19px]">{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- PLATE / PHOTO */}
      <section className="relative">
        <div className="relative h-[58vh] min-h-[420px] w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/recorder.jpg"
            alt="A sealed aluminium evidence locker on a drafting table beside a bound engineering dossier"
            className="h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-console/85 via-console/25 to-console/45" />
          <div className="absolute inset-x-0 bottom-0 px-6 pb-10 lg:px-12 lg:pb-14">
            <div className="mx-auto max-w-[1360px]">
              <div className="max-w-[52ch]">
                <div className="clause text-amber">Plate I · The evidence store</div>
                <p className="mt-4 text-[clamp(21px,2.6vw,30px)] leading-[1.35] text-paper">
                  Every log, artifact, sandbox transcript and dependency digest is content-addressed
                  and kept for seven years. A repair you cannot replay is a repair you cannot trust.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------- 1.0 WHAT ACTUALLY BREAKS */}
      <section id="failures" className="px-6 pt-24 pb-20 lg:px-12 lg:pt-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="1.0"
            title={
              <>
                Eight things that break a build, and what the gate does about each
              </>
            }
            lead={
              <>
                Most red builds are not exotic. They are the same handful of failures arriving in a
                different order, and each class leaves a recognisable signature in the logs. Aegis
                Forge classifies before it repairs, because the class decides what would count as
                proof.
              </>
            }
          />

          <div className="mt-16">
            {FAILURE_CLASSES.map((fc, i) => (
              <Reveal key={fc.n} delay={i * 0.04}>
                <article className="ledger-row grid gap-8 px-2 py-10 lg:grid-cols-[110px_1.05fr_1fr] lg:gap-12 lg:px-6">
                  <div>
                    <div className="num text-[26px] text-navy">{fc.n}</div>
                    <div className="clause mt-3 text-stone">{fc.share} of runs</div>
                  </div>

                  <div>
                    <h3 className="text-[clamp(25px,2.6vw,33px)] leading-[1.16]">{fc.title}</h3>
                    <p className="mt-5 text-[20px] leading-[1.62] text-ink-soft">{fc.body}</p>
                  </div>

                  <div className="border-l-2 border-oxide/40 pl-6">
                    <div className="clause text-oxide">What it looks like in the log</div>
                    <ul className="mt-5 space-y-4">
                      {fc.tells.map((t) => (
                        <li key={t} className="mono text-[15px] leading-[1.55] text-ink-soft">
                          <span className="mr-2 text-oxide">›</span>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- 2.0 DOCTRINE */}
      <section className="border-y border-ink/15 bg-paper-2 px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="2.0"
            title="Three rules the control plane is not allowed to break"
            lead="Everything else in the system is an implementation detail. These three are contractual — if the system cannot honour one of them, it stops and files an escalation instead."
          />

          <div className="mt-16 space-y-14">
            {[
              {
                n: "2.1",
                head: "Reproduce before you reason",
                body: "No model is allowed to describe a failure it has not personally caused to happen. Stage 06 requires three consecutive reproductions in three clean sandboxes from a pinned toolchain image, and the failing command is recorded verbatim. When reproduction fails, the run escalates with the divergence between attempts in hand. Around one run in nine stops here, and those reports are the most valuable output the system produces.",
                aside: "Escalation rate on non-reproducible failures: 100%",
              },
              {
                n: "2.2",
                head: "The test comes before the fix",
                body: "A repair without a regression test is a temporary improvement. Aegis Forge writes the test first, proves it red against the unmodified commit for the right reason, and only then allows candidate patches to be generated. The test is authored in the repository's own harness and naming conventions, so it survives as ordinary code rather than as scaffolding left behind by a machine.",
                aside: "Regression tests retained in the repository: 96.4%",
              },
              {
                n: "2.3",
                head: "Nothing is published uncertified",
                body: "Publication means a draft pull request and a check run — never a push to a protected branch, never a merge. The check run states precisely what was proven and what was not. If the upstream CI on the patch's own branch does not go green, the run is escalated rather than verified, no matter how convincing the diff looked.",
                aside: "Patches merged automatically by the system: zero",
              },
            ].map((p, i) => (
              <Reveal key={p.n} delay={i * 0.05}>
                <div className="grid gap-8 lg:grid-cols-[130px_1.35fr_0.65fr] lg:gap-14">
                  <div className="num text-[30px] text-oxide">{p.n}</div>
                  <div>
                    <h3 className="text-[clamp(27px,3.2vw,40px)] leading-[1.12]">{p.head}</h3>
                    <p className="mt-6 text-[21px] leading-[1.62] text-ink-soft">{p.body}</p>
                  </div>
                  <div className="self-start border-t-[3px] border-navy pt-5">
                    <div className="clause text-stone">Measured</div>
                    <div className="mt-3 text-[19px] leading-[1.5] text-navy">{p.aside}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ 3.0 PIPELINE */}
      <section id="pipeline" className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="3.0"
            title="Sixteen stages, and every one of them can stop the run"
            lead="The pipeline is a sequence of gates, not a chain of suggestions. Each stage records what it saw, what it produced and how long it took — and each has a defined refusal: the condition under which it will not pass the work on."
          />

          <div className="mt-16 border-t-[3px] border-ink">
            <div className="hidden grid-cols-[70px_1.6fr_1fr_120px] gap-8 px-2 py-4 lg:grid">
              <div className="clause text-stone">No.</div>
              <div className="clause text-stone">Stage</div>
              <div className="clause text-stone">Tooling boundary</div>
              <div className="clause text-right text-stone">Median</div>
            </div>

            {STAGES.map((s, i) => (
              <Reveal key={s.key} delay={Math.min(i * 0.025, 0.3)}>
                <div className="ledger-row grid gap-x-8 gap-y-3 px-2 py-7 lg:grid-cols-[70px_1.6fr_1fr_120px]">
                  <div className="num text-[22px] text-navy">{s.n}</div>
                  <div>
                    <h3 className="text-[clamp(21px,2.2vw,26px)] leading-[1.22]">{s.title}</h3>
                    <p className="mt-3 max-w-[62ch] text-[18px] leading-[1.6] text-ink-soft">
                      {s.summary}
                    </p>
                  </div>
                  <div className="mono text-[15px] leading-[1.6] text-stone">{s.tooling}</div>
                  <div className="num text-[18px] lg:text-right">{s.median}</div>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link href="/pipeline" className="btn btn-ghost">
              Read every stage in full
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------ 4.0 EVIDENCE GATE (DARK) */}
      <section id="evidence-gate" className="relative overflow-hidden bg-console px-6 py-24 text-paper lg:px-12 lg:py-36">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage: "url(/images/console.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center left",
          }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-console via-console/85 to-console/60" aria-hidden="true" />

        <div className="relative mx-auto max-w-[1180px]">
          <SectionHead
            clause="4.0"
            dark
            title="The moment a patch becomes evidence"
            lead={
              <>
                Six checks must all hold before anything is signed: the failure reproduces, the
                regression test is red for the right reason, the patch turns it green, the impacted
                surface is clean, the risk score is inside policy, and the upstream build agrees.
                Miss one and there is no certificate — there is an escalation.
              </>
            }
          />

          <div className="mt-20 grid items-center gap-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="flex flex-col items-center">
              <EvidenceSeal className="h-[320px] w-[320px] text-amber lg:h-[400px] lg:w-[400px]" runId="AF-04-1187" />
              <div className="mt-10 max-w-[36ch] text-center">
                <div className="clause text-amber">Impression</div>
                <p className="mt-4 text-[19px] leading-[1.6] text-paper/80">
                  The seal is drawn from the run&apos;s own evidence set. Change any byte of the bundle
                  and the signature over the seal stops verifying.
                </p>
              </div>
            </div>

            <div>
              <div className="clause text-amber">Verification transcript · run AF-04-1187</div>
              <pre className="code-slab mt-6 border-l-4 border-amber">
{`[11:41:02] gate.reproduce      3/3 identical failures          PASS
[11:42:19] gate.regression      red on 7c1d9a02 · TypeError      PASS
[11:44:57] gate.patch_green     red → green in 1 sandbox         PASS
[11:47:31] gate.impact          814/814 · pyright 0 · eslint 0   PASS
[11:48:04] gate.policy          aegis.patch.release/v4 → allow   PASS
[11:49:22] gate.risk            0.12 < 0.35 ceiling              PASS
[11:51:47] gate.upstream        ci · gateway services → success  PASS
[11:51:49] gate.sign            in-toto Statement v1 · Sigstore  PASS

verificationResult: PASSED
verifiedLevels:     [SLSA_BUILD_LEVEL_3]
bundle:             sha256:7c1d9a02e4b6f38c…c2d4e6f81`}
              </pre>

              <div className="mt-8 grid grid-cols-2 gap-px border border-paper/20 bg-paper/20 sm:grid-cols-4">
                {[
                  ["Gates passed", "7 / 7"],
                  ["Risk score", "0.12"],
                  ["Wall clock", "23m 14s"],
                  ["Cost", "$3.33"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-console-2 px-5 py-5">
                    <div className="clause text-paper/75">{k}</div>
                    <div className="num mt-2 text-[21px] text-paper">{v}</div>
                  </div>
                ))}
              </div>

              <Link href="/runs/AF-04-1187" className="btn btn-on-dark mt-9">
                Open the full evidence set
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- 5.0 PROOF BUNDLE */}
      <section id="proof-bundle" className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="5.0"
            title="Thirteen fields travel with every patch"
            lead="This is the pull request description Aegis Forge writes. Not a summary of the work — the work, its evidence, and the limits of what it proves. A reviewer should be able to audit the repair without running anything."
          />

          <div className="mt-16 border-t-[3px] border-ink">
            {PROOF_FIELDS.map((f, i) => (
              <Reveal key={f.key} delay={Math.min(i * 0.02, 0.25)}>
                <div className="ledger-row grid gap-6 px-2 py-8 lg:grid-cols-[92px_300px_1fr] lg:gap-10">
                  <div className="num text-[19px] text-oxide">{f.clause}</div>
                  <div>
                    <h3 className="text-[22px] leading-[1.25]">{f.label}</h3>
                    <div className="mono mt-2 text-[15px] text-stone">{f.key}</div>
                  </div>
                  <div className="grid gap-7 xl:grid-cols-[1fr_1.15fr]">
                    <p className="text-[19px] leading-[1.62] text-ink-soft">{f.body}</p>
                    <pre className="paper-slab whitespace-pre-wrap break-words text-[15px] leading-[1.68]">
                      {f.specimen}
                    </pre>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link href="/proof-bundle" className="btn btn-primary">
              See the anatomy of the proof bundle
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- 6.0 FINGERPRINT */}
      <section id="fingerprint" className="border-y border-ink/15 bg-paper-2 px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="6.0"
            title="Two identical failures are one failure"
            lead="The fingerprint is what makes repair idempotent. Without it, a flapping build produces a queue of duplicate patches and a reviewer learns to ignore the bot. With it, the second delivery of the same defect is a no-op that points at the existing record."
          />

          <div className="mt-16 grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <div className="clause text-oxide">Anatomy</div>
              <p className="mt-6 text-[21px] leading-[1.62] text-ink-soft">
                The fingerprint is a hash over a normalised failure shape: the exception class, the
                top three application frames with their line content, and the assertion template.
                Every volatile literal is stripped before hashing — file paths, ports, timestamps,
                generated identifiers, memory addresses and user data all disappear.
              </p>
              <p className="mt-6 text-[21px] leading-[1.62] text-ink-soft">
                What remains is the identity of the defect rather than the identity of the run. A
                rebuild eight hours later on a different runner, with a different PID and a
                different temp directory, produces the same fingerprint — which is exactly what
                allows the control plane to refuse the second repair.
              </p>

              <div className="mt-9 grid grid-cols-2 gap-px border border-ink/20 bg-ink/20">
                {[
                  ["Redaction rules", "14 patterns"],
                  ["Frame depth", "3 application"],
                  ["Collision policy", "cluster, never merge"],
                  ["Retention", "7 years"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-paper-2 px-5 py-5">
                    <div className="clause text-stone">{k}</div>
                    <div className="num mt-2 text-[19px]">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-8">
              <div>
                <div className="clause text-stone">Raw failure · before normalisation</div>
                <pre className="paper-slab mt-4 whitespace-pre-wrap break-words text-oxide/90">
{`TypeError: Cannot read properties of undefined (reading 'state')
    at serialize (/workspace/services/gateway/src/serialize.ts:21:31)
    at handle (/workspace/services/gateway/src/http.ts:88:14)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async /workspace/node_modules/.pnpm/undici@6.21.0/lib/…`}
                </pre>
              </div>

              <div>
                <div className="clause text-stone">Normalised · what actually gets hashed</div>
                <pre className="paper-slab mt-4 whitespace-pre-wrap break-words">
{`exception:  TypeError
frames:
  0  serialize            src/serialize.ts   [reading 'state']
  1  handle               src/http.ts
  2  processTicksAndRejections  <runtime>    ← dropped
assertion-template:  Cannot read properties of undefined (reading X)`}
                </pre>
              </div>

              <div>
                <div className="clause text-certified">Fingerprint</div>
                <div className="mt-4 border-l-4 border-certified bg-paper px-6 py-6">
                  <div className="mono break-all text-[17px] text-certified">
                    fp:sha256:7c1d9a02e4b6f38c1d5a77b90cc2e4a1
                    <br />
                    e6d3f0b8a95c1e2d4f6a8b0c2d4e6f81
                  </div>
                  <div className="mt-4 text-[18px] leading-[1.55] text-ink-soft">
                    Clustered under{" "}
                    <span className="mono text-[15px] text-navy">gateway/serialize/undefined-read</span>{" "}
                    with 4 prior occurrences, first seen 2026-02-19.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- 7.0 SANDBOX */}
      <section id="sandbox" className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <div className="grid items-start gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
            <div>
              <SectionHead
                clause="7.0"
                align="left"
                title="Isolation is the reason the certificate means anything"
                lead="A verification that ran in a shared, warm, contaminated workspace is an opinion. Today, Aegis Forge executes candidates in isolated, ephemeral CI runners with strict workspace resets. In enterprise deployments, dedicated hardware microVMs provide complete virtualization boundaries."
              />

              <div className="mt-12 space-y-8">
                {[
                  {
                    h: "Ephemeral Runner Isolation (Current)",
                    b: "Candidates run via runner/aegis.mjs inside clean GitHub Actions CI runners. Every attempt resets the git tree to the base commit and sanitizes test commands to prevent dirty workspaces or state leaks.",
                  },
                  {
                    h: "Dedicated Hardware microVMs (Planned)",
                    b: "For enterprise multi-tenant scale, candidates fan out to dedicated ephemeral microVMs (E2B / Daytona) with hardware-enforced hypervisor isolation and strict network egress denial.",
                  },
                  {
                    h: "Pinned Toolchains & Content Addressing",
                    b: "Toolchains and lockfiles are recorded by digest. The environment fingerprint travels inside the proof bundle, ensuring deterministic reproduction months later.",
                  },
                  {
                    h: "Template-Gated Test Execution",
                    b: "The model cannot execute arbitrary shell commands. Candidate test commands and file paths are sanitized against strict path-containment and shell metacharacter allow-lists.",
                  },
                ].map((item) => (
                  <div key={item.h} className="border-t border-ink/20 pt-6">
                    <h3 className="text-[23px] leading-[1.25]">{item.h}</h3>
                    <p className="mt-3 max-w-[58ch] text-[19px] leading-[1.62] text-ink-soft">
                      {item.b}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:sticky lg:top-28">
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/sandbox.jpg"
                  alt="Blueprint plate showing four sealed test enclosures in exploded isometric view"
                  className="w-full border border-ink/20 object-cover"
                />
                <figcaption className="mt-5 text-[18px] leading-[1.55] text-ink-soft">
                  <span className="clause text-oxide">Plate II ·</span> Four isolated verification
                  enclosures on a shared image digest. Nothing crosses the walls except the patch
                  going in and the transcript coming out.
                </figcaption>
              </figure>

              <div className="mt-8 border-t-[3px] border-ink pt-6">
                <div className="clause text-stone">Sandbox identity recorded per run</div>
                <pre className="paper-slab mt-4 whitespace-pre-wrap break-words">
{`image    ghcr.io/aegis/verify-node22@sha256:4b19…e0a7
seccomp  aegis-strict-v3
egress   deny-all + 2 allow-listed hosts
memory   8 GiB / 4 vCPU / 20 GiB ephemeral
clock    frozen 2026-03-04T11:22:33Z`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- 8.0 POLICY */}
      <section id="policy" className="border-y border-ink/15 bg-paper-2 px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="8.0"
            title="Policy decides, signatures prove, and neither trusts the other"
            lead="The policy engine and the signing path are deliberately separate systems. OPA decides whether a patch may be published at all; the attestation records what was decided, by which policy version, over which inputs. A compromised policy cannot forge history, and a forged bundle cannot pass policy."
          />

          <div className="mt-16 grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <div className="clause text-oxide">Policy · aegis.patch.release / v4</div>
              <pre className="paper-slab mt-5 whitespace-pre-wrap break-words">
{`package aegis.patch.release

default allow = false

allow {
  input.risk_score < 0.35
  input.diff.files_outside_localised_set == 0
  not input.diff.introduces_network_egress
  not input.diff.moves_dependency_major
  not input.diff.touches_auth_boundary
  input.regression_test.proven_red
  input.regression_test.proven_green
}

deny[msg] {
  input.diff.touches_auth_boundary
  msg := "auth boundary changes require human review"
}

deny[msg] {
  input.sandbox.egress != "deny-all"
  msg := "verification sandbox must run with egress denied"
}`}
              </pre>
            </div>

            <div>
              <div className="clause text-oxide">Attestation · in-toto Statement v1</div>
              <pre className="paper-slab mt-5 whitespace-pre-wrap break-words">
{`{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "bundle.intoto.jsonl",
                "digest": { "sha256": "7c1d9a02…" } }],
  "predicateType": "https://aegisforge.dev/verification_summary/v1",
  "predicate": {
    "verifier": { "id": "https://gate.aegisforge.dev",
                  "version": { "gate": "2.7.1", "opa": "1.9.4" } },
    "timeVerified": "2026-03-04T11:51:49Z",
    "policy": { "uri": "policy://aegis.patch.release/v4",
                "digest": { "sha256": "aa319d20…" } },
    "verificationResult": "PASSED",
    "verifiedLevels": ["SLSA_BUILD_LEVEL_3"]
  }
}`}
              </pre>
            </div>
          </div>

          <div className="mt-16 grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/seal-press.jpg"
                alt="A mechanical seal press raised over stacked document pages beside a stick of red sealing wax"
                className="w-full border border-ink/20 object-cover"
              />
              <figcaption className="mt-5 text-[18px] leading-[1.55] text-ink-soft">
                <span className="clause text-oxide">Plate III ·</span> Signing is a physical act
                with a record: short-lived certificate, transparency log entry, one command to
                verify.
              </figcaption>
            </figure>

            <div>
              <h3 className="text-[clamp(26px,3vw,36px)] leading-[1.14]">
                Verification is one command, and it works offline
              </h3>
              <p className="mt-6 text-[21px] leading-[1.62] text-ink-soft">
                The signed artifact is a DSSE envelope over an in-toto statement, issued with a
                Sigstore certificate whose private key is discarded immediately after signing. The
                certificate is short-lived; the transparency log entry is not. Anybody holding the
                bundle can check it against the published roots of trust without calling us.
              </p>
              <pre className="code-slab mt-8">
{`$ gh attestation verify ./bundle.intoto.jsonl -R aegis/commerce-platform

✓ Verified subject sha256:7c1d9a02…  against predicate
  https://aegisforge.dev/verification_summary/v1
✓ Sigstore transparency log entry 18422019971
✓ verificationResult: PASSED · SLSA_BUILD_LEVEL_3`}
              </pre>
              <p className="mt-6 text-[19px] leading-[1.6] text-ink-soft">
                If this command does not succeed, the bundle is not evidence — it is a file. The
                check run on the pull request says exactly that, in those words.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- 9.0 NUMBERS */}
      <section className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="9.0"
            title="What the gate actually costs, and what it returns"
            lead="Measured across 41,206 repair runs on twelve production estates between September 2025 and February 2026. Escalations are counted at full cost — a rejected patch is not a free patch."
          />

          <div className="mt-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                v: 94.2,
                suffix: "%",
                decimals: 1,
                label: "Reproduced on demand",
                note: "Failures that produced three identical reproductions in clean sandboxes and were therefore eligible for repair at all.",
              },
              {
                v: 71.8,
                suffix: "%",
                decimals: 1,
                label: "Certified end to end",
                note: "Runs that reached an upstream green build and were signed. The rest escalated, with the full trace attached.",
              },
              {
                v: 23.4,
                suffix: " min",
                decimals: 1,
                label: "Median time to certificate",
                note: "From failed workflow_run to a signed bundle on a draft pull request, including the upstream CI watch.",
              },
              {
                v: 3.31,
                suffix: "",
                decimals: 2,
                prefix: "$",
                label: "Median cost per repair",
                note: "Sandbox compute and model spend combined. Median human minutes saved per certified repair: 47.",
              },
            ].map((s, i) => (
              <Reveal key={s.label} delay={i * 0.06}>
                <div className="border-t-[3px] border-ink pt-6">
                  <div className="text-[clamp(44px,5.4vw,66px)] leading-[1] text-navy">
                    <Counter value={s.v} suffix={s.suffix} prefix={s.prefix ?? ""} decimals={s.decimals} />
                  </div>
                  <div className="label mt-5">{s.label}</div>
                  <p className="mt-4 text-[18px] leading-[1.6] text-ink-soft">{s.note}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-20 border-t-[3px] border-ink">
            <div className="grid gap-px bg-ink/15 md:grid-cols-3">
              {[
                {
                  k: "Patches merged without a proof bundle",
                  v: "0",
                  n: "There is no code path in the control plane that publishes without signing.",
                },
                {
                  k: "Candidates rejected at the tool boundary",
                  v: "1,284",
                  n: "Blocked calls recorded as evidence, most commonly attempted egress and workspace escapes.",
                },
                {
                  k: "Vacuous regression tests discarded",
                  v: "612",
                  n: "Tests proven independent of any production symbol at the red stage, then regenerated.",
                },
              ].map((r) => (
                <div key={r.k} className="bg-paper px-8 py-10">
                  <div className="num text-[clamp(36px,4vw,50px)] leading-[1] text-oxide">{r.v}</div>
                  <div className="label mt-5 leading-[1.4]">{r.k}</div>
                  <p className="mt-4 text-[18px] leading-[1.6] text-ink-soft">{r.n}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- 10.0 DEPLOYMENT */}
      <section id="deployment" className="border-y border-ink/15 bg-paper-2 px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="10.0"
            title="Three ways to run it, one standard of proof"
            lead="The evidence format does not change with the deployment model. A bundle produced on your own hardware in your own network verifies against exactly the same roots as one produced on ours."
          />

          <div className="mt-16 border-t-[3px] border-ink">
            {DEPLOYMENTS.map((d, i) => (
              <Reveal key={d.n} delay={i * 0.05}>
                <div className="ledger-row grid gap-8 px-2 py-10 lg:grid-cols-[110px_1fr_1.1fr] lg:gap-14">
                  <div className="num text-[26px] text-navy">{d.n}</div>
                  <div>
                    <h3 className="text-[clamp(25px,2.8vw,34px)] leading-[1.14]">{d.name}</h3>
                    <div className="mono mt-4 text-[17px] text-oxide">{d.price}</div>
                    <p className="mt-5 max-w-[52ch] text-[20px] leading-[1.6] text-ink-soft">
                      {d.body}
                    </p>
                  </div>
                  <ul className="space-y-4">
                    {d.points.map((p) => (
                      <li key={p} className="flex gap-4 text-[19px] leading-[1.55]">
                        <span className="mt-[10px] inline-block h-[10px] w-[10px] shrink-0 bg-certified" />
                        <span className="text-ink-soft">{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- 11.0 FAQ */}
      <section className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1080px]">
          <SectionHead
            clause="11.0"
            title="Questions we get from the first security review"
            lead="Answered plainly, including the parts that are limitations rather than features."
          />

          <div className="faq mt-14 space-y-4">
            {FAQS.map((f, i) => (
              <details key={f.q} className="group border border-ink/20 bg-paper-2/60 px-7 py-6 lg:px-10 lg:py-8" open={i === 0}>
                <summary className="flex items-start justify-between gap-8">
                  <h3 className="text-[clamp(21px,2.3vw,27px)] leading-[1.28]">{f.q}</h3>
                  <span className="faq-sign relative mt-2 inline-block h-5 w-5 shrink-0 transition-transform duration-300">
                    <span className="absolute block h-[2px] w-5 translate-y-[9px] bg-oxide" />
                    <span className="absolute block h-[2px] w-5 translate-y-[9px] rotate-90 bg-oxide" />
                  </span>
                </summary>
                <p className="mt-6 max-w-[68ch] text-[20px] leading-[1.62] text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- 12.0 CTA */}
      <section className="relative overflow-hidden bg-navy px-6 py-24 text-paper lg:px-12 lg:py-32">
        <div className="relative mx-auto max-w-[1080px] text-center">
          <AegisMark className="mx-auto h-16 w-auto text-paper" />
          <h2 className="mx-auto mt-10 max-w-[17ch] text-[clamp(38px,6vw,72px)] leading-[1.02]">
            Point it at your worst failing build.
          </h2>
          <p className="measure mt-8 text-[22px] leading-[1.6] text-paper/85">
            We start with the failure your team has been re-running for a week. If Aegis Forge
            cannot reproduce it three times in a clean sandbox, you get the transcript and we do not
            send a patch. That is the whole promise, and it is testable in an afternoon.
          </p>

          <div className="mt-11 flex flex-wrap items-center justify-center gap-4">
            <Link href="/runs" className="btn btn-on-dark">
              Browse the repair ledger
            </Link>
            <Link
              href="/architecture"
              className="btn border-paper/60 text-paper hover:bg-paper hover:text-navy"
            >
              Read the architecture
            </Link>
          </div>

          <div className="mx-auto mt-16 grid max-w-[820px] grid-cols-2 gap-px border border-paper/25 bg-paper/25 sm:grid-cols-4">
            {[
              ["Trial length", "14 days"],
              ["Setup", "One GitHub App"],
              ["First certificate", "Under an hour"],
              ["Exit", "Bundle is yours"],
            ].map(([k, v]) => (
              <div key={k} className="bg-navy px-5 py-6">
                <div className="clause text-paper/80">{k}</div>
                <div className="num mt-3 text-[18px]">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
