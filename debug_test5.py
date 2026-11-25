from pathlib import Path
from aegis.policy.gate import PolicyGate, PolicyContext, _get_repo_root, _get_diagnosis, _get_patch, _get_pre_patch_sources, _get_verification, normalize_rel_path, is_test_file_path
from aegis.policy.config import load_policy_config
from aegis.domain.models import FailureClass, Diagnosis, VerificationReport, PolicyVerdict
import json

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

context = PolicyContext(
    repo_root=Path('.'),
    event=None,
    diagnosis=diagnosis,
    patch=patch_dict,
    verification=verification,
    post_patch_sources=post_map,
    pre_patch_sources=pre_map,
)

print("=" * 60)
print("Testing gate evaluate() step by step")
print("=" * 60)

# P1
print("\n--- P1: Path validation ---")
p1_result = gate._eval_p1(context)
print(f"P1 verdict: {p1_result.verdict} (expected ALLOW)")
print(f"P1 reason: {p1_result.reason}")

if p1_result.verdict != PolicyVerdict.ALLOW:
    print("STOPPED at P1")
    exit(0)

# P2
print("\n--- P2: Diff budget ---")
p2_result = gate._eval_p2(context)
print(f"P2 verdict: {p2_result.verdict} (expected ALLOW)")
print(f"P2 reason: {p2_result.reason}")

if p2_result.verdict != PolicyVerdict.ALLOW:
    print("STOPPED at P2")
    exit(0)

# P3
print("\n--- P3: Diff integrity ---")
p3_result = gate._eval_p3(context)
print(f"P3 verdict: {p3_result.verdict} (expected ALLOW)")
print(f"P3 reason: {p3_result.reason}")

if p3_result.verdict != PolicyVerdict.ALLOW:
    print("STOPPED at P3")
    exit(0)

# P4
print("\n--- P4: Sandbox verification ---")
p4_result = gate._eval_p4(context)
print(f"P4 verdict: {p4_result.verdict} (expected ALLOW)")
print(f"P4 reason: {p4_result.reason}")

if p4_result.verdict != PolicyVerdict.ALLOW:
    print("STOPPED at P4")
    exit(0)

# P5
print("\n--- P5: Post-patch verification re-check ---")
p5_result = gate._eval_p5(context)
print(f"P5 verdict: {p5_result.verdict} (expected ALLOW)")
print(f"P5 reason: {p5_result.reason}")

if p5_result.verdict != PolicyVerdict.ALLOW:
    print("STOPPED at P5")
    exit(0)

# P6
print("\n--- P6: Lint check ---")
p6_result = gate._eval_p6(context)
print(f"P6 verdict: {p6_result.verdict} (expected ALLOW)")
print(f"P6 reason: {p6_result.reason}")

if p6_result.verdict != PolicyVerdict.ALLOW:
    print("STOPPED at P6")
    exit(0)

# P7
print("\n--- P7: Type check ---")
p7_result = gate._eval_p7(context)
print(f"P7 verdict: {p7_result.verdict} (expected ALLOW)")
print(f"P7 reason: {p7_result.reason}")

if p7_result.verdict != PolicyVerdict.ALLOW:
    print("STOPPED at P7")
    exit(0)

# P8
print("\n--- P8: Critical failure escalation ---")
p8_result = gate._eval_p8(context)
print(f"P8 verdict: {p8_result.verdict} (expected ALLOW)")
print(f"P8 reason: {p8_result.reason}")

if p8_result.verdict != PolicyVerdict.ALLOW:
    print("STOPPED at P8")
    exit(0)

# Final
print("\n" + "=" * 60)
print("FINAL RESULT: All P1-P8 passed -> ALLOW")
print("=" * 60)