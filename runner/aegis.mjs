#!/usr/bin/env node
/* Aegis Forge runner — zero dependencies, Node >= 18.
 *
 *   aegis verify                       run inside CI: reproduce → red → patch → green → push → report
 *   aegis verify-bundle <file> [--key <pem-file|url>]   verify a DSSE proof bundle offline
 *   aegis analyze <logfile>            classify a CI log against a control plane
 *   aegis submit <logfile> [--repo o/r --sha <sha> --propose]   open a repair run from any CI
 *
 * Environment for `verify`:
 *   AEGIS_URL            control plane base URL           (required)
 *   AEGIS_RUNNER_SECRET  shared runner secret             (required)
 *   AEGIS_RUN_ID         repair run id                    (required)
 *   AEGIS_EXTRA_CHECKS   newline-separated commands run after the patch (e.g. "npm run typecheck")
 *   AEGIS_SETUP          command run after each checkout (e.g. "npm ci")
 *   AEGIS_PUSH           "false" to skip pushing the repair branch
 *   AEGIS_TIMEOUT_SEC    per-command timeout (default 900)
 */
import { createHash, createHmac, createPublicKey, timingSafeEqual, verify as edVerify } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const [, , cmd, ...args] = process.argv;
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] ?? true : undefined;
};
const log = (...m) => console.log("[aegis]", ...m);
const die = (m, code = 1) => { console.error(`[aegis] ✗ ${m}`); process.exit(code); };

function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
}
const sha256 = (d) => createHash("sha256").update(d).digest("hex");

function sh(command, { allowFail = true, quiet = false } = {}) {
  const started = Date.now();
  const timeout = Number(process.env.AEGIS_TIMEOUT_SEC ?? 900) * 1000;
  if (!quiet) log(`$ ${command}`);
  const r = spawnSync(command, { shell: true, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: "true", TZ: "UTC" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const exitCode = r.status ?? (r.signal ? 124 : 1);
  if (!allowFail && exitCode !== 0) die(`command failed (${exitCode}): ${command}\n${out.slice(-2000)}`);
  return { exitCode, tail: out.slice(-3000), durationMs: Date.now() - started };
}

async function api(path, init = {}) {
  const base = (process.env.AEGIS_URL ?? "").replace(/\/$/, "");
  if (!base) die("AEGIS_URL is not set");
  const headers = { "content-type": "application/json", ...(init.headers ?? {}) };
  if (process.env.AEGIS_RUNNER_SECRET) headers.authorization = `Bearer ${process.env.AEGIS_RUNNER_SECRET}`;
  if (process.env.AEGIS_ADMIN_TOKEN) headers.authorization = headers.authorization ?? `Bearer ${process.env.AEGIS_ADMIN_TOKEN}`;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) die(`${init.method ?? "GET"} ${path} → ${res.status} ${json.error ?? text.slice(0, 200)}`);
  return json;
}

function lockfileHashes() {
  const out = {};
  for (const f of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "uv.lock", "requirements.txt", "go.sum", "Cargo.lock"]) {
    if (existsSync(f)) out[f] = sha256(readFileSync(f));
  }
  return out;
}

function resetTo(sha) {
  sh("git reset --hard -q && git clean -fdq", { quiet: true });
  sh(`git checkout -q --detach ${sha}`, { allowFail: false, quiet: true });
  if (process.env.AEGIS_SETUP) sh(process.env.AEGIS_SETUP, { allowFail: false });
}

/* ------------------------------------------------------------- verify */
async function verifyCmd() {
  const runId = process.env.AEGIS_RUN_ID ?? flag("run");
  if (!runId) die("AEGIS_RUN_ID is not set");
  if (!process.env.AEGIS_RUNNER_SECRET) die("AEGIS_RUNNER_SECRET is not set");
  const started = Date.now();

  const { job, signature } = await api(`/api/runs/${runId}/job`);
  const expected = `sha256=${createHmac("sha256", process.env.AEGIS_RUNNER_SECRET).update(canonicalJson(job)).digest("hex")}`;
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    die("job signature mismatch — refusing to execute commands from an unauthenticated job");
  }
  log(`job ${runId}: ${job.candidates.length} candidate(s) for ${job.repo}@${job.baseSha.slice(0, 10)}`);

  sh(`git fetch -q --depth=50 origin ${job.baseSha} || true`, { quiet: true });

  // 1. Reproduce three times on the unmodified commit
  const attempts = [];
  for (let i = 0; i < 3; i++) {
    resetTo(job.baseSha);
    attempts.push(sh(job.failingCommand).exitCode);
  }
  log(`reproduction exit codes: ${attempts.join(", ")}`);
  const reproduced = attempts.every((c) => c !== 0);

  const results = [];
  let winner = null;
