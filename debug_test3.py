from pathlib import Path
from aegis.policy.gate import PolicyGate, PolicyContext
from aegis.policy.config import load_policy_config
from aegis.domain.models import FailureClass, Diagnosis, VerificationReport, PolicyVerdict
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

# Trace through rules
context = PolicyContext(
    repo_root=Path('.'),
    event=None,
    diagnosis=diagnosis,
    patch=patch_dict,
    verification=verification,
    post_patch_sources=post_map,
    pre_patch_sources=pre_map,
)

print("Testing gate rules...")
print(f"Config p4_dangerous_constructs: {hasattr(policy_config, 'p4_dangerous_constructs')}")

# Manually test P1
from aegis.policy.gate import _get_repo_root, _get_diagnosis, _get_patch, _get_pre_patch_sources
repo_root = _get_repo_root(context)
diagnosis_obj = _get_diagnosis(context)
patch_obj = _get_patch(context)
provided_pre = _get_pre_patch_sources(context)
cfg = gate._p1_cfg if hasattr(gate, '_p1_cfg') else gate.config.p1_paths

print(f"cfg.allow_lockfiles_for_f4: {cfg.allow_lockfiles_for_f4}")
diagnosis_fail_class = diagnosis_obj.failure_class
print(f"diagnosis_obj.failure_class: {diagnosis_fail_class}")
print(f"Is F4_DEPENDENCY_DRIFT: {diagnosis_fail_class == FailureClass.F4_DEPENDENCY_DRIFT}")
print(f"allow_lock result: {cfg.allow_lockfiles_for_f4 and diagnosis_fail_class == FailureClass.F4_DEPENDENCY_DRIFT}")

# Test P4 
print("\nTesting P4...")
verification_obj = gate._get_verification(context)
print(f"passed_after_patch: {verification_obj.passed_after_patch}")
print(f"exit_codes_before: {verification_obj.exit_codes_before}")
print(f"exit_codes_after: {verification_obj.exit_codes_after}")
print(f"network_disabled: {verification_obj.network_disabled}")
print(f"read_only_rootfs: {verification_obj.read_only_rootfs}")

# Test P8
print("\nTesting P8...")
diagnosis_obj2 = gate._get_diagnosis(context)
failure_class = (
    diagnosis_obj2.failure_class
    if hasattr(diagnosis_obj2, "failure_class")
    else diagnosis_obj2.get("failure_class", "") if isinstance(diagnosis_obj2, dict) else ""
)
print(f"failure_class: {failure_class}")
print(f"Is critical (F2 or F3): {failure_class in ('F2_SECURITY_VIOLATION', 'F3_INFRASTRUCTURE_FAILURE')}")