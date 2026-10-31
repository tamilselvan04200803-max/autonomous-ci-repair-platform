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
