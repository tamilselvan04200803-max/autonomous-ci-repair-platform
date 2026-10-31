import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = path.join(__dirname, "..", "examples", "proof-bundles");

function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
}

const sha256 = (d) => crypto.createHash("sha256").update(d).digest("hex");

function pae(type, payload) {
  const t = Buffer.from(type);
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${t.length} `),
    t,
    Buffer.from(` ${payload.length} `),
    payload,
  ]);
}

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const der = publicKey.export({ type: "spki", format: "der" });
const keyid = `aegis-ed25519-${sha256(der).slice(0, 16)}`;

const bundle = {
  run_id: "AF-04-1187",
  repository: "aegis-forge/specimen",
  commit_sha: "d4b7c1a890f23e41b5a6c7d8e9f0123456789abc",
  failure_class: "compile",
  fingerprint: "fp_ts2305_serialize_orderstate_3b8a1",
  failing_command: "pnpm --filter @aegis/gateway test:unit serialize.spec.ts",
  regression_test: "serialize.spec.ts › emits a discriminated OrderState payload",
  patch_summary: "type(gateway): type serialize() against the narrowed OrderState union",
  risk_score: 0.12,
  reproduction_attempts: [2, 2, 2],
  regression_red: true,
  regression_green: true,
  policy_passed: true,
  model: "pydantic-ai / claude-sonnet-4.5",
  sandbox_id: "sbx_7f3a91c4",
  duration_sec: 1394,
};

const statement = {
  _type: "https://in-toto.io/Statement/v1",
  subject: [
    {
      name: "aegis-forge/proof-bundle/AF-04-1187",
      digest: { sha256: sha256(canonicalJson(bundle)) },
    },
  ],
  predicateType: "https://aegis-forge.dev/attestations/ci-repair/v1",
  predicate: {
    bundle,
    verificationResult: "PASSED",
    timeVerified: "2026-03-04T11:45:47Z",
  },
};

const payload = Buffer.from(canonicalJson(statement));
const sig = crypto.sign(null, pae("application/vnd.in-toto+json", payload), privateKey);

const envelope = {
  payloadType: "application/vnd.in-toto+json",
  payload: payload.toString("base64"),
  signatures: [{ keyid, sig: sig.toString("base64") }],
};

fs.writeFileSync(path.join(TARGET_DIR, "sample-signed-bundle.json"), JSON.stringify(envelope, null, 2));
fs.writeFileSync(path.join(TARGET_DIR, "aegis-sample-pub.pem"), pubPem);

console.log("Successfully generated sample DSSE bundle & public key in examples/proof-bundles/");
console.log(`Key ID: ${keyid}`);
