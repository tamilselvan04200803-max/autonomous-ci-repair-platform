"use client";

import { useState } from "react";

type Result = {
  ok: boolean;
  reason: string;
  keyid: string | null;
  subjectDigestMatches: boolean | null;
  verificationResult: string | null;
  timeVerified: string | null;
  runId: string | null;
  repository: string | null;
};

export function VerifyConsole() {
  const [text, setText] = useState("");
  const [runId, setRunId] = useState("AF-04-1187");
  const [pub, setPub] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadRun() {
    setErr(null);
    setResult(null);
    const res = await fetch(`/api/runs/${encodeURIComponent(runId.trim())}/bundle`);
    if (!res.ok) { setErr(`No bundle for ${runId} (${res.status})`); return; }
    setText(await res.text());
  }

  async function verify() {
    setBusy(true);
    setErr(null);
    try {
      let envelope: unknown;
      try { envelope = JSON.parse(text); } catch { throw new Error("The bundle is not valid JSON."); }
      const res = await fetch("/api/attestations/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope, publicKey: pub.trim() || undefined }),
      });
      setResult(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "verification failed");
    } finally {
      setBusy(false);
    }
  }

  function tamper() {
    try {
      const env = JSON.parse(text);
      const binary = atob(env.payload);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const decodedStr = new TextDecoder().decode(bytes);
      const st = JSON.parse(decodedStr);
      st.predicate.bundle.root_cause = `${st.predicate.bundle.root_cause} (edited)`;
      const encodedBytes = new TextEncoder().encode(JSON.stringify(st));
      let binaryStr = "";
      for (let i = 0; i < encodedBytes.length; i++) {
        binaryStr += String.fromCharCode(encodedBytes[i]);
      }
      env.payload = btoa(binaryStr);
      setText(JSON.stringify(env, null, 2));
      setResult(null);
    } catch {
      setErr("Load a valid bundle first.");
    }
  }

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="flex flex-wrap items-end justify-center gap-4">
        <div>
          <label htmlFor="rid" className="clause text-stone">Load the bundle of a run</label>
          <input id="rid" value={runId} onChange={(e) => setRunId(e.target.value)} className="mt-3 block w-[260px] border border-ink/30 bg-paper px-5 py-4 font-mono text-[16px]" />
        </div>
        <button type="button" onClick={loadRun} className="btn btn-ghost">Load bundle</button>
        <button type="button" onClick={tamper} className="btn btn-ghost">Tamper with it</button>
      </div>

      <label htmlFor="env" className="clause mt-10 block text-stone">DSSE envelope (proof-bundle.dsse.json)</label>
      <textarea
        id="env"
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); }}
        spellCheck={false}
        placeholder='{"payloadType":"application/vnd.in-toto+json","payload":"…","signatures":[…]}'
        className="mt-4 h-[320px] w-full resize-y border border-ink/30 bg-console p-6 font-mono text-[15px] leading-[1.6] text-[#d9e2ec] placeholder:text-paper/50"
      />

      <details className="mt-5">
        <summary className="label cursor-pointer text-navy">Verify against a different public key (optional)</summary>
        <textarea aria-label="Custom public key PEM" value={pub} onChange={(e) => setPub(e.target.value)} placeholder="-----BEGIN PUBLIC KEY-----" className="mt-4 h-[120px] w-full border border-ink/30 bg-paper p-4 font-mono text-[15px]" />
      </details>

      <div className="mt-8 text-center">
        <button type="button" onClick={verify} disabled={busy || !text.trim()} className="btn btn-primary disabled:opacity-50">
          {busy ? "Verifying…" : "Verify signature"}
        </button>
      </div>

      {err && <div role="alert" className="mx-auto mt-8 max-w-[720px] border-l-4 border-oxide bg-oxide/10 px-6 py-4 text-[18px] text-oxide">{err}</div>}

      {result && (
        <div className={`mx-auto mt-12 max-w-[820px] border-2 px-8 py-10 text-center ${result.ok ? "border-certified bg-certified/5" : "border-oxide bg-oxide/5"}`}>
          <div className={`stamp inline-block text-[18px] ${result.ok ? "text-certified" : "text-oxide"}`}>
            {result.ok ? "Signature valid" : "Not evidence"}
          </div>
          <p className="mt-6 text-[20px] leading-[1.6]">{result.reason}</p>
          <div className="mt-8 grid gap-px border border-ink/20 bg-ink/20 text-left sm:grid-cols-2">
            {[
              ["Key id", result.keyid ?? "—"],
              ["Subject digest", result.subjectDigestMatches === null ? "—" : result.subjectDigestMatches ? "matches bundle" : "MISMATCH"],
              ["Verification result", result.verificationResult ?? "—"],
              ["Run", result.runId ? `${result.runId} · ${result.repository}` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="bg-paper px-5 py-5">
                <div className="clause text-stone">{k}</div>
                <div className="mono mt-2 break-all text-[15px]">{v}</div>
              </div>
            ))}
          </div>
          {result.ok && result.verificationResult !== "PASSED" && (
            <p className="mt-6 text-[17px] text-ink-soft">The signature is authentic, but this run was not certified — the bundle honestly records a FAILED or in-progress verification.</p>
          )}
        </div>
      )}
    </div>
  );
}
