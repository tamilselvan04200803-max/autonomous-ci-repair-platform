# Aegis Runner: Zero-Dependency Verification Runner

`runner/aegis.mjs` is the isolated execution runner that operates inside a dedicated CI virtual machine or sandbox container. It has **zero runtime dependencies** and executes on standard Node.js (>= 18).

---

## Design Principles

1. **Untrusted Code Isolation**: The control plane never executes untrusted repository code or tests directly on its host. Execution happens in an ephemeral runner VM.
2. **Deterministic Workspace Reset**: Workspaces are cleaned (`git reset --hard` and `git clean -fdq`) before every test phase to eliminate hidden side-effects.
3. **Hardened Command Execution**: Test file paths and test commands are strictly sanitized to prevent path traversal (`..`) and shell chaining attacks (`;&|$`).
4. **Offline Proof Verification**: Bundles can be verified by downstream developers or auditors without network access or control plane dependencies.

---

## Command Reference

| Subcommand | Arguments | Description |
|---|---|---|
| `verify` | *(reads environment)* | Executes the full 16-stage verification loop inside CI: reproduces 3×, verifies red regression test, applies patch, verifies green, runs checks, reports results. |
| `verify-bundle` | `<file> [--key <key>]` | Cryptographically verifies a DSSE proof envelope offline against an Ed25519 public key or control plane URL. |
| `analyze` | `<logfile>` | Analyzes a raw failure log against the deterministic classifier and outputs diagnostic report. |
| `submit` | `<logfile> --repo <r> --sha <s>` | Submits a failed log to open an idempotent repair run from external CI systems. |

---

## Environment Variables for `verify`

- `AEGIS_URL`: Control plane URL (e.g. `https://aegis.acme.corp`).
- `AEGIS_RUNNER_SECRET`: Shared runner authorization secret.
- `AEGIS_RUN_ID`: ID of the repair run to execute.
- `AEGIS_EXTRA_CHECKS`: Newline-separated extra validation commands (e.g., `npm run typecheck\nnpm run lint`).
- `AEGIS_SETUP`: Command run after each checkout (e.g. `npm ci`).
- `AEGIS_TIMEOUT_SEC`: Timeout per command execution in seconds (default `900`).
