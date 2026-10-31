# Aegis Bench: Autonomous CI Repair Benchmark Suite

Aegis Bench is an empirical evaluation suite for autonomous software repair systems. Unlike traditional synthetic benchmarks, Aegis Bench focuses strictly on **failure isolation, flaky-test refusal, invariant preservation, and anti-degradation policy enforcement**.

---

## Benchmark Taxonomy

The evaluation suite spans four core failure dimensions:

| Dimension | Directory | Key Challenge | Target Behavior |
|---|---|---|---|
| **Compiler & Type Errors** | `suites/compiler-errors/` | Complex type system and interface divergence (`TS2305`, `E0432`, Pyright) | Correct root-cause identification & repairable flag |
| **Flaky Tests** | `suites/flaky-tests/` | Non-deterministic assertion absence, port contention (`EADDRINUSE`), race conditions | **Fail-closed refusal & escalation** (never auto-patch) |
| **Hidden Mutations** | `suites/hidden-mutations/` | Agent attempts to weaken assertions, delete tests, or hardcode fixture returns | **Policy gate denial** (`aegis.patch.release.rego`) |
| **Dependency Drift** | `suites/dependency-drift/` | Lockfile mismatch, breaking major version bump (`ERESOLVE`, `ERR_PNPM_*`) | Precise package localization & non-breaking version resolution |

---

## Evaluation Metrics

Every benchmark case measures the system against the core Aegis invariants:

1. **Classification Accuracy ($Acc_{class}$)**: Does the analyser classify the failure log into the exact error class (`compile`, `dependency`, `unit_test`, `flaky`)?
2. **Command Recovery ($Rec_{cmd}$)**: Does the engine identify the exact failing shell command stripped of runner echoes?
3. **Fault Localization Precision ($P_{loc}$)**: Are localized files constrained to repository source files rather than runtime/library paths?
4. **Refusal Reliability ($R_{refuse}$)**: Does the engine reject 100% of non-deterministic or flaky logs without hallucinating candidate patches?
5. **Anti-Degradation Defense ($D_{gate}$)**: Does the policy engine block patches that delete assertions, bypass tests, or introduce unauthorized file access?

---

## Running the Benchmark Suite

Run the full benchmark suite locally via Node.js:

```bash
npm run bench
# or run directly:
node benchmarks/runner.mjs
```

To run a specific failure scenario:

```bash
node benchmarks/runner.mjs --suite compiler-errors
node benchmarks/runner.mjs --suite flaky-tests
```
