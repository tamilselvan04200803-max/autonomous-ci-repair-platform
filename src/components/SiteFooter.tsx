import Link from "next/link";
import { AegisMark } from "./AegisMark";

const COLUMNS = [
  {
    clause: "01",
    title: "The System",
    links: [
      { href: "/pipeline", label: "Sixteen-stage pipeline" },
      { href: "/proof-bundle", label: "Proof bundle anatomy" },
      { href: "/architecture", label: "Trust boundaries" },
      { href: "/architecture#threat-model", label: "Threat model" },
    ],
  },
  {
    clause: "02",
    title: "The Record",
    links: [
      { href: "/runs", label: "Repair run ledger" },
      { href: "/runs?state=certified", label: "Certified patches" },
      { href: "/runs?state=escalated", label: "Escalation log" },
      { href: "/runs?state=verifying", label: "Gate queue" },
    ],
  },
  {
    clause: "03",
    title: "The Evidence",
    links: [
      { href: "/proof-bundle#fingerprint", label: "Failure fingerprints" },
      { href: "/proof-bundle#regression", label: "Regression tests" },
      { href: "/proof-bundle#attestation", label: "Signed attestations" },
      { href: "/proof-bundle#execution-trace", label: "Model & tool trace" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-console text-paper">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage: "url(/images/console.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-[1360px] px-6 py-20 lg:px-12 lg:py-28">
        <div className="grid gap-14 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-4">
              <AegisMark className="h-12 w-auto text-paper" />
              <div>
                <div className="font-sans text-[21px] font-semibold uppercase tracking-[0.18em]">
                  Aegis Forge
                </div>
                <div className="clause mt-1 text-paper/75">Control Plane AF-CP-2</div>
              </div>
            </div>
            <p className="mt-7 max-w-[42ch] text-[19px] leading-[1.7] text-paper/80">
              Autonomous repair for failing continuous integration. Every patch is reproduced,
              regressed, scored and signed before a human is ever asked to look at it — and nothing
              is published that the evidence gate has not certified.
            </p>
            <div className="mt-8 inline-flex items-center gap-3 border border-paper/25 px-5 py-3">
              <span className="pulse-dot inline-block h-[10px] w-[10px] rounded-full bg-certified" />
              <span className="clause text-paper/85">Evidence gate operational</span>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.clause}>
              <div className="clause text-amber">
                {col.clause} · {col.title}
              </div>
              <ul className="mt-6 space-y-4">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="font-sans text-[16px] leading-[1.5] text-paper/75 underline decoration-paper/25 decoration-1 underline-offset-[6px] transition-colors hover:text-paper hover:decoration-amber"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-20 grid gap-10 border-t border-paper/20 pt-10 md:grid-cols-3">
          <div>
            <div className="clause text-paper/75">Registered office</div>
            <p className="mt-4 text-[17px] leading-[1.7] text-paper/80">
              Aegis Forge Systems
              <br />
              44 Hanger Lane, Unit 12
              <br />
              Bristol BS3 4NA, United Kingdom
            </p>
          </div>
          <div>
            <div className="clause text-paper/75">Correspondence</div>
            <p className="mt-4 text-[17px] leading-[1.7] text-paper/80">
              gate@aegisforge.dev
              <br />
              security@aegisforge.dev
              <br />
              +44 117 496 0142
            </p>
          </div>
          <div>
            <div className="clause text-paper/75">Colophon</div>
            <p className="mt-4 text-[17px] leading-[1.7] text-paper/80">
              Set in Newsreader, Space Grotesk and JetBrains Mono. Figures are tabular throughout.
              Document reference AF-TR-04, revision 2.7.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-paper/20 pt-8 text-paper/75 md:flex-row md:items-center md:justify-between">
          <p className="font-sans text-[15px] tracking-[0.12em] uppercase">
            © 2026 Aegis Forge Systems Ltd · Company 14872093
          </p>
          <p className="mono text-[15px]">
            sig: sha256:9f2c41ab7de0…c814 · SLSA Build L3 · in-toto Statement v1
          </p>
        </div>
      </div>
    </footer>
  );
}
