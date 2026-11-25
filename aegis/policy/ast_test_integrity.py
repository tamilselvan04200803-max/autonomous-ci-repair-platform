"""AST-level test integrity verifier blocking test deletion, weakening, skips, and tautologies."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

from aegis.graph.frontend import normalize_rel_path

if TYPE_CHECKING:
    from collections.abc import Mapping

    from aegis.policy.config import P2TestIntegrityConfig

_SKIP_NAMES: frozenset[str] = frozenset(
    {
        "skip",
        "skipif",
        "xfail",
        "skipUnless",
        "skipIf",
        "importorskip",
        "SkipTest",
        "skipTest",
    }
)


@dataclass(frozen=True, slots=True)
class TestSignature:
    test_id: str
    assert_count: int
    has_skip: bool
    tautologies: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TestIntegrityViolation:
    file_path: str
    rule_detail: str


def is_test_file_path(rel_path: str) -> bool:
    """Return True if normalized relative path refers to a test file or conftest."""
    norm = normalize_rel_path(rel_path)
    parts = PurePosixPath(norm).parts
    if not parts:
        return False
    name = parts[-1]
    return (
        "tests" in parts[:-1]
        or "test" in parts[:-1]
        or name.startswith("test_")
        or name.endswith("_test.py")
        or name == "conftest.py"
    )


def _call_tail_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return ""


def _decorator_mentions_skip(dec: ast.AST) -> bool:
    for node in ast.walk(dec):
        if isinstance(node, ast.Name) and node.id in _SKIP_NAMES:
            return True
        if isinstance(node, ast.Attribute) and node.attr in _SKIP_NAMES:
            return True
    return False


def _eval_literal(node: ast.AST) -> tuple[bool, object]:
    if isinstance(node, ast.Constant):
        return True, node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        ok, inner = _eval_literal(node.operand)
        if ok:
            return True, not bool(inner)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        ok, inner = _eval_literal(node.operand)
        if ok and isinstance(inner, (int, float)) and not isinstance(inner, bool):
            return True, -inner
    return False, None


def _is_tautology_expr(test_expr: ast.AST) -> bool:
    ok, val = _eval_literal(test_expr)
    if ok:
        return bool(val)

    if (
        isinstance(test_expr, ast.Compare)
        and len(test_expr.ops) == 1
        and len(test_expr.comparators) == 1
    ):
        op = test_expr.ops[0]
        left = test_expr.left
        right = test_expr.comparators[0]
        left_dump = ast.dump(left, annotate_fields=False, include_attributes=False)
        right_dump = ast.dump(right, annotate_fields=False, include_attributes=False)
        if left_dump == right_dump and isinstance(op, (ast.Eq, ast.Is, ast.GtE, ast.LtE, ast.In)):
            return True
        ok_l, val_l = _eval_literal(left)
        ok_r, val_r = _eval_literal(right)
        if ok_l and ok_r:
            if isinstance(op, ast.Eq):
                return val_l == val_r
            if isinstance(op, ast.NotEq):
                return val_l != val_r
            if isinstance(op, ast.Is):
                return val_l is val_r
    return False


def _extract_test_signatures(source: str) -> dict[str, TestSignature]:
    if not source.strip():
        return {}
    tree = ast.parse(source)
    sigs: dict[str, TestSignature] = {}

    module_has_skip = False
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            for tgt in stmt.targets:
                if (
                    isinstance(tgt, ast.Name)
                    and tgt.id == "pytestmark"
                    and _decorator_mentions_skip(stmt.value)
                ):
                    module_has_skip = True

    def inspect_fn(
        fn: ast.FunctionDef | ast.AsyncFunctionDef,
        prefix: str = "",
    ) -> None:
        tid = f"{prefix}.{fn.name}" if prefix else fn.name
        assert_count = 0
        has_skip = module_has_skip or any(_decorator_mentions_skip(d) for d in fn.decorator_list)
        tautologies: list[str] = []

        for node in ast.walk(fn):
            if isinstance(node, ast.Assert):
                assert_count += 1
                if _is_tautology_expr(node.test):
                    tautologies.append(ast.unparse(node))
            elif isinstance(node, ast.Call):
                tail = _call_tail_name(node)
                if tail in _SKIP_NAMES:
                    has_skip = True
                elif tail in {"raises", "warns"} or tail.startswith("assert"):
                    assert_count += 1

        sigs[tid] = TestSignature(
            test_id=tid,
            assert_count=assert_count,
            has_skip=has_skip,
            tautologies=tuple(tautologies),
        )

    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)) and stmt.name.startswith(
            "test_"
        ):
            inspect_fn(stmt)
        elif isinstance(stmt, ast.ClassDef) and stmt.name.startswith("Test"):
            for child in stmt.body:
                if isinstance(
                    child, (ast.FunctionDef, ast.AsyncFunctionDef)
                ) and child.name.startswith("test"):
                    inspect_fn(child, prefix=stmt.name)

    return sigs


def check_test_integrity(
    *,
    pre_sources: Mapping[str, str],
    post_sources: Mapping[str, str],
    config: P2TestIntegrityConfig,
) -> tuple[list[TestIntegrityViolation], bool]:
    """Check base vs patched test files.

    Returns `(violations, touched_any_test_file)`.
    """
    violations: list[TestIntegrityViolation] = []
    touched_tests = False

    for raw_path in sorted(pre_sources.keys() | post_sources.keys()):
        rel = normalize_rel_path(raw_path)
        if not rel.endswith(".py") or not is_test_file_path(rel):
            continue
        touched_tests = True
        pre_src = pre_sources.get(rel, "")
        post_src = post_sources.get(rel, "")

        try:
            pre_sigs = _extract_test_signatures(pre_src)
            post_sigs = _extract_test_signatures(post_src)
        except SyntaxError as exc:
            violations.append(
                TestIntegrityViolation(rel, f"Patched test syntax invalid: {exc.msg}")
            )
            continue

        if config.forbid_test_deletion:
            missing = sorted(set(pre_sigs) - set(post_sigs))
            if missing:
                violations.append(
                    TestIntegrityViolation(rel, f"Deleted or renamed tests: {', '.join(missing)}")
                )

        for tid, pre_sig in pre_sigs.items():
            post_sig = post_sigs.get(tid)
            if post_sig is None:
                continue
            if config.forbid_assertion_reduction and post_sig.assert_count < pre_sig.assert_count:
                violations.append(
                    TestIntegrityViolation(
                        rel,
                        f"Assertion count dropped in {tid}: "
                        f"{pre_sig.assert_count} -> {post_sig.assert_count}",
                    )
                )

        if config.forbid_added_skips:
            for tid, post_sig in post_sigs.items():
                prior_sig = pre_sigs.get(tid)
                if post_sig.has_skip and (prior_sig is None or not prior_sig.has_skip):
                    violations.append(
                        TestIntegrityViolation(rel, f"Added skip/xfail/importorskip in {tid}")
                    )

        if config.forbid_tautologies:
            for tid, post_sig in post_sigs.items():
                pre_taut = set(pre_sigs[tid].tautologies) if tid in pre_sigs else set()
                new_taut = [t for t in post_sig.tautologies if t not in pre_taut]
                if new_taut:
                    violations.append(
                        TestIntegrityViolation(
                            rel,
                            f"Added tautology assert in {tid}: {', '.join(new_taut)}",
                        )
                    )

    return violations, touched_tests
