#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Tamilselvan <https://github.com/tamilselvan04200803-max>
/* Utility to inspect and verify Aegis Forge DSSE proof bundles */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEnvelope } from "../src/lib/forge/crypto.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [, , bundlePath, keyPath] = process.argv;

if (!bundlePath) {
  console.error("Usage: node scripts/verify-bundle.mjs <bundle.json> [public-key.pem]");
  process.exit(1);
}

const rawBundle = fs.readFileSync(path.resolve(bundlePath), "utf8");
const envelope = JSON.parse(rawBundle);

const defaultKey = path.resolve(__dirname, "../examples/proof-bundles/aegis-sample-pub.pem");
const keyToUse = keyPath ? path.resolve(keyPath) : defaultKey;

if (!fs.existsSync(keyToUse)) {
  console.error(`Public key not found at: ${keyToUse}`);
  process.exit(1);
}

const publicPem = fs.readFileSync(keyToUse, "utf8");
const result = verifyEnvelope(envelope, publicPem);

console.log("----------------------------------------------------");
console.log("  Aegis Forge DSSE In-Toto Attestation Inspector    ");
console.log("----------------------------------------------------");

if (result.ok) {
  console.log(`Status:              \x1b[32mVALID\x1b[0m`);
  console.log(`Key ID:              ${result.keyid}`);
  console.log(`Digest Matches:      ${result.subjectDigestMatches ? "YES" : "NO"}`);
  if (result.statement) {
    const pred = result.statement.predicate;
    console.log(`Statement Type:      ${result.statement._type}`);
    console.log(`Predicate Type:      ${result.statement.predicateType}`);
    if (pred?.bundle) {
      console.log(`Run ID:              ${pred.bundle.run_id}`);
      console.log(`Repository:          ${pred.bundle.repository}`);
      console.log(`Failure Class:       ${pred.bundle.failure_class}`);
      console.log(`Failing Command:     ${pred.bundle.failing_command}`);
      console.log(`Risk Score:          ${pred.bundle.risk_score}`);
    }
    console.log(`Verification:        ${pred?.verificationResult ?? "UNKNOWN"}`);
    console.log(`Verified At:         ${pred?.timeVerified ?? "UNKNOWN"}`);
  }
  process.exit(0);
} else {
  console.error(`Status:              \x1b[31mINVALID\x1b[0m`);
  console.error(`Reason:              ${result.reason}`);
  process.exit(2);
}
