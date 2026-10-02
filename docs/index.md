# Aegis Forge Documentation

> **Evidence-Gated, Crash-Resilient Autonomous Software-Repair Platform**  
> Converts CI/CD test and build failures into cryptographically verified draft pull requests backed by in-toto DSSE proof bundles.

---

## Welcome to Aegis Forge

Most AI coding assistants and bots generate "plausible" fixes directly from CI logs and immediately open pull requests or ask humans to review code that was never tested. This floods repositories with hallucinated fixes, subtle regressions, and creates fatigue for maintainers.

**Aegis Forge is built on a different premise:**
> **Nothing is published without cryptographic and empirical proof.**

Before any code is ever proposed to a human maintainer, Aegis Forge requires:
1. **Deterministic Log Analysis**: Root cause identification with AST-level line and file localisation without invoking an LLM.
2. **Deterministic Reproduction**: The failure must be reproduced identically in an isolated sandbox.
3. **Red-to-Green Transition**: A dedicated regression test must fail (red) before the patch and pass (green) after the patch.
4. **Zero Collateral Damage**: All existing test suites and extra checks must pass with zero new warnings.
5. **Static Policy Enforcement**: The patch must not touch sensitive files (`.github/`, auth, crypto, DB migrations, Dockerfiles) and must not delete tests.
6. **Cryptographic Proof Bundle**: The verification results, sandbox telemetry, and diff are packaged into an in-toto v1 Statement and signed with Ed25519 DSSE envelopes.
7. **Draft PR Only**: Publication is always a draft pull request. Aegis Forge never merges its own work.

---

## Documentation Structure

| Guide | Description |
| :--- | :--- |
| **[Getting Started](./getting-started.md)** | Step-by-step setup guide for local development, docker-compose, and GitHub App registration. |
| **[Architecture](./architecture.md)** | Deep dive into the 16-stage repair pipeline, sandboxing model, active core vs planned enterprise stack. |
| **[Deployment Guide](./deployment.md)** | Production deployment configurations for Docker, Fly.io, AWS/GCP, reverse proxies, and database backups. |
| **[Architecture Decisions (ADRs)](./decisions/)** | Formal architectural decision records explaining *why* key security and engineering trade-offs were made. |

---

## Architecture Decision Records (ADRs)

- **[ADR-0001: Evidence Before Publication](./decisions/0001-evidence-before-publication.md)**  
  Why we refuse to publish any pull request without empirical reproduction and a red-to-green proof.
- **[ADR-0002: CI Runner as Sandbox](./decisions/0002-ci-runner-as-sandbox.md)**  
  Why untrusted repository code never runs on the control plane, utilizing ephemeral runner sandboxes.
- **[ADR-0003: Deterministic Analysis First](./decisions/0003-deterministic-analysis-first.md)**  
  Why failure classification, command extraction, and file localisation are deterministic before involving LLMs.
- **[ADR-0004: Signing Ed25519 Before Sigstore](./decisions/0004-signing-ed25519-before-sigstore.md)**  
  How in-toto DSSE envelopes with Ed25519 provide verifiable supply-chain attestation today with a path to Sigstore.

---

## Core Guarantees & Threat Model

| Risk | Mitigation |
| :--- | :--- |
| **Prompt Injection via CI Logs** | The LLM receives pre-tokenized, deterministic extracts. It has zero shell access and no tools. |
| **RCE on Control Plane** | The Next.js control plane executes no repository code. Code execution happens solely in the ephemeral runner. |
| **Unauthorized Runner Dispatches** | Every runner job is signed with an HMAC-SHA256 bearer token verified in constant time. |
| **Webhook Spoofing / Replay** | GitHub webhooks require HMAC-SHA256 signature verification and delivery IDs are guarded against replay. |
| **Malicious Test Deletion** | AST policy engine rejects any patch that removes test cases, alters test assertions, or touches sensitive paths. |
| **Tampered Proof Bundles** | Proof bundles are cryptographically signed using in-toto DSSE with Ed25519 and verified independently. |

---

## Contributing

We welcome contributions! Please read our **[Contributing Guide](../CONTRIBUTING.md)** and **[Security Policy](../SECURITY.md)** before opening issues or pull requests.
