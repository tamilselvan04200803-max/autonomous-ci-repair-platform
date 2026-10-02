import crypto from "node:crypto";

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function hmacHex(secret: string, data: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** GitHub X-Hub-Signature-256 — HMAC-SHA256 over the raw body, constant-time compare. */
export function verifyGithubSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  return safeEqual(header, `sha256=${hmacHex(secret, raw)}`);
}

/** Deterministic JSON (sorted keys) so digests are reproducible by any verifier. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/* --------------------------------------------------------------- DSSE */

export const IN_TOTO_PAYLOAD_TYPE = "application/vnd.in-toto+json";

/** DSSE v1 Pre-Authentication Encoding. */
export function pae(payloadType: string, payload: Buffer): Buffer {
  const t = Buffer.from(payloadType);
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${t.length} `),
    t,
    Buffer.from(` ${payload.length} `),
    payload,
  ]);
}

export type DsseEnvelope = {
  payloadType: string;
  payload: string; // base64
  signatures: { keyid: string; sig: string }[];
};

type LoadedKey = { keyid: string; privateKey: crypto.KeyObject; publicPem: string };

const g = globalThis as typeof globalThis & { __aegisKey?: Promise<LoadedKey> };

function keyIdFor(publicPem: string): string {
  const der = crypto.createPublicKey(publicPem).export({ type: "spki", format: "der" });
  return `aegis-ed25519-${sha256Hex(der).slice(0, 16)}`;
}

async function loadKey(): Promise<LoadedKey> {
  const envPem = process.env.FORGE_SIGNING_KEY?.replace(/\\n/g, "\n");
  if (envPem) {
    const privateKey = crypto.createPrivateKey(envPem);
    const publicPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    return { keyid: keyIdFor(publicPem), privateKey, publicPem };
  }
  // Lazy imports keep pure crypto helpers usable without a database (tests, CLI).
  const [{ db }, { ensureSchema }, { signingKeys }] = await Promise.all([
    import("@/db"),
    import("@/db/ensure"),
    import("@/db/schema"),
  ]);
  await ensureSchema();
  const [row] = await db.select().from(signingKeys).limit(1);
  if (row) {
    return { keyid: row.id, privateKey: crypto.createPrivateKey(row.privatePem), publicPem: row.publicPem };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyid = keyIdFor(publicPem);
  await db.insert(signingKeys).values({ id: keyid, publicPem, privatePem }).onConflictDoNothing();
  return { keyid, privateKey, publicPem };
}

export function getSigningKey(): Promise<LoadedKey> {
  if (!g.__aegisKey) {
    g.__aegisKey = loadKey().catch((e) => {
      g.__aegisKey = undefined;
      throw e;
    });
  }
  return g.__aegisKey;
}

export async function signStatement(statement: unknown): Promise<DsseEnvelope> {
  const key = await getSigningKey();
  const payload = Buffer.from(canonicalJson(statement));
  const sig = crypto.sign(null, pae(IN_TOTO_PAYLOAD_TYPE, payload), key.privateKey);
  return {
    payloadType: IN_TOTO_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: key.keyid, sig: sig.toString("base64") }],
  };
}

export type VerifyResult = {
  ok: boolean;
  reason: string;
  keyid?: string;
  statement?: Record<string, unknown>;
  subjectDigestMatches?: boolean;
};

/** Verifies a DSSE envelope and, if present, recomputes the subject digest from the embedded bundle. */
export function verifyEnvelope(envelope: DsseEnvelope, publicPem: string): VerifyResult {
  try {
    if (envelope?.payloadType !== IN_TOTO_PAYLOAD_TYPE) return { ok: false, reason: "Unexpected payloadType" };
    const payload = Buffer.from(envelope.payload, "base64");
    const pub = crypto.createPublicKey(publicPem);
    const expectedId = keyIdFor(publicPem);
    const sig = envelope.signatures?.find((s) => s.keyid === expectedId) ?? envelope.signatures?.[0];
    if (!sig) return { ok: false, reason: "Envelope carries no signatures" };
    const valid = crypto.verify(null, pae(envelope.payloadType, payload), pub, Buffer.from(sig.sig, "base64"));
    if (!valid) return { ok: false, reason: "Signature does not verify against the published key", keyid: sig.keyid };
    const statement = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
    if (statement._type !== "https://in-toto.io/Statement/v1") {
      return { ok: false, reason: "Payload is not an in-toto Statement v1", keyid: sig.keyid };
    }
    let subjectDigestMatches: boolean | undefined;
    const predicate = statement.predicate as { bundle?: unknown } | undefined;
    const subject = (statement.subject as { digest?: { sha256?: string } }[] | undefined)?.[0];
    if (predicate?.bundle && subject?.digest?.sha256) {
      subjectDigestMatches = sha256Hex(canonicalJson(predicate.bundle)) === subject.digest.sha256;
      if (!subjectDigestMatches) {
        return { ok: false, reason: "Subject digest does not match the embedded bundle", keyid: sig.keyid, statement };
      }
    }
    return { ok: true, reason: "Signature valid", keyid: sig.keyid, statement, subjectDigestMatches };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Malformed envelope" };
  }
}
