from pathlib import Path
from aegis.policy.gate import PolicyGate, PolicyContext
from aegis.policy.config import load_policy_config
from aegis.domain.models import FailureClass, Diagnosis, VerificationReport
from aegis.domain.models import FailureEvent

# Create diagnosis with F1
diagnosis = Diagnosis(
    failure_class=FailureClass.F1_TEST_REGRESSION,
    parser='pytest',
    failing_command='pytest',
    error_summary='AssertionError',
    error_files=('pkg/calc.py',),
    confidence=0.92,
)

# Create verification
verification = VerificationReport(
    reproduction_runs=1,
    reproduced_failures=1,
    passed_after_patch=True,
    exit_codes_before=(0,),
    exit_codes_after=(0,),
    lint_clean=True,
    typecheck_clean=True,
    network_disabled=True,
    read_only_rootfs=True,
)

patch_dict = {
    'changed_files': ('pkg/calc.py',),
    'added_lines': 1,
    'deleted_lines': 1,
}

pre_map = {'pkg/calc.py': 'def add(a: int, b: int) -> int:\n    return a - b\n'}
post_map = {'pkg/calc.py': 'def add(a: int, b: int) -> int:\n    return a + b\n'}

policy_config = load_policy_config()
gate = PolicyGate(policy_config)

policy_result = gate.evaluate(PolicyContext(
    repo_root=Path('.'),
    event=None,
    diagnosis=diagnosis,
    patch=patch_dict,
    verification=verification,
    post_patch_sources=post_map,
    pre_patch_sources=pre_map,
))

print(f'Verdict: {policy_result.verdict}')
print(f'Reason: {policy_result.reason}')
print(f'All passed P1-P8: {policy_result.verdict == "ALLOW"}')