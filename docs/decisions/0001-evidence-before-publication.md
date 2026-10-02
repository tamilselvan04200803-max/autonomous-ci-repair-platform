# ADR-0001: Nothing is published without evidence

**Status:** accepted

## Context
Teams already distrust bots that open plausible-looking fix PRs. Each wrong PR costs reviewer attention and erodes trust in the next one.

## Decision
A patch is published, and only ever as a *draft*, when every one of these holds: the failure reproduced 3/3 times; the regression test was red before the patch and green after; the original failing command is green; the extra checks are green; policy allows it; and risk is below the ceiling. Certification additionally requires the PR's own upstream CI to pass.

## Consequences
- Fewer PRs, but each one is worth reading.
- Some real fixes are lost to escalation (non-reproducible failures, missing test harness). That's an accepted cost.
- Every refusal produces an escalation record rather than silence.
