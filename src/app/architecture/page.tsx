import Link from "next/link";
import type { Metadata } from "next";
import { PageCover, SectionHead } from "@/components/Chrome";
import { Reveal } from "@/components/Motion";

export const metadata: Metadata = {
  title: "Architecture & Trust Model — Aegis Forge",
  description:
    "The architecture behind the evidence gate: current active implementation (Next.js, PostgreSQL, GitHub Actions, in-toto DSSE Ed25519) and planned enterprise architecture (Temporal, PydanticAI, MCP, microVMs).",
};

const ACTIVE_STACK = [
  ["GitHub App + Checks API", "Current Ingress & Publication", "Receives workflow_run events via HMAC-verified webhooks, posts real-time checks, and opens verifiable draft pull requests."],
  ["Next.js 16 + Node.js 22", "Current Control Plane", "High-throughput control plane hosting the deterministic log analyzer, candidate screening pipeline, attestation verifier, and status dashboard."],
  ["PostgreSQL + Drizzle ORM", "Current Ledger & Evidence DB", "Idempotent state machine with repair runs, 16 execution stages, patch candidate evaluations, and content-addressed proof bundles."],
  ["in-toto v1 + DSSE + Ed25519", "Current Cryptographic Attestation", "Dead Simple Signing Envelope (DSSE v1) with Pre-Authentication Encoding (PAE) and Ed25519 signatures, verifiable offline with runner CLI."],
  ["Deterministic Diagnostic Engine", "Current Log Intelligence", "Regex-driven AST and compiler log parser localizing errors in TypeScript, Python, Go, Rust, and JavaScript without requiring an LLM."],
  ["Ephemeral CI Runner (aegis.mjs)", "Current Sandbox Execution", "Zero-dependency Node.js CLI executing inside repository GitHub Actions runners to reproduce failures (3x) and verify red-to-green transitions."],
  ["OPA Rego v1", "Current Release Policy", "Declarative release gates enforcing risk ceilings (< 0.35), sensitive path barriers, test deletion bans, and regression test requirements."],
  ["Multi-Model LLM Adapter", "Current Patch Generation", "OpenAI-compatible / Gemini / local LLM integration generating unified diffs and matching regression tests across temperature tiers."],
];

const PLANNED_STACK = [
  ["Temporal", "Planned Durable Orchestration", "Sixteen stages as replay-safe activities with per-stage timeouts and thirty-second checkpoints so interrupted runs resume seamlessly."],
  ["PydanticAI + LangGraph", "Planned Agent Runtime", "Multi-agent graph evaluation where candidate generation fans out across independent contexts with rigid Pydantic schema validation."],
  ["Model Context Protocol (MCP)", "Planned Tool Boundaries", "Standardized MCP client-server architecture ensuring typed, audited tool execution without shell primitives."],
  ["ast-grep + tree-sitter", "Planned Structural Analysis", "Syntax-aware AST queries that continue functioning even when code fails compilation."],
  ["E2B / Daytona microVMs", "Planned MicroVM Isolation", "Dedicated ephemeral microVM per candidate with hardware virtualization, denied network egress, and seccomp profiles."],
  ["Sigstore Fulcio + Rekor", "Planned Keyless Attestation", "OIDC identity binding with public transparency log verification and short-lived certificates."],
  ["Dagger", "Planned Containerized Pipelines", "Programmatic container engine executing uniform test environments across local dev, CI, and cloud sandbox."],
];

const THREATS = [
  {
    n: "T1",
    threat: "Prompt injection in a failing log",
    body: "A hostile repository, a poisoned dependency's output, or an issue comment crafted to steer the agent.",
    mitigation:
      "Logs are treated as untrusted data: quoted, never interpolated into instructions, and the tool boundary cannot be widened by content. An injected instruction can at worst produce a bad candidate, which the gate rejects.",
    residual: "A semantically wrong patch that nonetheless passes every gate. Bounded by the upstream CI and the draft-PR review requirement.",
  },
  {
    n: "T2",
    threat: "Arbitrary command execution",
    body: "The classic failure mode of an agent with a shell: exfiltration, persistence, or a supply-chain pivot from inside the sandbox.",
    mitigation:
      "No shell tool exists. Commands are built from validated templates and executed by the runner, under a seccomp profile, with egress denied and the workspace mounted read-only outside the designated output directory.",
    residual: "A vulnerability in the sandbox runtime itself, which is why the pool is single-tenant per run and the image is pinned by digest.",
  },
  {
    n: "T3",
    threat: "Cross-candidate contamination",
    body: "A patch that only works because of debris left behind by an earlier verification attempt.",
    mitigation:
      "Each candidate gets a freshly booted microVM. There is no shared writable layer, no warm cache and no shared process table between candidates.",
    residual: "Non-deterministic hardware behaviour inside the host, mitigated by the three-reproduction rule.",
  },
  {
    n: "T4",
    threat: "Forged or replayed webhook",
    body: "An attacker replaying a captured delivery to trigger work against a repository, or spoofing a failure to induce a patch.",
    mitigation:
      "HMAC-SHA256 over the raw body with a constant-time compare, a 24-hour replay window keyed on the delivery id, and repository allow-lists enforced at ingress before anything is queued.",
    residual: "Compromise of the webhook secret, mitigated by rotation and by the fact that publication is always a draft PR under review.",
  },
  {
    n: "T5",
    threat: "A vacuous regression test",
    body: "A test that passes on broken code, producing a false certificate that is worse than no certificate at all.",
    mitigation:
      "The red stage proves the test's truth value moves with the production code path. Vacuous assertions are discarded and regenerated, and the vacuity analysis is attached to the bundle when a run escalates for this reason.",
    residual: "A test that touches the right symbol but asserts too weakly. Visible to any reviewer who reads the test first — which is step three of the audit.",
  },
  {
    n: "T6",
    threat: "Policy capture",
    body: "A relaxed or malformed policy allowing risky patches through on paper.",
    mitigation:
      "The policy bundle is versioned and its digest is recorded in the attestation, so a decision can always be attributed to the policy that made it. Denies are recorded as evidence with the rule name.",
    residual: "An organisation that chooses a weak policy. The defaults are strict and the ceiling is configurable in one direction only at install time.",
  },
];

