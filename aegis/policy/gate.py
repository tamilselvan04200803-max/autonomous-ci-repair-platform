"""Deterministic Policy Gate evaluating rules P1..P8 against every candidate repair."""

from __future__ import annotations

import ast
import fnmatch
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING

from agentsentinel.verification.overfit_guard import (
    OverfitPolicyError,
    SourceAnalysisLimitError,
    verify_not_overfitted,
)
from pydantic import BaseModel, ConfigDict

from aegis.domain.models import (
    Diagnosis,
    FailureClass,
    FailureEvent,
    Patch,
    PolicyDecision,
    PolicyVerdict,
    VerificationReport,
)
from aegis.graph.frontend import normalize_rel_path
from aegis.policy.ast_test_integrity import check_test_integrity, is_test_file_path
from aegis.triage.redactor import detect_secret_labels

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from aegis.policy.config import PolicyConfig


@dataclass(frozen=True, slots=True)
class PolicyContext:
    """Inputs evaluated by PolicyGate for a candidate patch."""

    repo_root: Path
    event: FailureEvent
    diagnosis: Diagnosis
    patch: Patch
    verification: VerificationReport
    post_patch_sources: Mapping[str, str] = field(default_factory=dict)
    pre_patch_sources: Mapping[str, str] | None = None
    repair_depth: int = 0


