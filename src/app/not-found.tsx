import Link from "next/link";
import { AegisMark } from "@/components/AegisMark";

export default function NotFound() {
  return (
    <section className="px-6 py-28 lg:px-12 lg:py-40">
      <div className="mx-auto max-w-[820px] text-center">
        <AegisMark className="mx-auto h-16 w-auto text-navy" />

        <div className="clause mt-10 text-oxide">Error 404 · Record not found</div>

        <h1 className="mx-auto mt-8 max-w-[16ch] text-[clamp(38px,6vw,72px)] leading-[1.04]">
          This evidence set is not on file
        </h1>

        <p className="measure mt-8 text-[21px] leading-[1.62] text-ink-soft">
          The reference you followed does not match any run, stage or document in the ledger. That
          is usually a truncated fingerprint or an expired run identifier rather than a missing
          repair — the ledger keeps every attempt, certified or otherwise, for seven years.
        </p>

        <div className="paper-slab mt-12 text-left">
{`expected:
  /runs/AF-04-####          repair run record
  /pipeline                 the sixteen stages
  /proof-bundle             anatomy of the certificate
  /architecture             trust boundaries and threat model`}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
          <Link href="/runs" className="btn btn-primary">
            Search the repair ledger
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to the dossier
          </Link>
        </div>
      </div>
    </section>
  );
}
