import { createHash } from "node:crypto";

/* ==========================================================================
   Failure analysis — deterministic, offline, no model required.
   Input: a raw CI log (GitHub Actions format or plain terminal output).
   Output: class, fingerprint, failing command, localised files, root-cause hint.
   ========================================================================== */

export type FailureClassKey =
  | "compile"
  | "dependency"
  | "syntax"
  | "unit_test"
  | "flaky"
  | "infra"
  | "unknown";

export const CLASS_LABELS: Record<FailureClassKey, string> = {
  compile: "Compiler and type-checking failures",
  dependency: "Dependency-upgrade breakage",
  syntax: "Syntax and interface regressions",
  unit_test: "Deterministic unit-test failures",
  flaky: "A limited class of flaky tests",
  infra: "Agent crashes and interrupted runs",
  unknown: "Unclassified failure",
};

/** Classes the pipeline is willing to attempt autonomously. */
export const REPAIRABLE: FailureClassKey[] = ["compile", "dependency", "syntax", "unit_test"];

export type LogError = {
  tool: string;
  cls: FailureClassKey;
  language: string;
  code: string | null;
  message: string;
  file: string | null;
  line: number | null;
  lineIndex: number;
};

export type Frame = { file: string; line: number | null; fn: string | null };

export type Analysis = {
  failureClass: FailureClassKey;
  classLabel: string;
  language: string;
  confidence: number;
  repairable: boolean;
  escalationReason: string | null;
  failingCommand: string | null;
  failingStep: string | null;
  exitCode: number | null;
  primaryError: LogError | null;
  errors: LogError[];
  frames: Frame[];
  localised: { file: string; line: number | null; hits: number; score: number }[];
  fingerprint: string;
  fingerprintInput: string;
  cluster: string;
  rootCauseHint: string;
  fixStrategies: string[];
  excerpt: string;
  stats: { lines: number; errorLines: number; bytes: number };
};

type Rule = {
  re: RegExp;
  tool: string;
  cls: FailureClassKey;
  language: string;
  pick: (m: RegExpMatchArray) => { code?: string | null; message: string; file?: string | null; line?: number | null };
};

