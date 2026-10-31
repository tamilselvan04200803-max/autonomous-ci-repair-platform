# Cryptographic Proof Bundles

Aegis Forge generates cryptographically signed attestations for every verified repair run. Every proof bundle is formatted as an **in-toto Statement v1** encapsulated in a **Dead Simple Signing Envelope (DSSE v1)** with **Ed25519** signatures and **Pre-Authentication Encoding (PAE)**.

---

## Contents of This Directory

- `sample-signed-bundle.json`: A complete DSSE proof bundle containing the in-toto v1 statement, failure fingerprints, test execution proofs, and sandbox metadata for specimen repair run `AF-04-1187`.
- `aegis-sample-pub.pem`: The Ed25519 public key used to verify `sample-signed-bundle.json`.

---

## Verifying Offline (Zero Dependencies)

You can verify the authenticity and integrity of this bundle offline using the zero-dependency runner:

```bash
node runner/aegis.mjs verify-bundle examples/proof-bundles/sample-signed-bundle.json --key examples/proof-bundles/aegis-sample-pub.pem
```

Expected output:
```text
✓ signature valid (aegis-ed25519-...)
✓ subject sha256:... matches bundle
  run:          AF-04-1187 (aegis-forge/specimen)
  result:       PASSED
  verified at:  2026-03-04T11:45:47Z
```

### Tamper-Detection Demonstration

If any byte in the envelope or payload is modified, the Ed25519 signature verification fails immediately with exit code 2:

```bash
# Verify tamper detection
node -e "
  const fs = require('fs');
  const b = JSON.parse(fs.readFileSync('examples/proof-bundles/sample-signed-bundle.json', 'utf8'));
  b.payload = Buffer.from(Buffer.from(b.payload, 'base64').toString().replace('AF-04-1187', 'TAMPERED')).toString('base64');
  fs.writeFileSync('tampered.json', JSON.stringify(b));
"
node runner/aegis.mjs verify-bundle tampered.json --key examples/proof-bundles/aegis-sample-pub.pem
# Result: [aegis] ✗ signature INVALID
```
