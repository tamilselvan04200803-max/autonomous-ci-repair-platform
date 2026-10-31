# Aegis Forge Test Suite

This directory contains the automated test suites for Aegis Forge's core domain engine: log analysis, failure classification, cryptographic signing, risk scoring, and release policy enforcement.

---

## Test Execution

Run the complete test suite:

```bash
npm test
```

Run in watch mode during development:

```bash
npm run test:watch
```

Run end-to-end integration loop:

```bash
npm run test:e2e
```

---

## Invariants Tested

- **Deterministic Failure Classification**: Accurately classifies failure logs into compiler, dependency, unit test, and flaky categories.
- **Fail-Closed Flaky Refusal**: Asserts that flaky runs are never marked repairable and are always escalated.
- **Command Recovery**: Confirms extraction of failing shell commands without duplicated runner echoes.
- **Fault Localization Bounds**: Ensures localized files point to project source files rather than system runtimes or third-party packages.
- **Fingerprint Stability**: Validates that timestamps, runner process IDs, and memory addresses are redacted so identical failures produce identical fingerprints.
- **Webhook Signature Precision**: Asserts exact HMAC-SHA256 signature validation with zero whitespace tolerance.
- **Cryptographic Envelope Round-Trip**: Verifies Ed25519 DSSE Pre-Authentication Encoding (PAE) and immediate rejection of tampered payloads.
- **Policy Invariant Enforcement**: Confirms denial of patches touching sensitive paths, deleting tests, or failing the red-to-green proof requirement.