const RULES: Rule[] = [
  // ---------------- TypeScript
  {
    re: /([\w./@-]+\.(?:tsx?|mts|cts))\((\d+),\d+\): error (TS\d+): (.+)$/,
    tool: "tsc", cls: "compile", language: "typescript",
    pick: (m) => ({ file: m[1], line: +m[2], code: m[3], message: m[4] }),
  },
  {
    re: /([\w./@-]+\.(?:tsx?|mts|cts)):(\d+):\d+ - error (TS\d+): (.+)$/,
    tool: "tsc", cls: "compile", language: "typescript",
    pick: (m) => ({ file: m[1], line: +m[2], code: m[3], message: m[4] }),
  },
  // ---------------- Python type checkers
  {
    re: /([\w./-]+\.pyi?):(\d+):\d+ - error: (.+?)(?:\s+\((report\w+)\))?$/,
    tool: "pyright", cls: "compile", language: "python",
    pick: (m) => ({ file: m[1], line: +m[2], code: m[4] ?? "pyright", message: m[3] }),
  },
  {
    re: /([\w./-]+\.pyi?):(\d+): error: (.+?)(?:\s+\[([\w-]+)\])?$/,
    tool: "mypy", cls: "compile", language: "python",
    pick: (m) => ({ file: m[1], line: +m[2], code: m[4] ?? "mypy", message: m[3] }),
  },
  // ---------------- Python runtime / pytest
  {
    re: /^(?:E\s+)?(ModuleNotFoundError|ImportError): (.+)$/,
    tool: "python", cls: "dependency", language: "python",
    pick: (m) => ({ code: m[1], message: m[2] }),
  },
  {
    re: /^(?:E\s+)?(SyntaxError|IndentationError|TabError): (.+)$/,
    tool: "python", cls: "syntax", language: "python",
    pick: (m) => ({ code: m[1], message: m[2] }),
  },
  {
    re: /^FAILED ([\w./-]+\.py)::([\w:[\]-]+)(?: - (.+))?$/,
    tool: "pytest", cls: "unit_test", language: "python",
    pick: (m) => ({ file: m[1], code: "pytest", message: `${m[2]}${m[3] ? ` — ${m[3]}` : ""}` }),
  },
  {
    re: /^(?:E\s+)?(AssertionError|AttributeError|TypeError|KeyError|ValueError|NameError)(?::\s*(.*))?$/,
    tool: "python", cls: "unit_test", language: "python",
    pick: (m) => ({ code: m[1], message: m[2] || m[1] }),
  },
  // ---------------- Go
  {
    re: /^(?:#\s+\S+\s*)?\.?\/?([\w./-]+\.go):(\d+):\d+: (.+)$/,
    tool: "go", cls: "compile", language: "go",
    pick: (m) => ({ file: m[1], line: +m[2], code: goCode(m[3]), message: m[3] }),
  },
  {
    re: /^\s*--- FAIL: (\S+)/,
    tool: "go test", cls: "unit_test", language: "go",
    pick: (m) => ({ code: "go-test", message: `${m[1]} failed` }),
  },
  {
    re: /^\s+([\w./-]+_test\.go):(\d+): (.+)$/,
    tool: "go test", cls: "unit_test", language: "go",
    pick: (m) => ({ file: m[1], line: +m[2], code: "go-test", message: m[3] }),
  },
  // ---------------- Rust
  {
    re: /^error\[(E\d{4})\]: (.+)$/,
    tool: "rustc", cls: "compile", language: "rust",
    pick: (m) => ({ code: m[1], message: m[2] }),
  },
  {
    re: /^error: (expected .+|unexpected .+|mismatched closing delimiter.*)$/,
    tool: "rustc", cls: "syntax", language: "rust",
    pick: (m) => ({ code: "rust-syntax", message: m[1] }),
  },
  {
    re: /thread '([^']+)' panicked at (?:'(.+)', )?([\w./-]+\.rs):(\d+)/,
    tool: "cargo test", cls: "unit_test", language: "rust",
    pick: (m) => ({ file: m[3], line: +m[4], code: "panic", message: `${m[1]}: ${m[2] ?? "panicked"}` }),
  },
  {
    re: /failed to select a version for (?:the requirement )?`([^`]+)`/,
    tool: "cargo", cls: "dependency", language: "rust",
    pick: (m) => ({ code: "cargo-resolve", message: `failed to select a version for ${m[1]}` }),
  },
  // ---------------- JavaScript test runners
  {
    re: /^\s*(AssertionError) \[ERR_ASSERTION\]: (.+)$/,
    tool: "node:test", cls: "unit_test", language: "javascript",
    pick: (m) => ({ code: m[1], message: m[2] }),
  },
  {
    re: /^not ok \d+ - (.+)$/,
    tool: "node:test", cls: "unit_test", language: "javascript",
    pick: (m) => ({ code: "test", message: `${m[1]} failed` }),
  },
  {
    re: /^\s*●\s+(.+? › .+)$/,
    tool: "jest", cls: "unit_test", language: "javascript",
    pick: (m) => ({ code: "jest", message: m[1] }),
  },
  {
    re: /^\s*(?:FAIL|×|✗)\s+([\w./@-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s+>\s+(.+))?/,
    tool: "vitest/jest", cls: "unit_test", language: "javascript",
    pick: (m) => ({ file: m[1], code: "test", message: m[2] ? m[2] : `${m[1]} failed` }),
  },
  {
    re: /^\s*(AssertionError|Error|TypeError|ReferenceError): (expected .+|.+ to (?:be|equal|deep equal|have|contain).+)$/,
    tool: "assert", cls: "unit_test", language: "javascript",
    pick: (m) => ({ code: m[1], message: m[2] }),
  },
  // ---------------- Package managers
  {
    re: /npm (?:ERR!|error) (?:code )?(ERESOLVE|E404|ETARGET|ENOVERSIONS)(.*)$/,
    tool: "npm", cls: "dependency", language: "javascript",
    pick: (m) => ({ code: m[1], message: m[2].trim() || m[1] }),
  },
  {
    re: /(ERR_PNPM_[A-Z_]+)\s*(.*)$/,
    tool: "pnpm", cls: "dependency", language: "javascript",
    pick: (m) => ({ code: m[1], message: m[2] || m[1] }),
  },
  {
    re: /Cannot find module '([^']+)'(?: or its corresponding type declarations)?/,
    tool: "node", cls: "dependency", language: "javascript",
    pick: (m) => ({ code: "MODULE_NOT_FOUND", message: `Cannot find module '${m[1]}'` }),
  },
  {
    re: /(No matching distribution found for \S+|ResolutionImpossible.*|Could not find a version that satisfies the requirement \S+)/,
    tool: "pip", cls: "dependency", language: "python",
    pick: (m) => ({ code: "pip-resolve", message: m[1] }),
  },
  // ---------------- JS syntax
  {
    re: /SyntaxError: (Unexpected token.*|Unexpected end of input.*|Invalid or unexpected token.*)/,
    tool: "node", cls: "syntax", language: "javascript",
    pick: (m) => ({ code: "SyntaxError", message: m[1] }),
  },
  // ---------------- Flaky signals
  {
    re: /(ECONNREFUSED|EADDRINUSE|ETIMEDOUT|ECONNRESET)\b(.*)$/,
    tool: "network", cls: "flaky", language: "any",
    pick: (m) => ({ code: m[1], message: `${m[1]}${m[2]}`.slice(0, 220) }),
  },
  {
    re: /(Exceeded timeout of \d+ ?ms|Timeout of \d+ms exceeded|test timed out after|deadline exceeded)/i,
    tool: "timeout", cls: "flaky", language: "any",
    pick: (m) => ({ code: "TIMEOUT", message: m[1] }),
  },
  // ---------------- Infra / interrupted
  {
    re: /(exit code 137|OOMKilled|Killed\s*$|The runner has received a shutdown signal|The operation was canceled|No space left on device|API rate limit exceeded)/,
    tool: "runner", cls: "infra", language: "any",
    pick: (m) => ({ code: "INFRA", message: m[1] }),
  },
];

function goCode(msg: string): string {
  if (/^undefined: /.test(msg)) return "go-undefined";
  if (/cannot use /.test(msg)) return "go-type-mismatch";
  if (/imported and not used/.test(msg)) return "go-unused-import";
  if (/not enough arguments|too many arguments/.test(msg)) return "go-arity";
  if (/syntax error/.test(msg)) return "go-syntax";
  return "go-compile";
}

/* -------------------------------------------------------------- hints */

type Hint = { match: RegExp; cause: string; fixes: string[] };

const HINTS: Hint[] = [
  { match: /^TS2305$|^TS2724$/, cause: "A named export was removed or renamed in the module being imported. The import site still references the old name.", fixes: ["Update the import to the new export name", "Re-export the old name from the module as a deprecated alias", "Check the changelog of the package if the module is a dependency"] },
  { match: /^TS2307$|^MODULE_NOT_FOUND$/, cause: "A module path cannot be resolved: a file was moved, a package was removed from dependencies, or a type package is missing.", fixes: ["Fix the import path to the moved file", "Add the missing package (or its @types/ package) to dependencies", "Check tsconfig paths / moduleResolution"] },
  { match: /^TS2322$|^TS2345$|^go-type-mismatch$|^E0308$/, cause: "A value no longer matches the type expected at its destination. Usually a signature was narrowed or a union was changed upstream of the call site.", fixes: ["Adjust the call site to produce the narrower type", "Widen the declared parameter type if the narrowing was unintended", "Add an explicit conversion with a guard"] },
  { match: /^TS2339$|^E0599$|^AttributeError$/, cause: "A property or method is accessed that no longer exists on the type — typically a rename in a dependency or a refactor that missed a caller.", fixes: ["Rename the access to the new member", "Restore the member on the type", "Pin the dependency if the removal was a breaking upgrade"] },
  { match: /^TS2554$|^go-arity$|^E0061$/, cause: "A function is called with the wrong number of arguments; its signature changed and at least one caller was not updated.", fixes: ["Update every call site to the new signature", "Give the new parameter a default value"] },
  { match: /^TS18048$|^TS2532$|^TS18047$/, cause: "A value that may be undefined/null is used without a guard — commonly after enabling strictNullChecks or after a function started returning an optional.", fixes: ["Add a guard or early return", "Use optional chaining with an explicit fallback", "Tighten the producer to never return undefined"] },
  { match: /^TS1005$|^SyntaxError$|^IndentationError$|^go-syntax$|^rust-syntax$/, cause: "The file does not parse. This is almost always a bad merge resolution or an incomplete edit.", fixes: ["Inspect the reported line and the previous one for a dropped bracket or quote", "Re-run the merge for the affected file"] },
  { match: /^ModuleNotFoundError$|^ImportError$/, cause: "A Python import fails: the package is missing from the environment or a symbol moved between modules (common after a major upgrade, e.g. pydantic v2 → pydantic-settings).", fixes: ["Add the missing distribution to requirements/pyproject", "Import the symbol from its new module", "Pin the previous major version"] },
  { match: /^ERESOLVE$|^ETARGET$|^ERR_PNPM_|^pip-resolve$|^cargo-resolve$/, cause: "Dependency resolution failed: two packages require incompatible versions, or a requested version does not exist.", fixes: ["Align the conflicting peer dependency ranges", "Revert the last dependency bump", "Regenerate the lockfile from a clean state"] },
  { match: /^go-undefined$|^E0425$|^E0432$|^E0433$|^NameError$/, cause: "A symbol is referenced that is not defined in scope — a rename, a removed declaration, or a missing import.", fixes: ["Import or declare the symbol", "Update the reference to the renamed symbol"] },
  { match: /^go-unused-import$/, cause: "Go refuses to compile with unused imports; a refactor removed the last use of a package.", fixes: ["Remove the unused import"] },
  { match: /^AssertionError$|^pytest$|^jest$|^test$|^go-test$|^panic$/, cause: "A test assertion fails deterministically. Either the behaviour under test regressed or the expectation is out of date with an intentional change.", fixes: ["Reproduce locally with the failing command", "Decide whether code or expectation is wrong before editing either", "Add a regression test that pins the intended behaviour"] },
  { match: /^ECONN|^EADDRINUSE$|^ETIMEDOUT$|^TIMEOUT$/, cause: "The failure depends on timing or the network: port collisions, unready services or a slow fixture. Treat as flaky until reproduced deterministically.", fixes: ["Use ephemeral ports (port 0) instead of fixed ports", "Wait on readiness, not on sleep", "Freeze the clock or seed randomness in the fixture"] },
  { match: /^INFRA$/, cause: "The job was interrupted by the environment (memory, disk, cancellation or rate limiting), not by your code.", fixes: ["Re-run the job", "Increase runner resources or split the job", "Cache dependencies to reduce API calls"] },
];

/* ------------------------------------------------------------ helpers */

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const TS_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;

export function cleanLines(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(ANSI, "").replace(TS_PREFIX, ""));
}

const NOISE_PATH = /(node_modules|site-packages|dist-packages|\/usr\/lib|\/rustc\/|<frozen|node:internal|\/go\/pkg\/mod|\.cargo\/registry|internal\/process)/;

function normalisePath(p: string): string {
  return p
    .replace(/^file:\/\//, "")
    .replace(/^.*?\/(?:work|workspace|runner\/work)\/[^/]+\/[^/]+\//, "")
    .replace(/^\/home\/[^/]+\/[^/]+\//, "")
    .replace(/^\.\//, "");
}

/** Strip volatile literals so the same defect hashes identically across runs. */
export function redact(s: string): string {
  return s
    .replace(/\b[0-9a-f]{7,64}\b/gi, "<hex>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/0x[0-9a-f]+/gi, "<addr>")
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<ts>")
    .replace(/(?:\/tmp|\/var\/folders)\/[\w./-]+/g, "<tmp>")
    .replace(/:\d{2,5}\b/g, ":<port>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds)\b/g, "<dur>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

function findFailingCommand(lines: string[]): { command: string | null; step: string | null; exitCode: number | null } {
  let current: string[] | null = null;
  let lastCommand: string | null = null;
  let lastStep: string | null = null;
  let inGroup = false;
  let exitCode: number | null = null;
  let failedCommand: string | null = null;
  let failedStep: string | null = null;

  for (const line of lines) {
    const g = line.match(/^##\[group\]Run (.+)$/);
    if (g) {
      current = [g[1]];
      inGroup = true;
      lastStep = g[1].slice(0, 120);
      continue;
    }
    if (inGroup && line.startsWith("##[endgroup]")) {
      inGroup = false;
      if (current) lastCommand = current.join("\n").trim();
      continue;
    }
    if (inGroup && current && !/^\s*(shell|env):|^\s{2}[A-Z_]+:/.test(line)) {
      const t = line.trim();
      // GitHub echoes the command body right after the group header — skip duplicates.
      if (current.length < 8 && t && !current.includes(t)) current.push(t);
      continue;
    }
    const e = line.match(/##\[error\]Process completed with exit code (\d+)/);
    if (e && failedCommand === null) {
      exitCode = +e[1];
      failedCommand = lastCommand;
      failedStep = lastStep;
    }
  }

  if (!failedCommand) {
    // plain terminal logs: "$ cmd" / "> pkg@1.0.0 test" + "> vitest run"
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const dollar = l.match(/^\$ (.+)$/);
      if (dollar) { failedCommand = dollar[1].trim(); break; }
      const npm = l.match(/^> (?!\S+@\S+ )(.+)$/);
      if (npm) { failedCommand = npm[1].trim(); break; }
    }
    const npmCmd = lines.find((l) => /npm (?:ERR!|error) command/.test(l));
    if (!failedCommand && npmCmd) failedCommand = npmCmd.replace(/.*command\s+/, "").trim();
  }

  // Keep only the effective first line of multi-line shell blocks if it is a known runner
  if (failedCommand) failedCommand = failedCommand.split("\n").filter(Boolean).slice(0, 4).join(" && ");
  return { command: failedCommand, step: failedStep, exitCode };
}

function extractFrames(lines: string[]): Frame[] {
  const frames: Frame[] = [];
  for (const l of lines) {
    let m = l.match(/File "([^"]+)", line (\d+), in (\S+)/);
    if (m) { frames.push({ file: normalisePath(m[1]), line: +m[2], fn: m[3] }); continue; }
    m = l.match(/^\s+at (?:(\S+) \()?([^()\s]+?):(\d+):\d+\)?$/);
    if (m) { frames.push({ file: normalisePath(m[2]), line: +m[3], fn: m[1] ?? null }); continue; }
    m = l.match(/^\s+-->\s+([\w./-]+\.rs):(\d+):\d+/);
    if (m) { frames.push({ file: normalisePath(m[1]), line: +m[2], fn: null }); continue; }
    m = l.match(/^\s+([\w./-]+\.go):(\d+)\s/);
    if (m) frames.push({ file: normalisePath(m[1]), line: +m[2], fn: null });
  }
  return frames.filter((f) => !NOISE_PATH.test(f.file));
}

/* --------------------------------------------------------------- main */

export function analyzeLog(raw: string): Analysis {
  const bytes = Buffer.byteLength(raw);
  const lines = cleanLines(raw.length > 2_000_000 ? raw.slice(-2_000_000) : raw);
  const errors: LogError[] = [];

  lines.forEach((line, idx) => {
    const text = line.replace(/^##\[error\]/, "").trimEnd();
    if (!text) return;
    for (const rule of RULES) {
      const m = text.match(rule.re);
      if (!m) continue;
      const p = rule.pick(m);
      const file = p.file ? normalisePath(p.file) : null;
      if (file && NOISE_PATH.test(file)) break;
      errors.push({
        tool: rule.tool,
        cls: rule.cls,
        language: rule.language,
        code: p.code ?? null,
        message: p.message.trim().slice(0, 400),
        file,
        line: p.line ?? null,
        lineIndex: idx,
      });
      break;
    }
  });

  // Rust: attach " --> file:line" to preceding error[Exxxx]
  for (const e of errors) {
    if (e.tool === "rustc" && !e.file) {
      for (let j = e.lineIndex + 1; j < Math.min(lines.length, e.lineIndex + 6); j++) {
        const m = lines[j].match(/-->\s+([\w./-]+\.rs):(\d+)/);
        if (m) { e.file = normalisePath(m[1]); e.line = +m[2]; break; }
      }
    }
  }

  const frames = extractFrames(lines);
  const { command, step, exitCode } = findFailingCommand(lines);

  // Score classes. Compile/syntax errors mask tests, so they win ties.
  const weight: Record<FailureClassKey, number> = { compile: 0, dependency: 0, syntax: 0, unit_test: 0, flaky: 0, infra: 0, unknown: 0 };
  const priority: Record<FailureClassKey, number> = { syntax: 1.5, dependency: 1.4, compile: 1.3, infra: 1.2, unit_test: 1, flaky: 0.6, unknown: 0 };
  for (const e of errors) weight[e.cls] += priority[e.cls];
  if (exitCode === 137) weight.infra += 5;

  const ranked = (Object.keys(weight) as FailureClassKey[]).sort((a, b) => weight[b] - weight[a]);
  const best = weight[ranked[0]];
  let failureClass: FailureClassKey = best > 0 ? ranked[0] : "unknown";
  // Flakiness vs determinism: a real assertion (Expected/Received, AssertionError) means
  // deterministic; flaky signals without one mean we must NOT attempt a code repair.
  const hasAssertion =
    errors.some((e) => e.cls === "unit_test" && /assert|expect|panic|go-test|pytest/i.test(`${e.code} ${e.message}`)) ||
    lines.some((l, i) => /^\s*Expected:/.test(l) && /^\s*Received:/.test(lines[i + 1] ?? ""));
  const flakySignals = errors.filter((e) => e.cls === "flaky").length;
  if (failureClass === "flaky" && hasAssertion && flakySignals < 2) failureClass = "unit_test";
  if (failureClass === "unit_test" && flakySignals > 0 && !hasAssertion) failureClass = "flaky";

  const total = Object.values(weight).reduce((a, b) => a + b, 0);
  const confidence = total === 0 ? 0.1 : Math.min(0.97, 0.35 + (best / total) * 0.55 + Math.min(errors.length, 6) * 0.015);

  const primary =
    errors.find((e) => e.cls === failureClass && e.file) ??
    errors.find((e) => e.cls === failureClass) ??
    errors[0] ??
    null;

  const language =
    primary?.language && primary.language !== "any"
      ? primary.language
      : errors.find((e) => e.language !== "any")?.language ?? "unknown";

  // Localisation: file refs from errors + frames, ranked by frequency & earliness
  const scores = new Map<string, { file: string; line: number | null; hits: number; score: number }>();
  const bump = (file: string | null, line: number | null, w: number) => {
    if (!file || NOISE_PATH.test(file)) return;
    const cur = scores.get(file) ?? { file, line, hits: 0, score: 0 };
    cur.hits += 1;
    cur.score += w;
    if (cur.line === null && line !== null) cur.line = line;
    scores.set(file, cur);
  };
  errors.forEach((e, i) => bump(e.file, e.line, (e.cls === failureClass ? 3 : 1) / (1 + i * 0.15)));
  frames.slice(0, 12).forEach((f, i) => bump(f.file, f.line, 1.5 / (1 + i * 0.3)));
  const localised = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => ({ ...x, score: Math.round(x.score * 100) / 100 }));

  // Fingerprint
  const topFrames = frames.slice(0, 3).map((f) => `${f.file.split("/").pop()}:${f.fn ?? "?"}`);
  const fpParts = [
    failureClass,
    primary?.code ?? "none",
    redact(primary?.message ?? lines.filter(Boolean).slice(-3).join(" ")).slice(0, 240),
    primary?.file ? primary.file.split("/").slice(-2).join("/") : "",
    ...topFrames,
  ];
  const fingerprintInput = fpParts.join("\n");
  const fingerprint = "sha256:" + createHash("sha256").update(fingerprintInput).digest("hex");
  const cluster = [
    language,
    (primary?.file ?? "global").split("/").slice(-2, -1)[0] ?? "root",
    (primary?.code ?? failureClass).toLowerCase(),
  ].join("/");

  const hint = HINTS.find((h) => primary?.code && h.match.test(primary.code));
  const rootCauseHint = hint
    ? `${hint.cause}${primary?.file ? ` First reported at ${primary.file}${primary.line ? `:${primary.line}` : ""}.` : ""}`
    : primary
      ? `The first decisive error is “${primary.message}”. No catalogued mechanism matches it; treat the localised files as the starting point.`
      : "No recognisable error signature was found. The log may be truncated, or the failure is in a step whose tool output is not parsed yet.";

  let escalationReason: string | null = null;
  if (!REPAIRABLE.includes(failureClass)) {
    escalationReason =
      failureClass === "flaky"
        ? "Timing/network signals dominate. Aegis Forge will not patch a failure it cannot reproduce deterministically."
        : failureClass === "infra"
          ? "The environment interrupted the job. Re-run before repairing code."
          : "Failure could not be classified with enough confidence to attempt a repair.";
  } else if (!command) {
    escalationReason = "Failing command could not be recovered from the log, so the failure cannot be reproduced.";
  }

  // Excerpt: window around the first decisive error
  const anchor = primary?.lineIndex ?? Math.max(0, lines.length - 30);
  const excerpt = lines
    .slice(Math.max(0, anchor - 8), Math.min(lines.length, anchor + 22))
    .filter((l) => !/^##\[(?:group|endgroup)\]/.test(l))
    .join("\n")
    .slice(0, 6000);

  return {
    failureClass,
    classLabel: CLASS_LABELS[failureClass],
    language,
    confidence: Math.round(confidence * 100) / 100,
    repairable: escalationReason === null,
    escalationReason,
    failingCommand: command,
    failingStep: step,
    exitCode,
    primaryError: primary,
    errors: errors.slice(0, 25),
    frames: frames.slice(0, 12),
    localised,
    fingerprint,
    fingerprintInput,
    cluster,
    rootCauseHint,
    fixStrategies: hint?.fixes ?? [],
    excerpt,
    stats: { lines: lines.length, errorLines: errors.length, bytes },
  };
}
