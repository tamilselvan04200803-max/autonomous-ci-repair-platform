# Aegis Forge Architecture

This document details the architectural design, security boundaries, and pipeline execution flow of Aegis Forge.

---

## 1. System Overview

Aegis Forge separates the **Control Plane** (which analyzes failures, generates repair hypotheses, and orchestrates attestations) from the **Sandbox Runner** (which executes untrusted code, runs tests, and measures telemetry).

```
                      +---------------------------------------+
                      |          GitHub Workflow Run          |
                      |            (Failed CI Run)            |
                      +-------------------+-------------------+
                                          |
                                          v (Webhook / HMAC-SHA256)
+-----------------------------------------+-----------------------------------------+
|                               CONTROL PLANE (Next.js 15)                          |
|                                                                                   |
|   1. Ingress & Delivery Guard      2. Deterministic Log Analyser                  |
|      - Verify HMAC-SHA256             - Regex / AST Parser (TypeScript, Py, Go)   |
|      - Replay prevention              - Failure class & exact line extraction     |
|      - Idempotent Run Creation        - Sanitized fingerprint hashing             |
|                                                                                   |
|   3. Candidate Synthesizer         4. Policy Engine (Static Pre-Gate)             |
|      - Bounded LLM Prompt             - Path restriction (.github, auth, crypto)  |
|      - Red-to-green test harness      - AST test deletion detection               |
|      - Minimal diff generation        - Complexity & diff ceiling enforcement     |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v (Signed Runner Job Dispatch)
+-----------------------------------------+-----------------------------------------+
|                         EPHEMERAL RUNNER (Node 18+)                               |
|                                                                                   |
|   5. Isolation & Setup             6. 3x Failure Reproduction                     |
|      - Clean git checkout             - Runs failing command 3 times              |
|      - Zero network egress            - Confirms deterministic breakage           |
|                                                                                   |
|   7. Regression Harness Red Check  8. Candidate Patch Application                 |
|      - Executes new regression test   - Applies unified diff in workspace         |
|      - Verifies RED state             - Executes test: must turn GREEN            |
|                                                                                   |
|   9. Suite & Lint Verification     10. Telemetry & Execution Log Capture          |
|      - Full test suite passes         - Memory, duration, process exit codes      |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v (Authenticated Verification Callback)
+-----------------------------------------+-----------------------------------------+
|                       ATTESTATION ENGINE & PUBLICATION                            |
|                                                                                   |
|   11. Cryptographic Attestation    12. Draft PR Publication                       |
|       - in-toto Statement v1           - GitHub Check Run updated to completed    |
|       - DSSE PAE Envelope              - Creates isolated repair branch           |
|       - Ed25519 Digital Signature      - Opens Draft PR with embedded proof bundle|
+-----------------------------------------------------------------------------------+
```

---

## 2. Active Implementation vs Planned Enterprise Architecture

To maintain absolute transparency for users, contributors, and enterprise adopters, Aegis Forge clearly demarcates what is actively operational today versus the planned roadmap architecture.

### Active Core Implementation (Operational Today)
- **Control Plane**: Next.js 15, TypeScript, Node.js 20+ runtime.
- **Database & Persistence**: PostgreSQL 15+ with Drizzle ORM, tracking repair runs, stages, events, candidate patches, and cryptographic signing keys.
- **Log Analysis**: Purely deterministic multi-language log parser (`src/lib/forge/analyze.ts`) covering TypeScript, Python (traceback, pytest, mypy, pyright), Go, Rust, Jest, Vitest, and Node.js test runners.
- **Policy Enforcement**: AST and unified diff inspection forbidding changes to sensitive paths, test suite pruning, or excessive line churn.
- **Verification Runner**: `runner/aegis.mjs` — a portable, zero-dependency script executed inside GitHub Actions runners or container environments with HMAC-authenticated dispatches.
- **Attestation Engine**: in-toto v1 Statement specifications wrapped in DSSE (Pre-Authentication Encoding) envelopes and signed with Ed25519 keypairs.
- **Web UI & Developer Consoles**: Live reactive ledger at `/runs`, interactive log analyzer at `/analyze`, cryptographic proof bundle viewer at `/proof-bundle`, key management at `/api/keys`, and attestation verifier at `/verify`.

### Planned Enterprise Architecture (Roadmap)
- **Durable Orchestration**: Migration of pipeline orchestration to **Temporal.io** for distributed saga management, multi-hour timeouts, and resilient checkpointing.
- **MicroVM Sandboxes**: Integration with **Daytona** or **E2B** microVMs with kernel-level network isolation (Firecracker) to run arbitrary untrusted repository hooks with zero risk to the runner host.
- **Sigstore Keyless Attestation**: Full integration with Fulcio (OIDC identity) and Rekor (transparency log) for keyless, identity-anchored provenance signing.
- **Fine-Grained AST Patch Synthesis**: Multi-agent consensus generation using PydanticAI and structural AST transforms before string-level diff formatting.

