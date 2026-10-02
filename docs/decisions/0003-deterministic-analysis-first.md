# ADR-0003: Deterministic analysis before any model

**Status:** accepted

## Context
In early sketches, the model read the raw log and decided everything. That made results unreproducible, expensive and impossible to test, and nothing worked without a key.

## Decision
Classification, the fingerprint, failing-command recovery and localisation are deterministic regex/structure rules with unit tests (`tests/forge.test.ts`). The model receives their output as input, and is only asked for a root-cause narrative, a regression test and a diff.

## Consequences
- The product is useful with no API key at all.
- Fingerprints are stable, so de-duplication and idempotency actually work.
- Unknown log formats degrade to `unknown` and escalation, never to a confident guess.
- New tools need a rule. Contributions are easy to review because each one ships with a fixture.
