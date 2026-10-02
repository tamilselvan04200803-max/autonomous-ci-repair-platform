import type { Metadata } from "next";
import { PageCover, SectionHead } from "@/components/Chrome";
import { VerifyConsole } from "./VerifyConsole";

export const metadata: Metadata = {
  title: "Verify a proof bundle — Aegis Forge",
  description: "Check the Ed25519 DSSE signature and in-toto subject digest of an Aegis Forge proof bundle.",
};

export default function VerifyPage() {
  return (
    <>
      <PageCover
        clause="Tool"
        eyebrow="Bundle verifier"
        title={<>Don&apos;t trust the bundle. <em className="italic text-navy">Check</em> it.</>}
        standfirst="Every proof bundle is an in-toto Statement wrapped in a DSSE envelope and signed with Ed25519. This page recomputes the signature and the subject digest. Load a run, verify it, then press “Tamper with it” and watch it fail."
        meta={[
          { label: "Envelope", value: "DSSE v1" },
          { label: "Statement", value: "in-toto v1" },
          { label: "Signature", value: "Ed25519" },
          { label: "Offline", value: "aegis.mjs" },
        ]}
      />
      <section className="px-6 py-20 lg:px-12 lg:py-24">
        <VerifyConsole />
      </section>
      <section className="border-t border-ink/15 bg-paper-2 px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-[1080px]">
          <SectionHead
            clause="V.1"
            title="Verify without this server"
            lead="The verifier is part of the runner and has no dependencies. Fetch the public key once, keep it, and verify bundles forever — even if this control plane is gone."
          />
          <pre className="code-slab mx-auto mt-12 max-w-[860px] whitespace-pre-wrap break-words">{`curl -fsSL $AEGIS_URL/api/keys?format=pem      -o aegis.pub.pem
curl -fsSL $AEGIS_URL/api/runs/AF-04-1187/bundle -o bundle.json
node runner/aegis.mjs verify-bundle bundle.json --key aegis.pub.pem

✓ signature valid (aegis-ed25519-…)
✓ subject sha256:… matches bundle
  result:       PASSED`}</pre>
        </div>
      </section>
    </>
  );
}