export default function ArchitecturePage() {
  return (
    <>
      <PageCover
        clause="Section 04"
        eyebrow="Architecture & Trust Model"
        title={
          <>
            Built like an avionics system, not like a{" "}
            <em className="italic text-navy">chatbot</em>
          </>
        }
        standfirst="Every component here exists because of a specific way an autonomous repair system can be wrong. The stack is deliberately unglamorous: durable orchestration, structural analysis, isolated verification, policy evaluation, and signatures that anyone can check without asking us."
        meta={[
          { label: "Components", value: "12" },
          { label: "Trust zones", value: "4" },
          { label: "Threats modelled", value: "6" },
          { label: "Shell tools", value: "0" },
        ]}
      />

      {/* -------------------------------------------------------- 4.1 STACK */}
      <section className="px-6 py-24 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="4.1a"
            title="Active Core Implementation (Current System)"
            lead="What exists and executes in this repository today. Production-tested primitives built on GitHub Actions, Node.js, and in-toto Ed25519 DSSE."
          />

          <div className="mt-14 border-t-[3px] border-ink">
            <div className="hidden grid-cols-[1fr_0.8fr_1.7fr] gap-8 px-2 py-4 lg:grid">
              <div className="clause text-stone">Component</div>
              <div className="clause text-stone">Current Role</div>
              <div className="clause text-stone">Why it is here</div>
            </div>
            {ACTIVE_STACK.map(([name, role, why], i) => (
              <Reveal key={name} delay={Math.min(i * 0.02, 0.24)}>
                <div className="ledger-row grid gap-x-8 gap-y-3 px-2 py-7 lg:grid-cols-[1fr_0.8fr_1.7fr]">
                  <h3 className="text-[21px] leading-[1.3]">{name}</h3>
                  <div className="label text-certified">{role}</div>
                  <p className="text-[19px] leading-[1.6] text-ink-soft">{why}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-20">
            <SectionHead
              clause="4.1b"
              title="Planned Enterprise Architecture (Roadmap)"
              lead="Long-term enterprise integration specifications planned for high-scale multi-tenant deployments."
            />
            <div className="mt-14 border-t-[3px] border-ink">
              <div className="hidden grid-cols-[1fr_0.8fr_1.7fr] gap-8 px-2 py-4 lg:grid">
                <div className="clause text-stone">Component</div>
                <div className="clause text-stone">Planned Role</div>
                <div className="clause text-stone">Future Integration</div>
              </div>
              {PLANNED_STACK.map(([name, role, why], i) => (
                <Reveal key={name} delay={Math.min(i * 0.02, 0.24)}>
                  <div className="ledger-row grid gap-x-8 gap-y-3 px-2 py-7 lg:grid-cols-[1fr_0.8fr_1.7fr]">
                    <h3 className="text-[21px] leading-[1.3]">{name}</h3>
                    <div className="label text-navy">{role}</div>
                    <p className="text-[19px] leading-[1.6] text-ink-soft">{why}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- 4.2 ZONES */}
      <section className="border-y border-ink/15 bg-paper-2 px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="4.2"
            title="Four trust zones, and exactly one door between each"
            lead="The interesting property is not what the system can do, it is what cannot cross a boundary. Each arrow below carries a single well-defined artifact type and nothing else."
          />

          <div className="mt-14 space-y-6">
            {[
              {
                z: "Zone 1",
                n: "Public ingress",
                b: "A single HTTP endpoint that verifies a signature, records a delivery and enqueues work. It cannot read repositories, cannot write anything, and cannot start a repair without a valid signed delivery.",
                crosses: "in: signed webhook payload · out: 202 Accepted",
              },
              {
                z: "Zone 2",
                n: "Control plane",
                b: "Temporal workers and PostgreSQL. Holds credentials, orchestrates stages, owns the idempotency key. It never executes repository code — that is the entire reason zone 3 exists.",
                crosses: "in: repair intent · out: patch candidates",
              },
              {
                z: "Zone 3",
                n: "Verification pool",
                b: "Single-tenant microVMs with denied egress and a pinned image. Untrusted code runs here and nowhere else. Nothing written inside a sandbox is trusted until it has been hashed and recorded.",
                crosses: "in: candidate patch · out: hashed transcript",
              },
              {
                z: "Zone 4",
                n: "Evidence store & signing",
                b: "Content-addressed storage plus the signing path. Holds logs, transcripts, bundles and attestation subjects. The signing key never enters zones 2 or 3 at any point.",
                crosses: "in: hashed evidence · out: signed in-toto statement",
              },
            ].map((z, i) => (
              <Reveal key={z.z} delay={i * 0.06}>
                <div className="grid gap-8 border-t-[3px] border-ink pt-8 lg:grid-cols-[130px_1fr_1fr] lg:gap-14">
                  <div>
                    <div className="clause text-oxide">{z.z}</div>
                    <div className="num mt-3 text-[22px] text-navy">{`0${i + 1}`}</div>
                  </div>
                  <div>
                    <h3 className="text-[clamp(24px,2.9vw,34px)] leading-[1.16]">{z.n}</h3>
                    <p className="mt-5 max-w-[54ch] text-[20px] leading-[1.62] text-ink-soft">
                      {z.b}
                    </p>
                  </div>
                  <div className="border-l-2 border-navy/40 pl-7">
                    <div className="clause text-stone">What crosses</div>
                    <p className="mono mt-4 text-[15px] leading-[1.7] text-navy">{z.crosses}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- 4.3 THREAT MODEL */}
      <section id="threat-model" className="px-6 py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1180px]">
          <SectionHead
            clause="4.3"
            title="The threat model, including what is left open"
            lead="An autonomous system that edits your code is a privileged system. These are the ways it can be wrong or be attacked, what is done about each, and what remains after that."
          />

          <div className="mt-14 space-y-px bg-ink/15">
            {THREATS.map((t, i) => (
              <Reveal key={t.n} delay={i * 0.04}>
                <article className="bg-paper px-5 py-11 lg:px-10">
                  <div className="grid gap-9 lg:grid-cols-[110px_1fr] lg:gap-12">
                    <div className="num text-[clamp(32px,3.6vw,44px)] leading-[1] text-oxide">
                      {t.n}
                    </div>
                    <div>
                      <h3 className="text-[clamp(24px,2.9vw,33px)] leading-[1.18]">{t.threat}</h3>
                      <p className="mt-5 max-w-[70ch] text-[20px] leading-[1.62] text-ink-soft">
                        {t.body}
                      </p>

                      <div className="mt-8 grid gap-px border border-ink/20 bg-ink/20 lg:grid-cols-2">
                        <div className="bg-paper px-7 py-7">
                          <div className="clause text-certified">Mitigation</div>
                          <p className="mt-4 text-[19px] leading-[1.6]">{t.mitigation}</p>
                        </div>
                        <div className="bg-paper px-7 py-7">
                          <div className="clause text-oxide">Residual risk</div>
                          <p className="mt-4 text-[19px] leading-[1.6]">{t.residual}</p>
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

      {/* ------------------------------------------------------- 4.4 NON-GOALS */}
      <section className="border-y border-ink/15 bg-console px-6 py-24 text-paper lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1080px]">
          <SectionHead
            clause="4.4"
            dark
            title="What this system is not trying to do"
            lead="Non-goals are part of the specification. These are deliberate exclusions, and each one is a boundary somebody asked us to remove and we declined."
          />

          <div className="mt-14 grid gap-px border border-paper/20 bg-paper/20 sm:grid-cols-2">
            {[
              [
                "It is not a merge bot",
                "Publication is a draft PR and a check run. Merging is a human decision, and the system is not able to make it on your behalf even if you ask.",
              ],
              [
                "It is not a general-purpose agent",
                "It does one thing: it repairs failing continuous integration. It will not write features, refactor for taste, or answer questions about your codebase.",
              ],
              [
                "It is not a test generator",
                "The regression test it writes is a by-product of repair, not a coverage strategy. Coverage work is a different job with different evidence.",
              ],
              [
                "It is not a security scanner",
                "It runs scans as a gate and reports their findings in the bundle. It does not claim to find vulnerabilities, and it does not fix them.",
              ],
            ].map(([h, b]) => (
              <div key={h} className="bg-console-2 px-8 py-10">
                <h3 className="text-[clamp(22px,2.6vw,28px)] leading-[1.22]">{h}</h3>
                <p className="mt-5 text-[19px] leading-[1.62] text-paper/80">{b}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 flex flex-col items-center gap-6 text-center">
            <Link href="/runs" className="btn btn-on-dark">
              See it working on real failures
            </Link>
            <p className="max-w-[60ch] text-[19px] leading-[1.6] text-paper/70">
              The repair ledger is public: every certified run, every escalation, and every
              candidate that was rejected along the way.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
