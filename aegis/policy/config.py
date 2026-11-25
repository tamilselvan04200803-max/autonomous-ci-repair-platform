"""YAML configuration loader and Pydantic v2 schema for Policy Gate rules P1..P8."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field


class P1PathsConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    denied_globs: tuple[str, ...]
    lockfile_globs: tuple[str, ...]
    allow_lockfiles_for_f4: bool = True
    reject_non_ascii_paths: bool = True
    reject_symlinks: bool = True


class P2TestIntegrityConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    enabled: bool = True
    forbid_test_deletion: bool = True
    forbid_assertion_reduction: bool = True
    forbid_added_skips: bool = True
    forbid_tautologies: bool = True
    escalate_test_only_patch: bool = True


class P3DiffBudgetConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    max_files: int = Field(default=3, ge=1)
    max_changed_lines: int = Field(default=60, ge=1)


class P4DangerousConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    enabled: bool = True
    run_overfit_guard: bool = True
    forbidden_calls: tuple[str, ...]
    forbidden_modules: tuple[str, ...]
    forbidden_env_reads: tuple[str, ...]
    forbid_subprocess_shell_true: bool = True


class P5SecretScanConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    enabled: bool = True


class P6RequiredEvidenceConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    min_reproduction_runs: int = Field(default=1, ge=1)
    require_reproduced_baseline: bool = True
    require_passed_after_patch: bool = True
    require_lint_clean: bool = True
    require_typecheck_clean: bool = True
    require_network_disabled: bool = True
    require_read_only_rootfs: bool = True


class P7ConfidenceConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    min_confidence: float = Field(default=0.75, ge=0.0, le=1.0)


class P8DepthLimitConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    max_depth: int = Field(default=1, ge=0)
    blocked_actors: tuple[str, ...]
    blocked_branch_prefixes: tuple[str, ...]


class PolicyConfig(BaseModel):
    """Top-level validated YAML Policy Gate specification."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    version: int = 1
    p1_paths: P1PathsConfig
    p2_test_integrity: P2TestIntegrityConfig
    p3_diff_budget: P3DiffBudgetConfig
    p4_dangerous_constructs: P4DangerousConfig
    p5_secret_scan: P5SecretScanConfig
    p6_required_evidence: P6RequiredEvidenceConfig
    p7_confidence: P7ConfidenceConfig
    p8_depth_limit: P8DepthLimitConfig


def load_policy_config(path: str | Path = Path("config/policy.yaml")) -> PolicyConfig:
    """Load and strictly validate YAML policy configuration."""
    cfg_path = Path(path)
    raw = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Expected mapping in policy config {cfg_path}")
    return PolicyConfig.model_validate(raw)
