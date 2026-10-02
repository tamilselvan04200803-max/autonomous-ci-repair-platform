# ADR-0002: Use the repository's own CI runner as the sandbox

**Status:** accepted. Supersedes the microVM pool from the 0.3 design.

## Context
The 0.3 design described a control plane that boots E2B/Daytona microVMs per candidate. When we tried to make that something a user could clone and run, it fell apart:

- it needed a paid sandbox account before anything worked;
- each sandbox needed the repository's toolchain, caches and private registries recreated, which is exactly what the repository's CI already knows how to do;
- the control plane would have needed clone credentials and would have executed untrusted code next to its signing key.

We abandoned that approach rather than ship a demo that only works in our environment.

## Decision
Verification runs in a `repository_dispatch` workflow inside the target repository, using `runner/aegis.mjs`. GitHub-hosted runners are fresh, single-use VMs, so each verification starts from a clean machine. The runner pulls an HMAC-signed job, reports results, and pushes `aegis-forge/<run-id>` only for a winning candidate.

## Consequences
- Zero extra infrastructure. Toolchain setup is the user's existing `setup-*` steps.
- The control plane never runs repository code and never holds clone credentials.
- Candidates within one job share a VM. Isolation between candidates is `git reset --hard && git clean -fd` plus a fresh setup, which is weaker than one VM per candidate. A matrix-per-candidate mode is on the roadmap.
- Pushes made with `GITHUB_TOKEN` don't trigger workflows. The draft PR is opened with the control plane's own token so that upstream CI runs.
