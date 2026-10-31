# Aegis Forge Developer Scripts

This directory contains automation utilities, simulation harnesses, and test scripts used for local development, CI verification, and diagnostic inspection.

---

## Scripts Catalog

| Script | Runtime | Purpose |
|---|---|---|
| `e2e-local.sh` | Bash | Simulates the complete end-to-end autonomous repair loop locally (creates throwaway git repo, injects bug, tests red-to-green verification, tests DSSE tamper detection). |
| `verify-bundle.mjs` | Node / tsx | Inspects and verifies any DSSE in-toto proof bundle JSON against an Ed25519 public key. |
| `generate-sample-bundle.mjs` | Node | Generates fresh, cryptographically authentic sample bundles and keypairs for testing. |

---

## Usage Examples

### 1. Run Local End-to-End Simulation
Requires Bash, Git, and running local PostgreSQL database:
```bash
./scripts/e2e-local.sh
```

### 2. Inspect and Verify Proof Bundle
```bash
npx tsx scripts/verify-bundle.mjs examples/proof-bundles/sample-signed-bundle.json
```

### 3. Generate New Sample Key & Bundle
```bash
node scripts/generate-sample-bundle.mjs
```
