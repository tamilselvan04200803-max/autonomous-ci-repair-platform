# Contributing to Aegis Forge

Thank you for your interest in contributing to Aegis Forge! Aegis Forge is an evidence-gated autonomous software-repair platform designed to be crash-resilient and secure by default.

To ensure trust and reliability, we follow strict conventions and an evidence-first engineering methodology.

---

## Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md). Please report any unacceptable behavior to [tamilselvan04200803@gmail.com](mailto:tamilselvan04200803@gmail.com).

---

## The Most Valuable Contribution: A Real Failure Signature

The core of Aegis Forge's intelligence is its deterministic failure analysis engine (`src/lib/forge/analyze.ts`). Rather than relying on non-deterministic LLMs to guess what broke, Aegis Forge uses deterministic parsing rules to pinpoint the exact failure class, failing command, and source file.

Here is how to contribute a new failure signature:

1. **Obtain a Real Failing CI Log**:
   - Extract a real, reproducible failure from GitHub Actions, GitLab CI, or local test runs.
   - **Crucial**: Redact any sensitive tokens, internal company domains, passwords, or secrets.
2. **Add the Sample**:
   - Add the redacted raw log to `src/lib/samples.ts` under an exported constant (e.g. `SAMPLE_MY_NEW_FAILURE`).
3. **Write the Failing Test**:
   - Open `tests/forge.test.ts`.
   - Add an assertion specifying the expected `failureClass`, `command`, and root `file`.
   - Run the tests:
     ```bash
     npm test
     ```
   - Watch it fail. **Always write the failing test before the implementation.**
4. **Implement the Parser Rule**:
   - Add or refine pattern matching logic in `src/lib/forge/analyze.ts`.
   - Provide an actionable remediation hint if the root mechanism is well understood.
5. **Verify No Regressions**:
   - Ensure all existing samples in `tests/forge.test.ts` still classify accurately.

---

## Ground Rules & Architecture Invariants

Every pull request must honor these core engineering invariants:

- **Fail Closed**: If a new feature or validation step cannot prove safety or correctness, it must escalate to a human or reject the patch rather than guess.
- **Zero Runtime Dependencies in `runner/aegis.mjs`**: The verification runner must execute on standard Node.js 18+ images without requiring external npm packages or compilers.
- **No Repository Code on the Control Plane**: Untrusted code must never execute within the Next.js control plane. All code execution occurs inside sandboxed runners.
- **Architecture Decisions Require an ADR**: Any change to security boundaries, attestation schemas, or sandboxing policy requires a formal Markdown record in `docs/decisions/`.
- **Database Schema Sync**: Always keep `src/db/ensure.ts` synchronized with `src/db/schema.ts` to ensure seamless zero-migration developer onboarding.

---

## Development Workflow

### Prerequisites
- Node.js `20.x` or higher
- PostgreSQL `15.x` (or Docker)
- Git

### Initial Setup
```bash
git clone https://github.com/tamilselvan04200803-max/autonomous-ci-repair-platform.git
cd autonomous-ci-repair-platform
npm install
cp .env.example .env.local
npm run db:seed
```

### Running Local Verification
Before opening a pull request, run the full validation suite:

```bash
# 1. Run unit test suite
npm test

# 2. Run TypeScript typecheck
npm run typecheck

# 3. Run ESLint
npm run lint

# 4. Verify Next.js production build
npm run build

# 5. (Optional) Run full end-to-end simulation
FORGE_RUNNER_SECRET=dev-runner npm run dev &
AEGIS_RUNNER_SECRET=dev-runner ./scripts/e2e-local.sh
```

---

## Submitting Pull Requests

1. **Fork and Branch**: Create a descriptive feature branch from `main` (e.g., `feature/pytest-ast-extractor` or `fix/log-ansi-stripping`).
2. **Commit Messages**: Follow standard conventional commits format:
   - `feat: add Go panic stack trace extractor`
   - `fix: prevent ReDoS on unclosed ANSI color sequences`
   - `docs: add reverse proxy guide for Caddy`
3. **Open a Pull Request**: Submit your PR targeting `main`. Fill out the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md) completely.
4. **CI Checks**: Ensure that all automated GitHub Actions checks pass.
