# Reference Rego for the release policy built into src/lib/forge/policy.ts.
# Kept in lock-step so teams that run OPA can evaluate the same decision.
package aegis.patch.release

import rego.v1

default allow := false

risk_ceiling := 0.35

allow if count(deny) == 0

deny contains "failure was not reproduced on the parent commit" if not input.reproduced
deny contains "regression test did not fail before the patch" if not input.proven_red
deny contains "regression test did not pass after the patch" if not input.proven_green
deny contains msg if {
	input.risk.score >= risk_ceiling
	msg := sprintf("risk %v ≥ ceiling %v", [input.risk.score, risk_ceiling])
}
deny contains "sensitive paths require human review" if count(input.risk.touches_sensitive) > 0
deny contains "patch deletes existing tests" if input.risk.deletes_tests
deny contains "patch introduces network egress" if input.risk.introduces_egress
