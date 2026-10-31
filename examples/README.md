# Aegis Forge Integration Examples

This directory provides concrete reference examples, test specimens, and failure logs for evaluating, integrating, and testing Aegis Forge without needing live production infrastructure.

---

## Directory Overview

- **`failure-logs/`**: Raw CI execution logs captured from real failures across various runtimes (TypeScript compiler errors, Python Pydantic migrations, Jest test failures, Rust import errors, flaky port conflicts, Go signature mismatches). Use these to test `/api/analyze` or `node runner/aegis.mjs analyze`.
- **`proof-bundles/`**: Ready-to-verify DSSE in-toto proof bundles signed with Ed25519, alongside their public verification keys.
- **`workflows/`**: Production GitHub Actions caller workflows demonstrating repository integration.

---

## Quick Experiments

### 1. Test Deterministic Log Analysis Offline
```bash
# Analyze a raw TypeScript failure log
node runner/aegis.mjs analyze examples/failure-logs/ts-renamed-export.log
```

### 2. Verify an Authentic Signed Proof Bundle Offline
```bash
# Verify DSSE envelope and subject hash
node runner/aegis.mjs verify-bundle examples/proof-bundles/sample-signed-bundle.json --key examples/proof-bundles/aegis-sample-pub.pem
```
