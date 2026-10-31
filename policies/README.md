# Aegis Release Policies (Open Policy Agent / Rego)

Aegis Forge enforces strict fail-closed safety and release policies before a candidate patch is ever considered for verification or draft PR creation. The policy logic lives in `policies/aegis.patch.release.rego` and is mirrored natively in `src/lib/forge/policy.ts` for zero-overhead evaluation in TypeScript.

---

## Policy Invariants

1. **Failure Reproduction Gate**: The failing command must exit non-zero 3 out of 3 times on the unmodified parent commit.
2. **Empirical Red-to-Green Gate**: The generated regression test must fail red on the baseline, and must pass green once the patch is applied.
3. **Risk Ceiling**: The calculated structural risk score must remain strictly below the configured ceiling (`FORGE_RISK_CEILING`, default `0.35`).
4. **No Test Deletion**: Removing `it()`, `test()`, `def test_*`, or decreasing total assertion count causes an immediate policy denial.
5. **No Sensitive Path Access**: Touches to authentication, cryptographic signing, security policies, GitHub Actions workflows, or environment variables (`.env`) require explicit human review.
6. **No Network Egress**: Candidates inserting `fetch()`, `curl`, `axios`, or external sockets are rejected outright.

---

## Testing Rego Policies with OPA

If you have Open Policy Agent (`opa`) installed:

```bash
opa eval --data policies/aegis.patch.release.rego --input test-input.json "data.aegis.patch.release.allow"
```