class PolicyEvaluationResult(BaseModel):
    """Aggregate verdict plus itemized PolicyDecision rows for P1..P8."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    verdict: PolicyVerdict
    decisions: tuple[PolicyDecision, ...]

    @property
    def by_rule(self) -> dict[str, PolicyDecision]:
        return {d.rule_id: d for d in self.decisions}


def _match_glob(rel_path: str, pattern: str) -> bool:
    norm = normalize_rel_path(rel_path)
    pat = normalize_rel_path(pattern)
    if pat.endswith("/**"):
        prefix = pat[:-3]
        return norm == prefix or norm.startswith(f"{prefix}/")
    if pat.startswith("**/"):
        sub = pat[3:]
        if fnmatch.fnmatch(norm, sub) or fnmatch.fnmatch(PurePosixPath(norm).name, sub):
            return True
    if "/" not in pat and fnmatch.fnmatch(PurePosixPath(norm).name, pat):
        return True
    return fnmatch.fnmatch(norm, pat)


def _has_homoglyph_or_control(rel_path: str) -> bool:
    if not rel_path.isascii():
        return True
    return any(unicodedata.category(ch) == "Cf" for ch in rel_path)


def _dotted_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = _dotted_name(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return ""


def _scan_dangerous_hits(
    source: str,
    *,
    forbidden_calls: Sequence[str],
    forbidden_modules: Sequence[str],
    forbidden_env_reads: Sequence[str],
    forbid_shell_true: bool,
) -> Counter[str]:
    counts: Counter[str] = Counter()
    if not source.strip():
        return counts
    try:
        tree = ast.parse(source)
    except SyntaxError:
        counts["syntax_error"] += 1
        return counts

    mod_set = set(forbidden_modules)
    call_set = set(forbidden_calls)
    env_set = set(forbidden_env_reads)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                for mod in mod_set:
                    if alias.name == mod or alias.name.startswith(f"{mod}."):
                        counts[f"import:{mod}"] += 1
        elif isinstance(node, ast.ImportFrom) and node.module:
            for mod in mod_set:
                if node.module == mod or node.module.startswith(f"{mod}."):
                    counts[f"import:{mod}"] += 1
        elif isinstance(node, ast.Call):
            dotted = _dotted_name(node.func)
            tail = dotted.rsplit(".", 1)[-1]
            if dotted in call_set or (tail in call_set and "." not in tail):
                counts[f"call:{dotted}"] += 1
            if dotted in env_set:
                counts[f"env:{dotted}"] += 1
            for mod in mod_set:
                if dotted == mod or dotted.startswith(f"{mod}."):
                    counts[f"net:{dotted}"] += 1
            if forbid_shell_true and (dotted.startswith("subprocess.") or tail == "Popen"):
                for kw in node.keywords:
                    if (
                        kw.arg == "shell"
                        and isinstance(kw.value, ast.Constant)
                        and kw.value.value is True
                    ):
                        counts["subprocess:shell=True"] += 1
        elif isinstance(node, ast.Attribute):
            dotted = _dotted_name(node)
            if dotted in env_set:
                counts[f"env:{dotted}"] += 1

    return counts


def _added_diff_lines(unified_diff: str) -> str:
    lines: list[str] = []
    for raw in unified_diff.splitlines():
        if raw.startswith("+") and not raw.startswith("+++ "):
            lines.append(raw[1:])
    return "\n".join(lines)


class PolicyGate:
    """Evaluates rules P1..P8 deterministically in fixed order."""

    def __init__(self, config: PolicyConfig) -> None:
        self.config = config

    def _collect_source_maps(
        self,
        context: PolicyContext,
    ) -> tuple[dict[str, str], dict[str, str]]:
        pre_map: dict[str, str] = {}
        post_map: dict[str, str] = {}
        provided_pre = context.pre_patch_sources or {}

        all_rels = {normalize_rel_path(p) for p in context.patch.changed_files}
        all_rels.update(normalize_rel_path(p) for p in context.post_patch_sources)

        for rel in sorted(all_rels):
            if rel in provided_pre:
                pre_src = provided_pre[rel]
            else:
                path = context.repo_root / rel
                pre_src = (
                    path.read_text(encoding="utf-8", errors="replace")
                    if path.is_file() and not path.is_symlink()
                    else ""
                )
            pre_map[rel] = pre_src
            if rel in context.post_patch_sources:
                post_map[rel] = context.post_patch_sources[rel]
            else:
                # Re-use pre source if caller didn't materialize patched content separately
                post_map[rel] = pre_src
        return pre_map, post_map

    def _eval_p1(self, context: PolicyContext) -> PolicyDecision:
        cfg = self.config.p1_paths
        allow_lock = (
            cfg.allow_lockfiles_for_f4
            and context.diagnosis.failure_class == FailureClass.F4_DEPENDENCY_DRIFT
        )
        violations: list[str] = []
        root_resolved = context.repo_root.resolve()

        for raw in context.patch.changed_files:
            rel = normalize_rel_path(raw)
            parts = PurePosixPath(rel).parts
            if not parts or raw.startswith("/") or ".." in parts:
                violations.append(f"traversal/absolute path rejected: {raw}")
                continue
            if cfg.reject_non_ascii_paths and _has_homoglyph_or_control(rel):
                violations.append(f"non-ASCII/homoglyph path rejected: {rel}")
                continue
            if cfg.reject_symlinks:
                candidate = context.repo_root / rel
                cur = context.repo_root
                symlink_hit = candidate.is_symlink()
                for part in parts:
                    cur = cur / part
                    if cur.is_symlink():
                        symlink_hit = True
                        break
                if symlink_hit or (
                    candidate.exists() and not candidate.resolve().is_relative_to(root_resolved)
                ):
                    violations.append(f"symlink/escape path rejected: {rel}")
                    continue

            is_lock = any(_match_glob(rel, g) for g in cfg.lockfile_globs)
            if is_lock:
                if not allow_lock:
                    violations.append(f"lockfile edit denied outside F4: {rel}")
                continue

            if any(_match_glob(rel, g) for g in cfg.denied_globs):
                violations.append(f"protected path denied: {rel}")

        if violations:
            return PolicyDecision(
                rule_id="P1",
                verdict=PolicyVerdict.DENY,
                reason=violations[0],
                details=tuple(violations),
            )
        return PolicyDecision(
            rule_id="P1",
            verdict=PolicyVerdict.ALLOW,
            reason="All touched paths permitted",
        )

    def _eval_p2(
        self,
        context: PolicyContext,
        pre_map: Mapping[str, str],
        post_map: Mapping[str, str],
    ) -> PolicyDecision:
        cfg = self.config.p2_test_integrity
        if not cfg.enabled:
            return PolicyDecision(rule_id="P2", verdict=PolicyVerdict.ALLOW, reason="Disabled")

        violations, _ = check_test_integrity(
            pre_sources=pre_map,
            post_sources=post_map,
            config=cfg,
        )
        if violations:
            details = tuple(f"{v.file_path}: {v.rule_detail}" for v in violations)
            return PolicyDecision(
                rule_id="P2",
                verdict=PolicyVerdict.DENY,
                reason=details[0],
                details=details,
            )

        changed = [normalize_rel_path(p) for p in context.patch.changed_files]
        if cfg.escalate_test_only_patch and changed and all(is_test_file_path(p) for p in changed):
            return PolicyDecision(
                rule_id="P2",
                verdict=PolicyVerdict.ESCALATE,
                reason="Test-only patch requires human review",
                details=tuple(changed),
            )

        return PolicyDecision(
            rule_id="P2",
            verdict=PolicyVerdict.ALLOW,
            reason="AST test integrity preserved",
        )

    def _eval_p3(self, context: PolicyContext) -> PolicyDecision:
        cfg = self.config.p3_diff_budget
        file_count = len(context.patch.changed_files)
        line_count = context.patch.added_lines + context.patch.deleted_lines
        reasons: list[str] = []
        if file_count > cfg.max_files:
            reasons.append(f"Changed files {file_count} exceeds max {cfg.max_files}")
        if line_count > cfg.max_changed_lines:
            reasons.append(f"Changed lines {line_count} exceeds max {cfg.max_changed_lines}")
        if reasons:
            return PolicyDecision(
                rule_id="P3",
                verdict=PolicyVerdict.DENY,
                reason="; ".join(reasons),
                details=tuple(reasons),
            )
        return PolicyDecision(
            rule_id="P3",
            verdict=PolicyVerdict.ALLOW,
            reason=f"Diff budget ok ({file_count} files, {line_count} lines)",
        )

    def _eval_p4(
        self,
        context: PolicyContext,
        pre_map: Mapping[str, str],
        post_map: Mapping[str, str],
    ) -> PolicyDecision:
        cfg = self.config.p4_dangerous_constructs
        if not cfg.enabled:
            return PolicyDecision(rule_id="P4", verdict=PolicyVerdict.ALLOW, reason="Disabled")

        findings: list[str] = []
        for rel in sorted(pre_map.keys() | post_map.keys()):
            if not rel.endswith(".py"):
                continue
            pre_hits = _scan_dangerous_hits(
                pre_map.get(rel, ""),
                forbidden_calls=cfg.forbidden_calls,
                forbidden_modules=cfg.forbidden_modules,
                forbidden_env_reads=cfg.forbidden_env_reads,
                forbid_shell_true=cfg.forbid_subprocess_shell_true,
            )
            post_hits = _scan_dangerous_hits(
                post_map.get(rel, ""),
                forbidden_calls=cfg.forbidden_calls,
                forbidden_modules=cfg.forbidden_modules,
                forbidden_env_reads=cfg.forbidden_env_reads,
                forbid_shell_true=cfg.forbid_subprocess_shell_true,
            )
            delta = post_hits - pre_hits
            for key, count in sorted(delta.items()):
                if count > 0:
                    findings.append(f"{rel}: introduced forbidden construct {key} (x{count})")

        if findings:
            return PolicyDecision(
                rule_id="P4",
                verdict=PolicyVerdict.DENY,
                reason=findings[0],
                details=tuple(findings),
            )

        if cfg.run_overfit_guard and context.post_patch_sources:
            try:
                verify_not_overfitted(
                    workspace_root=context.repo_root,
                    pre_patch_sources=pre_map,
                    post_patch_sources=post_map,
                    raw_diff=context.patch.unified_diff,
                )
            except (OverfitPolicyError, SourceAnalysisLimitError) as exc:
                return PolicyDecision(
                    rule_id="P4",
                    verdict=PolicyVerdict.DENY,
                    reason=f"Overfit/hygiene guard rejected patch: {exc}",
                    details=(str(exc),),
                )

        return PolicyDecision(
            rule_id="P4",
            verdict=PolicyVerdict.ALLOW,
            reason="No dangerous AST constructs or overfitting detected",
        )

    def _eval_p5(self, context: PolicyContext) -> PolicyDecision:
        if not self.config.p5_secret_scan.enabled:
            return PolicyDecision(rule_id="P5", verdict=PolicyVerdict.ALLOW, reason="Disabled")
        added = _added_diff_lines(context.patch.unified_diff)
        labels = detect_secret_labels(added)
        if labels:
            return PolicyDecision(
                rule_id="P5",
                verdict=PolicyVerdict.DENY,
                reason=f"Secret-shaped tokens detected in added diff lines: {', '.join(labels)}",
                details=labels,
            )
        return PolicyDecision(
            rule_id="P5",
            verdict=PolicyVerdict.ALLOW,
            reason="Zero secrets detected in added lines",
        )

    def _eval_p6(self, context: PolicyContext) -> PolicyDecision:
        cfg = self.config.p6_required_evidence
        rep = context.verification
        missing: list[str] = []
        if rep.reproduction_runs < cfg.min_reproduction_runs:
            missing.append(
                f"reproduction_runs={rep.reproduction_runs} < {cfg.min_reproduction_runs}"
            )
        if cfg.require_reproduced_baseline and rep.reproduced_failures < 1:
            missing.append("baseline failure was not reproduced")
        if cfg.require_passed_after_patch and not rep.passed_after_patch:
            missing.append("tests did not pass after patch")
        if cfg.require_lint_clean and not rep.lint_clean:
            missing.append("lint check not clean")
        if cfg.require_typecheck_clean and not rep.typecheck_clean:
            missing.append("typecheck not clean")
        if cfg.require_network_disabled and not rep.network_disabled:
            missing.append("verification ran without network disabled")
        if cfg.require_read_only_rootfs and not rep.read_only_rootfs:
            missing.append("verification ran without read-only rootfs")

        if missing:
            return PolicyDecision(
                rule_id="P6",
                verdict=PolicyVerdict.DENY,
                reason=missing[0],
                details=tuple(missing),
            )
        return PolicyDecision(
            rule_id="P6",
            verdict=PolicyVerdict.ALLOW,
            reason="Verification evidence complete",
        )

    def _eval_p7(self, context: PolicyContext) -> PolicyDecision:
        min_conf = self.config.p7_confidence.min_confidence
        conf = context.diagnosis.confidence
        if conf < min_conf:
            return PolicyDecision(
                rule_id="P7",
                verdict=PolicyVerdict.ESCALATE,
                reason=f"Confidence {conf:.2f} < threshold {min_conf:.2f} (diagnosis-only)",
            )
        return PolicyDecision(
            rule_id="P7",
            verdict=PolicyVerdict.ALLOW,
            reason=f"Confidence {conf:.2f} >= {min_conf:.2f}",
        )

    def _eval_p8(self, context: PolicyContext) -> PolicyDecision:
        cfg = self.config.p8_depth_limit
        reasons: list[str] = []
        if context.repair_depth > cfg.max_depth:
            reasons.append(f"repair_depth {context.repair_depth} exceeds max {cfg.max_depth}")
        actor_lower = context.event.actor.strip().lower()
        if any(actor_lower == bot.lower() for bot in cfg.blocked_actors):
            reasons.append(f"self-repair loop actor blocked: {context.event.actor}")
        branch = context.event.base_branch.strip()
        if any(branch.startswith(pfx) for pfx in cfg.blocked_branch_prefixes):
            reasons.append(f"aegis branch recursion blocked: {branch}")

        if reasons:
            return PolicyDecision(
                rule_id="P8",
                verdict=PolicyVerdict.DENY,
                reason=reasons[0],
                details=tuple(reasons),
            )
        return PolicyDecision(
            rule_id="P8",
            verdict=PolicyVerdict.ALLOW,
            reason="Repair depth and actor within limit",
        )

    def evaluate(self, context: PolicyContext) -> PolicyEvaluationResult:
        """Evaluate P1..P8; DENY overrides ESCALATE overrides ALLOW."""
        pre_map, post_map = self._collect_source_maps(context)
        decisions = (
            self._eval_p1(context),
            self._eval_p2(context, pre_map, post_map),
            self._eval_p3(context),
            self._eval_p4(context, pre_map, post_map),
            self._eval_p5(context),
            self._eval_p6(context),
            self._eval_p7(context),
            self._eval_p8(context),
        )
        verdicts = {d.verdict for d in decisions}
        if PolicyVerdict.DENY in verdicts:
            overall = PolicyVerdict.DENY
        elif PolicyVerdict.ESCALATE in verdicts:
            overall = PolicyVerdict.ESCALATE
        else:
            overall = PolicyVerdict.ALLOW
        return PolicyEvaluationResult(verdict=overall, decisions=decisions)
