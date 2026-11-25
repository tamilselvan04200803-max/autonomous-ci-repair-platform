from pathlib import Path
from aegis.policy.gate import PolicyGate, PolicyContext, _get_repo_root, _get_diagnosis, _get_patch, _get_pre_patch_sources, _get_verification, normalize_rel_path
from aegis.policy.config import load_policy_config
from aegis.domain.models import FailureClass, Diagnosis, VerificationReport, PolicyVerdict
import hashlib

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
print("Testing all gate rules P1-P8")
print("=" * 60)

# P1
print("\n--- P1: Path validation ---")
repo_root = _get_repo_root(context)
diagnosis_obj = _get_diagnosis(context)
patch_obj = _get_patch(context)
provided_pre = _get_pre_patch_sources(context)
cfg = gate.config.p1_paths

changed = [
    normalize_rel_path(p)
    for p in (patch_obj.changed_files if hasattr(patch_obj, "changed_files") else patch_obj.get("changed_files", []))
]
print(f"changed_files: {changed}")
allow_lock = cfg.allow_lockfiles_for_f4 and diagnosis_obj.failure_class == FailureClass.F4_DEPENDENCY_DRIFT
print(f"allow_lock (F4 check): {allow_lock}")

violations = []
root_resolved = Path(repo_root).resolve()
for raw in changed:
    rel = raw
    parts = Path(rel).parts
    if not parts or raw.startswith("/") or ".." in parts:
        violations.append(f"traversal/absolute path rejected: {raw}")
        continue
    if getattr(cfg, "reject_symlinks", False):
        candidate = Path(repo_root) / rel
        cur = Path(repo_root)
        symlink_hit = False
        for part in parts:
            cur = cur / part
            if candidate.is_symlink():
                symlink_hit = True
        if symlink_hit and getattr(cfg, "reject_symlinks", False):
            violations.append(f"symlink rejected: {raw}")
            continue
    if getattr(cfg, "reject_non_ascii_paths", False):
        if any(ord(c) > 127 for c in rel):
            violations.append(f"non-ASCII/homoglyph path rejected: {rel}")
            continue
    if getattr(cfg, "reject_lockfiles", False) and rel.endswith((".lock", ".toml")):
        violations.append(f"lockfile rejected: {raw}")
        continue

if violations:
    print(f"P1: DENY - violations: {'; '.join(violations)}")
else:
    if allow_lock and any(rel.endswith((".lock", ".toml")) for rel in changed):
        print(f"P1: ALLOW (lockfiles allowed for F4)")
    else:
        print(f"P1: ALLOW - Path validation passed")

# P4
print("\n--- P4: Sandbox verification ---")
verification_obj = verification  # already extracted
passed_after_patch = verification_obj.passed_after_patch
print(f"passed_after_patch: {passed_after_patch}")
exit_codes_before = verification_obj.exit_codes_before
print(f"exit_codes_before: {exit_codes_before}")
exit_codes_after = verification_obj.exit_codes_after
print(f"exit_codes_after: {exit_codes_after}")

# network_disabled - check verification first
network_disabled = verification_obj.network_disabled
print(f"network_disabled from verification: {network_disabled}")

# read_only_rootfs - check verification first
read_only_rootfs = verification_obj.read_only_rootfs
print(f"read_only_rootfs from verification: {read_only_rootfs}")

if not passed_after_patch:
    print("P4: DENY - Post-patch verification did not pass")
elif any(c != 0 for c in exit_codes_before):
    print("P4: DENY - Pre-patch exit codes indicate failure")
elif not network_disabled:
    print("P4: DENY - Network not disabled during sandbox execution")
elif not read_only_rootfs:
    print("P4: DENY - Read-only rootfs not enforced")
else:
    print("P4: ALLOW - Sandbox verification passed")

# P8
print("\n--- P8: Critical failure escalation ---")
diagnosis_obj2 = diagnosis
failure_class = (
    diagnosis_obj2.failure_class
    if hasattr(diagnosis_obj2, "failure_class")
    else diagnosis_obj2.get("failure_class", "") if isinstance(diagnosis_obj2, dict) else ""
)
print(f"failure_class: {failure_class}")
if failure_class in ("F2_SECURITY_VIOLATION", "F3_INFRASTRUCTURE_FAILURE"):
    print("P8: ESCALATE - Critical failure class requires human review")
else:
    print("P8: ALLOW - Failure class does not require escalation")