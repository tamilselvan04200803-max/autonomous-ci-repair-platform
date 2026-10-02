# Security Policy

Aegis Forge generates and verifies code patches autonomously. Because code modification is inherently privileged, security is not a post-hoc audit item; every subsystem is designed from first principles to **fail closed**.

---

## Supported Versions

Only the latest minor release branch receives active security updates and vulnerability patches.

| Version | Supported | Security Maintenance |
| :--- | :---: | :--- |
| `0.5.x` | :white_check_mark: | Active support & critical patches |
| `< 0.5.0` | :x: | End of life |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities via public GitHub issues, discussions, or pull requests.**

To report a vulnerability responsibly:
1. Use **GitHub Private Security Advisories**: Navigate to the repository's **Security** tab and click **"Report a vulnerability"**.
2. Alternatively, email the maintainer directly at [tamilselvan04200803@gmail.com](mailto:tamilselvan04200803@gmail.com) with the subject `[SECURITY] Aegis Forge Vulnerability Report`.

### Disclosure Timeline
- **Initial Acknowledgement**: Within 48 hours of receipt.
- **Triage & Reproduction**: Within 5 business days.
- **Fix & Public Advisory**: Coordinated with the reporter, typically within 14 to 30 days depending on severity.

---

## Security Guarantees & Architectural Boundaries

Aegis Forge enforces the following defense-in-depth guarantees:

### 1. Control Plane Isolation
- **No LLM Shell Access**: The language model produces structured text proposals. It has zero shell access, zero tool access, and cannot invoke local binaries.
- **No Untrusted Code on Control Plane**: Repository source code is never executed on the Next.js control plane. Code execution is strictly quarantined to ephemeral runner sandboxes.

### 2. Runner & Dispatch Authentication
- **HMAC Job Signing**: Ephemeral runners verify HMAC-SHA256 signatures before executing any dispatched repair job. Unsigned or mismatched dispatches are rejected immediately.
- **Strict Input Sanitization**: Test paths and commands in `runner/aegis.mjs` are verified against path traversal attacks and shell metacharacter injection (`;&|`$()`).

### 3. Ingress & Webhook Protection
- **Raw Body HMAC Verification**: GitHub webhooks are verified over the raw byte buffer using constant-time comparison (`safeEqual` with pre-hashed SHA-256 digests to eliminate token length leakage).
- **Replay Defense**: Every `X-GitHub-Delivery` ID is recorded in PostgreSQL. Duplicate delivery attempts are rejected.

### 4. Static Policy Pre-Gating
- **Sensitive Path Denials**: The policy engine rejects patches modifying `.github/`, security modules, authentication, cryptographic routines, database migrations, or Dockerfiles.
- **Test Integrity**: The policy engine scans ASTs to reject patches that delete test cases, comment out assertions, or relax verification requirements.

### 5. Non-Destructive Publishing
- **Draft PRs Only**: Aegis Forge never merges pull requests automatically. Every published fix is a GitHub Draft Pull Request requiring explicit human code review and passing upstream CI checks.

### 6. Cryptographic Proof Attestation
- **in-toto DSSE Envelopes**: All verification telemetry, test outputs, and diff digests are sealed in Pre-Authentication Encoded (PAE) DSSE envelopes signed using Ed25519.
- **Offline Verifiability**: Anyone can verify an attestation bundle independently without connecting to the Aegis Forge server.

---

## Production Deployment Hardening Checklist

When deploying Aegis Forge to production:
1. Set a strong `FORGE_ADMIN_TOKEN` (min 32 characters). In production mode (`NODE_ENV=production`), admin endpoints reject unauthenticated calls.
2. Set `FORGE_RUNNER_SECRET` and share it only with authorized runner instances.
3. Configure `FORGE_SIGNING_KEY` via a hardware security module (HSM) or cloud secret manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault).
4. Terminate TLS with HSTS enabled and enforce HTTPS.
