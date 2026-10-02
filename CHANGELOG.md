# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.0] - 2026-10-02

### Added
- **Production-Ready Core Architecture**: Fully hardened Next.js 15 + PostgreSQL 15 control plane with standalone build support.
- **Specimen Run Auto-Seeding**: Control plane automatically seeds specimen run `AF-04-1187` upon initial boot (`src/db/ensure.ts`) so fresh clones have immediate access to complete proof bundles and verification dossiers without manual seeding.
- **Query & API Pagination**: Added `limit` and `offset` parameters to `listRuns()` and `GET /api/runs` with strict boundary validation (up to 500 items per page).
- **Comprehensive Documentation Suite**: Added `docs/index.md`, `docs/getting-started.md`, `docs/architecture.md`, and `docs/deployment.md`.
- **Authentic Engineering Imagery**: Integrated authentic public-domain and CC-BY-SA 4.0 historical photographs from Wikimedia Commons for flight recorder telemetry, sandbox blueprints, control console operations, and document wax seals.
- **Multi-Version CI Workflow**: Added GitHub Actions workflow matrix testing on Node.js 20 & 22 with automated PostgreSQL services, linting, typechecking, unit tests, and Next.js production build verification.
- **GitHub Community Standards**: Added automated Dependabot configuration (`.github/dependabot.yml`), Issue Templates (`bug_report.md`, `feature_request.md`), PR Template, and Funding metadata.

### Security
- **Fail-Closed Admin Authentication**: In production (`NODE_ENV=production`), admin endpoints strictly require `FORGE_ADMIN_TOKEN` and reject requests with HTTP 401 when the token is unset.
- **Eliminated Token-Length Timing Leaks**: `safeEqual` pre-hashes both arguments with SHA-256 before invoking `crypto.timingSafeEqual`, preventing length leakage across bearer tokens and webhook signatures.
- **Runner Dispatch Verification**: Control plane strictly checks for runner secret configuration before dispatching background jobs.
- **Runner Shell & Path Sanitization**: `runner/aegis.mjs` verifies test file paths against directory traversal outside the workspace and rejects commands containing shell injection metacharacters (`;&|`$()`).
- **HTTP Security Headers**: Next.js production server injects `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, and HSTS headers.

### Fixed
- **Attestation Verification Crash Guard**: Guarded `/api/attestations/verify` against `null`, primitive, or non-object payloads; safely caught database signing key lookups.
- **Analyze Route Type Checking**: Enforced strict `typeof log === "string"` checks and wrapped `analyzeLog` in structured try/catch error boundaries.
- **Database Connection Lifecycle**: Added unhandled `pool.on("error")` handler to prevent process crashes on transient network drops; ensured lazy database pool creation when `DATABASE_URL` is unset.
- **LLM Markdown Fence Stripping**: Parser automatically strips markdown code fences (````json ... ````) before executing `JSON.parse` on candidate patch responses.
- **Idempotent Proof Bundle API**: `GET /api/runs/[id]/bundle` is now strictly read-only and idempotent (`persist=false`); sanitized `id` parameter against header injection in `Content-Disposition`.
- **Diff Parser Header False Positives**: Unified diff parser in `src/lib/forge/policy.ts` now matches exact `+++ b/`, `+++ /dev/null`, `--- a/`, and `--- /dev/null` headers.
- **UI & Accessibility Fixes**:
  - Replaced `atob`/`unescape` with `TextDecoder`/`TextEncoder` for UTF-8 multibyte characters in attestation verification.
  - Converted AegisMark SVG shield to compound path with `fillRule="evenodd"` and `fill="currentColor"`, fixing visibility across dark themes.
  - Corrected query parameter routing (`state` vs `status`) in footer and run listing filters.
  - Added comprehensive `aria-label`s and `role="status"` live indicators across form consoles.

---

## [0.4.0] - 2026-09-15

### Added
- Deterministic failure analyser covering TypeScript, pyright/mypy, pytest, Python tracebacks, Go, Rust, Jest/Vitest, `node:test`, npm/pnpm/pip/cargo resolution, flaky and infra signals.
- `/analyze`: Interactive analyser with presets, file upload, and drag-and-drop.
- GitHub webhook ingress with HMAC verification, a delivery replay guard, and background processing.
- Idempotent repair runs keyed on repo + workflow + SHA + fingerprint.
- Check runs on the failing commit, and draft PRs carrying the proof bundle.
- Candidate generation through any OpenAI-compatible endpoint, with static policy screening before verification.
- `runner/aegis.mjs`: Zero-dependency verification runner (reproduce ×3, red→green, extra checks, branch push), offline bundle verifier, and `analyze`/`submit` commands for any CI.
- Ed25519 DSSE envelopes over in-toto Statement v1 with an embedded bundle digest; `/verify` page; `/api/keys`.
- `/setup`: Live integration status and a connection guide.
- `scripts/e2e-local.sh` and a CI workflow that runs the full loop.

---

## [0.3.0] - 2026-08-01

### Added
- Initial system architecture specification and design dossier describing the 16-stage pipeline and proof bundle format.