---

## 3. The 16-Stage Repair Lifecycle

Each repair run traverses a strict state machine:

| Stage # | Stage Name | Description | Failure Behavior |
| :---: | :--- | :--- | :--- |
| **01** | `INGRESS` | Ingests GitHub `workflow_run` webhook or manual log upload. | Rejects unsigned or duplicate delivery IDs. |
| **02** | `ANALYSIS` | Extracts failing command, error class, error message, and source file. | Escalates to human if log contains unparseable or flaky patterns. |
| **03** | `FINGERPRINT` | Generates a normalized hash over the failure signature for deduplication. | Groups recurring failures to prevent redundant repair jobs. |
| **04** | `PROPOSAL` | LLM generates candidate patches with accompanying red-to-green test cases. | Escalates if candidate synthesis fails or exhausts retry budget. |
| **05** | `POLICY_PRE` | Static analysis verifies no forbidden files are touched and no tests deleted. | Rejects candidate immediately before dispatching to sandbox. |
| **06** | `DISPATCH` | Creates HMAC-signed job payload and dispatches to ephemeral runner. | Fails closed if runner secret is not configured. |
| **07** | `CHECKOUT` | Runner clones target repository at the exact failing commit SHA. | Aborts run if git checkout or tree is dirty. |
| **08** | `REPRODUCE` | Runner executes failing command 3 times to guarantee reproducibility. | Escalates if failure is non-deterministic (flaky). |
| **09** | `HARNESS_RED`| Runner executes the proposed regression test against unpatched code. | Rejects candidate if regression test does not fail before patch. |
| **10** | `PATCH_APPLY`| Runner applies unified patch to workspace. | Rejects candidate if patch does not apply cleanly (`git apply`). |
| **11** | `HARNESS_GRN`| Runner executes the regression test against patched code. | Rejects candidate if regression test fails to turn green. |
| **12** | `SUITE_VERIFY`| Runner executes full project test suite and linters. | Rejects candidate if any existing test regresses. |
| **13** | `POLICY_POST`| Dynamic verification that patch introduced no network calls or leaks. | Aborts run if sandbox detects unauthorized outbound sockets. |
| **14** | `BUNDLE_GEN` | Gathers execution telemetry, diff, and logs into in-toto DSSE proof bundle. | Aborts if schema validation fails. |
| **15** | `SIGNING` | Control plane signs proof bundle using Ed25519 private key. | Aborts if signing key is invalid. |
| **16** | `PUBLISH` | Pushes repair branch and opens GitHub Draft PR with proof summary. | Updates GitHub Check Run with link to certified proof bundle. |

---

## 4. Cryptographic Proof Bundle Architecture

Aegis Forge outputs proof bundles compliant with the [in-toto Attestation Framework](https://in-toto.io) and [DSSE (Dead Simple Signing Envelope)](https://github.com/secure-systems-lab/dsse).

### DSSE Envelope Structure
```json
{
  "payloadType": "application/vnd.in-toto+json",
  "payload": "<base64-encoded-in-toto-statement>",
  "signatures": [
    {
      "keyid": "af-ed25519-primary",
      "sig": "<base64-encoded-ed25519-signature>"
    }
  ]
}
```

### Pre-Authentication Encoding (PAE)
To eliminate canonicalization vulnerabilities, signatures are calculated over DSSE PAE format:
```
PAE(payloadType, payload) = "DSSEv1" + " " + len(payloadType) + " " + payloadType + " " + len(payload) + " " + payload
```

### In-Toto Statement Schema
The decoded payload conforms to `https://in-toto.io/Statement/v1`:
- **Subject**: Target repository, commit SHA, and patch SHA-256 digest.
- **Predicate Type**: `https://aegisforge.dev/attestations/ci-repair/v1`
- **Predicate Data**:
  - `failure`: Class, fingerprint, failing command, error message, root-cause file.
  - `reproduction`: Command run 3x, exit code, stdout/stderr extracts.
  - `verification`: Red-to-green verification status, test duration, suite passing status.
  - `policy`: Static and dynamic policy evaluation results.
  - `telemetry`: CPU time, peak memory usage, runner environment metadata.

---

## 5. Security & Threat Modeling

1. **Denial of Service via Poisoned Logs**: Log parser operates with strict bounds (maximum 2MB scanned, regexes bounded without backtracking) to prevent ReDoS.
2. **Token Length Side Channels**: All secret comparisons (`FORGE_ADMIN_TOKEN`, `FORGE_RUNNER_SECRET`, webhook signatures) pass through SHA-256 before `crypto.timingSafeEqual`.
3. **Shell Injection in Test Runners**: `runner/aegis.mjs` strictly sanitizes test paths and commands, disallowing metacharacters (`;&|`$()`) and directory traversal.