function sanitizeTestPath(testPath) {
  if (!testPath || typeof testPath !== "string") throw new Error("Invalid or empty testPath");
  const cwd = process.cwd();
  const target = resolve(cwd, testPath);
  if (!target.startsWith(cwd + sep)) {
    throw new Error(`Path traversal rejected: ${testPath} resolves outside workspace`);
  }
  return target;
}

function sanitizeTestCommand(cmd) {
  if (!cmd || typeof cmd !== "string") throw new Error("Invalid or empty testCommand");
  const trimmed = cmd.trim();
  // Disallow shell operators that allow chaining arbitrary commands or subshells
  if (/[;&|`$()]/.test(trimmed)) {
    throw new Error(`Command injection rejected: shell metacharacters detected in testCommand "${trimmed}"`);
  }
  return trimmed;
}

  if (reproduced) {
    for (const c of job.candidates) {
      log(`— ${c.label}`);
      resetTo(job.baseSha);
      const r = { id: c.id, applied: false };

      // 1. Validate security boundaries for candidate
      let safePath;
      let safeCmd;
      try {
        safePath = sanitizeTestPath(c.testPath);
        safeCmd = sanitizeTestCommand(c.testCommand);
      } catch (err) {
        log(`Candidate rejected by security policy: ${err.message}`);
        r.applyError = `Security rejection: ${err.message}`;
        results.push(r);
        continue;
      }

      // 2. regression test must fail before the patch
      mkdirSync(dirname(safePath), { recursive: true });
      writeFileSync(safePath, c.testContent);
      r.red = sh(safeCmd);
      // 3. apply the patch
      const pfile = join(tmpdir(), `aegis-${runId}-${c.id}.diff`);
      writeFileSync(pfile, c.patch.endsWith("\n") ? c.patch : `${c.patch}\n`);
      const apply = sh(`git apply --whitespace=nowarn --recount ${JSON.stringify(pfile)}`);
      r.applied = apply.exitCode === 0;
      if (!r.applied) { r.applyError = apply.tail.slice(-400); results.push(r); continue; }
      // 4. green: regression test, original command, extra checks
      r.green = sh(safeCmd);
      r.command = sh(job.failingCommand);
      r.checks = (process.env.AEGIS_EXTRA_CHECKS ?? "").split("\n").map((s) => s.trim()).filter(Boolean)
        .map((command) => ({ command, ...sh(command) }));
      sh("git add -A", { quiet: true });
      r.diff = spawnSync("git diff --cached", { shell: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout ?? "";
      const ok = r.red.exitCode !== 0 && r.green.exitCode === 0 && r.command.exitCode === 0 && r.checks.every((x) => x.exitCode === 0);
      results.push(r);
      log(`${c.label}: red=${r.red.exitCode} green=${r.green.exitCode} command=${r.command.exitCode} → ${ok ? "PASS" : "FAIL"}`);
      if (ok) { winner = c; break; }
    }
  }

  // 5. push the winning branch
  let pushed = false;
  if (winner && process.env.AEGIS_PUSH !== "false") {
    sh(`git checkout -q -B ${job.branch}`, { allowFail: false, quiet: true });
    sh(`git -c user.name="Aegis Forge" -c user.email="aegis-forge@users.noreply.github.com" commit -q -m "fix: aegis forge repair ${runId}" -m "Evidence: ${process.env.AEGIS_URL}/runs/${runId}"`, { allowFail: false });
    pushed = sh(`git push -q --force origin HEAD:refs/heads/${job.branch}`).exitCode === 0;
    log(pushed ? `pushed ${job.branch}` : "push failed");
  }

  const env = {};
  for (const k of ["RUNNER_NAME", "RUNNER_OS", "RUNNER_ARCH", "ImageOS", "ImageVersion", "GITHUB_RUN_ID", "GITHUB_REPOSITORY"]) env[k] = process.env[k];
  env.node = process.version;

  const report = {
    reproduce: { attempts },
    environment: env,
    lockfiles: lockfileHashes(),
    candidates: results,
    winner: winner?.id ?? null,
    pushed,
    branch: pushed ? job.branch : undefined,
    durationSec: Math.round((Date.now() - started) / 1000),
  };
  const res = await api(`/api/runs/${runId}/verification`, { method: "POST", body: JSON.stringify(report) });
  log(res.certifiable ? "✓ all gates passed — draft PR will be opened" : "✗ gates failed — run escalated");
  for (const g of res.gates ?? []) log(`  ${g.pass ? "✓" : "✗"} ${g.gate.padEnd(22)} ${g.detail}`);
}

/* ------------------------------------------------------ verify-bundle */
function pae(type, payload) {
  const t = Buffer.from(type);
  return Buffer.concat([Buffer.from(`DSSEv1 ${t.length} `), t, Buffer.from(` ${payload.length} `), payload]);
}

async function verifyBundleCmd() {
  const file = args[0];
  if (!file) die("usage: aegis verify-bundle <bundle.json> [--key <pem-file|url>]");
  const env = JSON.parse(readFileSync(file, "utf8"));
  const keyArg = flag("key") ?? (process.env.AEGIS_URL ? `${process.env.AEGIS_URL.replace(/\/$/, "")}/api/keys?format=pem` : undefined);
  if (!keyArg) die("pass --key <pem-file|url> or set AEGIS_URL");
  let pem;
  if (/^https?:/.test(keyArg)) {
    const url = keyArg.includes("format=pem") ? keyArg : `${keyArg}${keyArg.includes("?") ? "&" : "?"}format=pem`;
    pem = await (await fetch(url)).text();
  } else pem = readFileSync(keyArg, "utf8");
  const payload = Buffer.from(env.payload, "base64");
  const sig = env.signatures?.[0];
  if (!sig) die("envelope has no signatures");
  const ok = edVerify(null, pae(env.payloadType, payload), createPublicKey(pem), Buffer.from(sig.sig, "base64"));
  if (!ok) die("signature INVALID", 2);
  const st = JSON.parse(payload.toString("utf8"));
  const digest = sha256(canonicalJson(st.predicate.bundle));
  if (digest !== st.subject[0].digest.sha256) die("subject digest does NOT match embedded bundle", 2);
  console.log(`✓ signature valid (${sig.keyid})`);
  console.log(`✓ subject sha256:${digest.slice(0, 16)}… matches bundle`);
  console.log(`  run:          ${st.predicate.bundle.run_id} (${st.predicate.bundle.repository})`);
  console.log(`  result:       ${st.predicate.verificationResult}`);
  console.log(`  verified at:  ${st.predicate.timeVerified}`);
  if (st.predicate.verificationResult !== "PASSED") process.exit(3);
}

/* ------------------------------------------------------ analyze/submit */
async function analyzeCmd() {
  if (!args[0]) die("usage: aegis analyze <logfile>");
  const logText = readFileSync(args[0], "utf8");
  const { analysis: a, ms } = await api("/api/analyze", { method: "POST", body: JSON.stringify({ log: logText }) });
  console.log(`class        ${a.classLabel}  (${Math.round(a.confidence * 100)}%, ${a.language}, ${ms}ms)`);
  console.log(`fingerprint  ${a.fingerprint}`);
  console.log(`command      ${a.failingCommand ?? "—"}`);
  console.log(`primary      ${a.primaryError ? `${a.primaryError.code ?? ""} ${a.primaryError.message}` : "—"}`);
  console.log(`files        ${a.localised.map((l) => `${l.file}${l.line ? `:${l.line}` : ""}`).join(", ") || "—"}`);
  console.log(`\n${a.rootCauseHint}`);
  for (const f of a.fixStrategies) console.log(`  • ${f}`);
  if (a.escalationReason) console.log(`\n⚠ ${a.escalationReason}`);
}

async function submitCmd() {
  if (!args[0]) die("usage: aegis submit <logfile> [--repo owner/name --sha <sha> --branch main --workflow ci --propose]");
  const body = {
    log: readFileSync(args[0], "utf8"),
    repo: flag("repo") ?? process.env.GITHUB_REPOSITORY,
    commitSha: flag("sha") ?? process.env.GITHUB_SHA,
    branch: flag("branch") ?? process.env.GITHUB_REF_NAME,
    workflow: flag("workflow") ?? process.env.GITHUB_WORKFLOW,
    propose: Boolean(flag("propose")),
  };
  const r = await api("/api/runs", { method: "POST", body: JSON.stringify(body) });
  console.log(`${r.created ? "created" : "deduplicated"} ${r.id} (${r.state}) → ${process.env.AEGIS_URL}${r.url}`);
}

const commands = { verify: verifyCmd, "verify-bundle": verifyBundleCmd, analyze: analyzeCmd, submit: submitCmd };
if (!commands[cmd]) {
  console.log("usage: aegis <verify|verify-bundle|analyze|submit> …   (see header of runner/aegis.mjs)");
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch((e) => die(e?.stack ?? String(e)));
