# Aegis Forge REST API Reference

The Aegis Forge control plane exposes a strictly typed, JSON-first REST API for log analysis, webhook ingestion, runner coordination, proof bundle distribution, and cryptographic verification.

---

## Authentication Schemes

- **Public**: Accessible without credentials (read-only telemetry, stateless log analysis, proof bundle downloads, public key distribution).
- **HMAC Signature (`X-Hub-Signature-256`)**: Webhook requests signed with the shared GitHub App webhook secret (`GITHUB_WEBHOOK_SECRET`). Constant-time comparison ensures zero timing leakage.
- **Admin Bearer Token (`FORGE_ADMIN_TOKEN`)**: Administrative operations (opening manual repair runs, proposing patches, reporting external upstream verdicts).
- **Runner Bearer Token (`AEGIS_RUNNER_SECRET` / `FORGE_RUNNER_SECRET`)**: Ephemeral CI runner communication (fetching jobs, posting verification results).

---

## Endpoint Specification

### 1. System Health & Public Keys

#### `GET /api/health`
Liveness probe and database connectivity health check.
* **Auth**: Public
* **Response**: `200 OK`
```json
{
  "status": "healthy",
  "version": "0.5.0",
  "database": "connected",
  "timestamp": "2026-10-31T12:00:00.000Z"
}
```

#### `GET /api/keys`
Exports the platform's active Ed25519 public verification key.
* **Auth**: Public
* **Query Parameters**: `format` (`pem` or `json`, default `json`).
* **Response**: `200 OK`
```json
{
  "keyid": "aegis-ed25519-48c7afa70f508bbb",
  "algorithm": "ed25519",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..."
}
```

---

### 2. Log Analysis & Ingress

#### `POST /api/analyze`
Stateless failure log classifier and diagnostic engine. Accepts `text/plain` or JSON bodies.
* **Auth**: Public
* **Request**:
```json
{
  "log": "##[group]Run tsc\nsrc/index.ts(1,1): error TS2305: Module not found\n##[error]Process completed with exit code 2."
}
```
* **Response**: `200 OK`
```json
{
  "analysis": {
    "failureClass": "compile",
    "classLabel": "Compiler error",
    "language": "typescript",
    "failingCommand": "tsc",
    "fingerprint": "fp_ts2305_module_not_found_a9b1c",
    "repairable": true,
    "confidence": 0.95,
    "localised": [{ "file": "src/index.ts", "line": 1 }],
    "rootCauseHint": "Named export is missing from target module.",
    "fixStrategies": ["Export missing identifier or update import specifier"]
  },
  "ms": 12
}
```

#### `POST /api/webhooks/github`
Receives GitHub `workflow_run` completion webhooks.
* **Auth**: HMAC-SHA256 (`X-Hub-Signature-256`)
* **Response**: `202 Accepted`

---

### 3. Repair Runs & Verification

#### `GET /api/runs`
Lists and paginates repair runs from the ledger.
* **Auth**: Public
* **Query Parameters**:
  * `limit` (optional, default `100`, max `500`)
  * `offset` (optional, default `0`)
* **Response**: `200 OK`

#### `GET /api/runs/:id/bundle`
Downloads the cryptographically signed DSSE in-toto proof bundle for a repair run.
* **Auth**: Public
* **Response**: `200 OK` (Content-Type: `application/vnd.in-toto+json`)

#### `POST /api/attestations/verify`
Server-side cryptographic verification of any DSSE proof envelope.
* **Auth**: Public
* **Request**: Complete DSSE JSON object
* **Response**: `200 OK`
```json
{
  "ok": true,
  "reason": "Signature valid",
  "keyid": "aegis-ed25519-48c7afa70f508bbb",
  "subjectDigestMatches": true
}
```
