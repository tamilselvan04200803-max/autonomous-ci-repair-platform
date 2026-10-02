/* Run with:  npx tsx --test tests/*.test.ts
   Pure-logic tests: no database, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { analyzeLog, redact } from "../src/lib/forge/analyze";
import { canonicalJson, hmacHex, pae, verifyGithubSignature } from "../src/lib/forge/crypto";
import { evaluatePolicy, parseUnifiedDiff, scoreRisk } from "../src/lib/forge/policy";
import { SAMPLE_LOGS } from "../src/lib/samples";

const sample = (k: string) => SAMPLE_LOGS.find((s) => s.key === k)!.log;

test("classifies each sample into the expected failure class", () => {
  const expected: Record<string, string> = { ts: "compile", py: "dependency", jest: "unit_test", go: "compile", rust: "compile", flaky: "flaky" };
  for (const [k, cls] of Object.entries(expected)) {
    assert.equal(analyzeLog(sample(k)).failureClass, cls, `sample ${k}`);
  }
});

test("flaky failures are never marked repairable", () => {
  const a = analyzeLog(sample("flaky"));
  assert.equal(a.repairable, false);
  assert.match(a.escalationReason ?? "", /reproduce/);
});

test("recovers the failing command without GitHub's echoed duplicate", () => {
  assert.equal(analyzeLog(sample("ts")).failingCommand, "pnpm --filter @acme/gateway typecheck");
  assert.equal(analyzeLog(sample("go")).failingCommand, "go test ./...");
});

test("localises to repository files, not site-packages or runtime", () => {
  const a = analyzeLog(sample("py"));
  assert.equal(a.localised[0].file, "src/ledger/settings.py");
  assert.ok(a.localised.every((l) => !l.file.includes("site-packages")));
  assert.equal(analyzeLog(sample("rust")).localised[0].file, "crates/edge-router/src/client.rs");
});

test("fingerprint is stable across volatile literals", () => {
  const a = analyzeLog(sample("ts"));
  const shifted = sample("ts").replace(/2026-03-04T11:20/g, "2026-05-09T02:41").replace(/acme\/acme/g, "acme/acme-fork");
  assert.equal(analyzeLog(shifted).fingerprint, a.fingerprint);
  assert.equal(redact("port :54321 after 2000 ms id 7c1d9a02e4"), "port :<port> after <dur> id <hex>");
});

test("webhook signature verification is exact", () => {
  const body = JSON.stringify({ action: "completed" });
  const sig = `sha256=${hmacHex("s3cret", body)}`;
  assert.equal(verifyGithubSignature(body, sig, "s3cret"), true);
  assert.equal(verifyGithubSignature(body + " ", sig, "s3cret"), false);
  assert.equal(verifyGithubSignature(body, null, "s3cret"), false);
});

test("DSSE PAE + ed25519 round-trip, and tampering is detected", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const payload = Buffer.from(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }));
  assert.equal(payload.toString(), '{"a":[2,{"c":4,"d":3}],"b":1}');
  const sig = crypto.sign(null, pae("application/vnd.in-toto+json", payload), privateKey);
  assert.ok(crypto.verify(null, pae("application/vnd.in-toto+json", payload), publicKey, sig));
  const tampered = Buffer.from(payload.toString().replace("1", "9"));
  assert.ok(!crypto.verify(null, pae("application/vnd.in-toto+json", tampered), publicKey, sig));
});

test("policy denies sensitive paths and test deletion; allows a minimal fix", () => {
  const minimal = `--- a/src/serialize.ts\n+++ b/src/serialize.ts\n@@ -1,2 +1,2 @@\n-export function serialize(o: any): any {\n+export function serialize(o: DraftOrder): SerializedOrder {\n`;
  const r1 = scoreRisk({ diff: parseUnifiedDiff(minimal), localised: ["src/serialize.ts"], rawDiff: minimal });
  assert.ok(evaluatePolicy({ risk: r1, provenRed: true, provenGreen: true, reproduced: true }).allow);

  const risky = `--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-  test("expires", () => {})\n+  // removed\n`;
  const r2 = scoreRisk({ diff: parseUnifiedDiff(risky), localised: ["src/serialize.ts"], rawDiff: risky });
  const d = evaluatePolicy({ risk: r2, provenRed: true, provenGreen: true, reproduced: true });
  assert.equal(d.allow, false);
  assert.ok(d.deny.some((x) => x.includes("sensitive")));
});

test("policy refuses when the regression test was never red", () => {
  const r = scoreRisk({ diff: { files: ["a.ts"], filesChanged: 1, insertions: 1, deletions: 1 }, localised: ["a.ts"] });
  assert.equal(evaluatePolicy({ risk: r, provenRed: false, provenGreen: true, reproduced: true }).allow, false);
});
