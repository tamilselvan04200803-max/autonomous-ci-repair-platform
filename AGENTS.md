# Repository Guidelines

## Project Structure & Module Organization

Aegis Forge is a Next.js App Router application for evidence-gated CI repair. `src/app/` contains pages and API route handlers; `src/components/` holds shared React components. Core analysis, policy, authentication, signing, and orchestration live in `src/lib/forge/`. PostgreSQL/Drizzle definitions and initialization live in `src/db/`.

Unit tests are in `tests/forge.test.ts`; benchmark suites live in `benchmarks/`; example failure logs and signed proof bundles are in `examples/`. `runner/aegis.mjs` is the standalone verification runner. AST and semantic rules live in `rules/`. Use `public/images/` for assets, `templates/` for integration workflows, `policies/` for Rego rules, and `docs/decisions/` for architecture decision records (ADRs). Detailed layout is mapped in `docs/repository-structure.md`.

## Build, Test, and Development Commands

Use Node.js 20+; CI covers Node 20 and 22.

- `npm ci`: install locked dependencies.
- `docker compose up -d db`: start local PostgreSQL. Copy `.env.example` to `.env` and configure `DATABASE_URL`.
- `npm run db:seed`: populate the development ledger with demo runs.
- `npm run dev`: serve locally at `http://localhost:3000`.
- `npm test` / `npm run test:watch`: run unit tests once or continuously.
- `npm run bench`: run Aegis Bench evaluation benchmark suites.
- `npm run typecheck` / `npm run lint`: check TypeScript and ESLint rules.
- `npm run build` / `npm start`: build and serve production output.
- `npm run test:e2e`: exercise the full repair and signing loop; requires Bash, Git, Node, `psql`, `curl`, a running server/database, and matching runner secrets.

## Coding Style & Naming Conventions

Follow `.editorconfig`: two-space indentation, UTF-8, LF endings, and final newlines. Use strict TypeScript, double quotes, and semicolons consistent with existing files. Name React components in PascalCase and functions/variables in camelCase. Keep Next.js entry names such as `page.tsx` and `route.ts`; use `@/` for imports rooted at `src/`. ESLint uses Next.js Core Web Vitals rules.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`, executed through `tsx`. Add descriptive behavioral tests to `tests/forge.test.ts`; the test command explicitly targets this file. For parser changes, add a redacted sample and demonstrate a failing test before implementation. No numeric coverage threshold is configured. Run tests, typecheck, lint, and build before submitting.

## Commit & Pull Request Guidelines

The available history uses `feat:`; `CONTRIBUTING.md` prescribes Conventional Commits, including `fix:` and `docs:`. Target `main` and complete `.github/PULL_REQUEST_TEMPLATE.md` with motivation, verification evidence, and documentation updates. All CI checks must pass.

## Security & Architecture Rules

Never commit secrets or unredacted logs. Keep the runner dependency-free and untrusted repository execution outside the control plane. Preserve fail-closed evidence gates. Synchronize `src/db/schema.ts` and `src/db/ensure.ts`. Security-boundary, attestation-schema, and sandbox-policy changes require an ADR. Report vulnerabilities privately as described in `SECURITY.md`.

---

## Aegis-CI Control Plane Rules (Master Build Plan v1.0 Section 10)

1. `docs/MASTER_PLAN.md` and `docs/REPO_AUDIT.md` are the source of truth for the Python `aegis/` control plane (`aegis` imports `agentsentinel`, never the reverse). Never invent endpoints, flags, config keys, or library APIs.
2. Verify before use: for every third-party library or GitHub API call, first write and commit a contract test under `tests/contracts/` that proves the call works on the pinned version, with the docs URL in a comment.
3. Pin everything in `pyproject.toml` / `requirements-py.lock` and record resolved versions in `VERSIONS.md`. Re-read Section 9 of `docs/MASTER_PLAN.md` before touching MCP, GitHub, or Docker code.
4. Done means these commands were run and their real output checked: `ruff check aegis tests`, `mypy --strict aegis`, `pytest`, plus the milestone acceptance checks and existing Node verification gates (`npm test`, `npm run bench`, `npm run typecheck`, `npm run lint`). Never write "should work".
5. Never edit, skip, or weaken an existing test to make it pass. Write new tests from acceptance criteria first. Keep all existing Aegis Forge (TypeScript) and AgentSentinel invariants intact.
6. Branch cleanly with small focused commits. Always invoke Python from `.venv` with bytecode disabled (`$env:PYTHONDONTWRITEBYTECODE="1"; .\.venv\Scripts\python.exe -B ...`).
7. Secrets: `.env`, `*.pem`, `*.key` files are never committed or printed; run `scripts/check_secrets.py` before commits.
8. Every public claim goes in `CLAIMS.md` with the file and command that proves it. README benchmark numbers are generated from result files by script, never typed.
9. Never weaken sandbox flags (`--network=none`, `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`), gate defaults, or the write-token ref wrapper (`refs/heads/aegis/*`).
10. Keep `progress.md` and `HANDOVER.md` updated at each milestone: what changed, what is verified, what is open.
