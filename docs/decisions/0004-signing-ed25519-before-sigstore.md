# ADR-0004: Ed25519 DSSE now, Sigstore keyless later

**Status:** accepted

## Context
GitHub artifact attestations (Sigstore-backed) only work inside GitHub Actions with OIDC, and only in public repositories on non-Enterprise plans. A self-hosted control plane can't use them directly.

## Decision
Sign an in-toto Statement v1 inside a DSSE envelope with Ed25519, using Node's built-in crypto. The statement embeds the full bundle, and the subject digest is `sha256(canonicalJson(bundle))`. The key comes from `FORGE_SIGNING_KEY`, or is generated once and stored in Postgres. Verification works offline with `runner/aegis.mjs verify-bundle`.

## Consequences
- Works anywhere, with no external service.
- The format is the same one Sigstore uses, so moving to keyless signing plus a Rekor log is a change of signer, not of format.
- Key custody is the operator's responsibility until then (see SECURITY.md).
