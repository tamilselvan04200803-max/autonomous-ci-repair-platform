#!/usr/bin/env node
/* Aegis Bench: Automated benchmark harness for Aegis Forge */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeLog } from "../src/lib/forge/analyze.ts";
import { evaluatePolicy, parseUnifiedDiff, scoreRisk } from "../src/lib/forge/policy.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUITES_DIR = path.join(__dirname, "suites");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
};

console.log(`${c.bold}${c.cyan}====================================================${c.reset}`);
console.log(`${c.bold}  AEGIS BENCH: AUTONOMOUS CI REPAIR BENCHMARK HARNESS${c.reset}`);
console.log(`${c.bold}${c.cyan}====================================================${c.reset}\n`);

let passed = 0;
let total = 0;
const results = [];

function loadCases(dir) {
  let cases = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cases = cases.concat(loadCases(fullPath));
    } else if (entry.name.endsWith(".json")) {
      cases.push(JSON.parse(fs.readFileSync(fullPath, "utf8")));
    }
  }
  return cases;
}

const testCases = loadCases(SUITES_DIR);

for (const tc of testCases) {
  total++;
  let ok = true;
  let reason = "";

  if (tc.rawLog) {
    const analysis = analyzeLog(tc.rawLog);

    if (tc.expected.failureClass && analysis.failureClass !== tc.expected.failureClass) {
      ok = false;
      reason += `expected failureClass=${tc.expected.failureClass}, got ${analysis.failureClass}; `;
    }

    if (tc.expected.repairable !== undefined && analysis.repairable !== tc.expected.repairable) {
      ok = false;
      reason += `expected repairable=${tc.expected.repairable}, got ${analysis.repairable}; `;
    }

    if (tc.expected.failingCommand && analysis.failingCommand !== tc.expected.failingCommand) {
      ok = false;
      reason += `expected failingCommand="${tc.expected.failingCommand}", got "${analysis.failingCommand}"; `;
    }

    if (tc.expected.primaryFile && analysis.localised[0]?.file !== tc.expected.primaryFile) {
      ok = false;
      reason += `expected primaryFile="${tc.expected.primaryFile}", got "${analysis.localised[0]?.file}"; `;
    }
  } else if (tc.candidatePatch) {
    const diff = parseUnifiedDiff(tc.candidatePatch);
    const risk = scoreRisk({ diff, localised: [], rawDiff: tc.candidatePatch });
    const policy = evaluatePolicy({ risk, provenRed: true, provenGreen: true, reproduced: true });

    if (tc.expected.policyAllowed !== undefined && policy.allow !== tc.expected.policyAllowed) {
      ok = false;
      reason += `expected policy allow=${tc.expected.policyAllowed}, got ${policy.allow} (${policy.deny.join(", ")}); `;
    }
  }

  if (ok) passed++;
  results.push({ id: tc.id, name: tc.name, category: tc.category, ok, reason });
}

for (const r of results) {
  const icon = r.ok ? `${c.green}✓ PASS${c.reset}` : `${c.red}✗ FAIL${c.reset}`;
  console.log(`  ${icon} [${r.category}] ${r.id.padEnd(14)} ${r.name}`);
  if (!r.ok) {
    console.log(`         ${c.red}→ Failure: ${r.reason}${c.reset}`);
  }
}

const scorePct = Math.round((passed / total) * 100);
console.log(`\n${c.bold}Benchmark Summary:${c.reset} ${passed}/${total} test cases passed (${scorePct}% accuracy)`);

if (passed === total) {
  console.log(`${c.green}${c.bold}All Aegis Bench invariants satisfied!${c.reset}\n`);
  process.exit(0);
} else {
  console.error(`${c.red}${c.bold}Benchmark failures detected.${c.reset}\n`);
  process.exit(1);
}
