import type { Metadata } from "next";
import { PageCover, SectionHead } from "@/components/Chrome";
import { SAMPLE_LOGS } from "@/lib/samples";
import { AnalyzeConsole } from "./AnalyzeConsole";

export const metadata: Metadata = {
  title: "Analyse a CI failure — Aegis Forge",
  description: "Paste any failed CI log and get its failure class, fingerprint, failing command, localised files and a root-cause hint — offline, in milliseconds, no model required.",
};

export default function AnalyzePage() {
  return (
    <>
      <PageCover
        clause="Tool"
        eyebrow="Failure analyser"
        title={<>Paste a red build. Get the <em className="italic text-navy">first</em> five minutes back.</>}
        standfirst="The analyser is the deterministic front half of the pipeline. It recovers the failing command, classifies the failure, fingerprints it and points at the files most likely responsible. No API key, no model, nothing stored — the same code the webhook uses on every delivery."
        meta={[
          { label: "Languages", value: "TS · Py · Go · Rust · JS" },
          { label: "Tools parsed", value: "21 signatures" },
          { label: "Typical latency", value: "< 20 ms" },
          { label: "Stored", value: "nothing" },
        ]}
      />

      <section className="px-6 py-20 lg:px-12 lg:py-24">
        <AnalyzeConsole samples={SAMPLE_LOGS} />
      </section>

      <section className="border-t border-ink/15 bg-paper-2 px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-[1080px]">
          <SectionHead
            clause="A.1"
            title="Use it from a terminal or from any CI"
            lead="The same analysis is available over HTTP and through the zero-dependency runner, so it fits into GitLab, Buildkite or Jenkins just as easily as GitHub Actions."
          />
          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            <div>
              <div className="clause text-stone">curl</div>
              <pre className="code-slab mt-4 whitespace-pre-wrap break-words">{`curl -s -X POST $AEGIS_URL/api/analyze \\
  -H 'content-type: text/plain' \\
  --data-binary @failed-job.log | jq .analysis.classLabel`}</pre>
            </div>
            <div>
              <div className="clause text-stone">runner CLI</div>
              <pre className="code-slab mt-4 whitespace-pre-wrap break-words">{`curl -fsSLO $AEGIS_URL/runner/aegis.mjs
AEGIS_URL=$AEGIS_URL node aegis.mjs analyze failed-job.log
AEGIS_URL=$AEGIS_URL node aegis.mjs submit failed-job.log \\
  --repo acme/api --sha $CI_COMMIT_SHA --propose`}</pre>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
