"""YAML-configured Policy Gate (P1..P8) and AST test-integrity verifier."""

from aegis.policy.ast_test_integrity import (
    TestIntegrityViolation,
    check_test_integrity,
    is_test_file_path,
)
from aegis.policy.config import (
    P1PathsConfig,
    P2TestIntegrityConfig,
    P3DiffBudgetConfig,
    P4DangerousConfig,
    P5SecretScanConfig,
    P6RequiredEvidenceConfig,
    P7ConfidenceConfig,
    P8DepthLimitConfig,
    PolicyConfig,
    load_policy_config,
)
from aegis.policy.gate import PolicyContext, PolicyEvaluationResult, PolicyGate

__all__ = [
    "P1PathsConfig",
    "P2TestIntegrityConfig",
    "P3DiffBudgetConfig",
    "P4DangerousConfig",
    "P5SecretScanConfig",
    "P6RequiredEvidenceConfig",
    "P7ConfidenceConfig",
    "P8DepthLimitConfig",
    "PolicyConfig",
    "PolicyContext",
    "PolicyEvaluationResult",
    "PolicyGate",
    "TestIntegrityViolation",
    "check_test_integrity",
    "is_test_file_path",
    "load_policy_config",
]
