"""Language frontend protocol and stdlib-AST Python graph extractor."""

from __future__ import annotations

import ast
import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

NodeKind = Literal["module", "class", "function", "test"]
EdgeType = Literal["defines", "imports", "calls", "tests"]


@dataclass(frozen=True, slots=True)
class GraphNode:
    node_id: str
    rel_path: str
    kind: NodeKind
    name: str
    qualified_name: str
    start_line: int
    end_line: int
    signature: str = ""


@dataclass(frozen=True, slots=True)
class GraphEdge:
    src_id: str
    dst_name: str
    edge_type: EdgeType
    resolved: bool
    line_no: int = 0
    dst_id: str | None = None


@dataclass(frozen=True, slots=True)
class FileIndexResult:
    rel_path: str
    module_name: str
    content_sha256: str
    nodes: tuple[GraphNode, ...]
    edges: tuple[GraphEdge, ...]
    imports_map: dict[str, str]
    parse_error: str | None = None

    @property
    def calls(self) -> tuple[GraphEdge, ...]:
        return tuple(e for e in self.edges if e.edge_type == "calls")

    @property
    def test_edges(self) -> tuple[GraphEdge, ...]:
        return tuple(e for e in self.edges if e.edge_type == "tests")

    @property
    def imports(self) -> tuple[GraphEdge, ...]:
        return tuple(e for e in self.edges if e.edge_type == "imports")


class LanguageFrontend(Protocol):
    """Protocol implemented by language-specific AST extractors."""

    @property
    def language(self) -> str: ...

    @property
    def extensions(self) -> tuple[str, ...]: ...

    def parse_file(self, path: Path, rel_path: str, source: str) -> FileIndexResult: ...


def normalize_rel_path(rel_path: str) -> str:
    return rel_path.replace("\\", "/").lstrip("./")


def module_name_from_rel_path(rel_path: str) -> str:
    norm = normalize_rel_path(rel_path)
    if norm.endswith("/__init__.py"):
        norm = norm[: -len("/__init__.py")]
    elif norm == "__init__.py":
        norm = "__init__"
    elif norm.endswith(".py"):
        norm = norm[: -len(".py")]
    parts = [p for p in norm.split("/") if p]
    return ".".join(parts) if parts else "__root__"


def compute_content_sha256(source: str) -> str:
    normalized = source.replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _resolve_relative_module(current_module: str, target_mod: str | None, level: int) -> str:
    if level <= 0:
        return target_mod or ""
    parts = current_module.split(".")
    # Step up from module to containing package first, then level - 1
    base_parts = parts[: len(parts) - level] if len(parts) >= level else []
    if target_mod:
        return ".".join([*base_parts, target_mod]) if base_parts else target_mod
    return ".".join(base_parts)


def _format_signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    args = [arg.arg for arg in node.args.posonlyargs + node.args.args]
    if node.args.vararg is not None:
        args.append(f"*{node.args.vararg.arg}")
    args.extend(arg.arg for arg in node.args.kwonlyargs)
    if node.args.kwarg is not None:
        args.append(f"**{node.args.kwarg.arg}")
    prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
    return f"{prefix} {node.name}({', '.join(args)})"


def _is_test_function(name: str, rel_path: str, parent_class: str | None) -> bool:
    norm = normalize_rel_path(rel_path)
    in_test_file = (
        norm.startswith("tests/")
        or "/tests/" in norm
        or Path(norm).name.startswith("test_")
        or Path(norm).name.endswith("_test.py")
    )
    if name.startswith("test_"):
        return True
    return bool(
        in_test_file
        and parent_class
        and parent_class.startswith("Test")
        and name.startswith("test")
    )


def _dotted_expr(expr: ast.AST) -> str | None:
    if isinstance(expr, ast.Name):
        return expr.id
    if isinstance(expr, ast.Attribute):
        prefix = _dotted_expr(expr.value)
        if prefix is not None:
            return f"{prefix}.{expr.attr}"
    return None


class PythonAstFrontend:
    """Deterministic Python code-graph extractor built purely on stdlib `ast`."""

    @property
    def language(self) -> str:
        return "python"

    @property
    def extensions(self) -> tuple[str, ...]:
        return (".py",)

    def parse_file(self, path: Path, rel_path: str, source: str) -> FileIndexResult:
        del path
        norm_rel = normalize_rel_path(rel_path)
        mod_name = module_name_from_rel_path(norm_rel)
        content_hash = compute_content_sha256(source)

        try:
            tree = ast.parse(source)
        except SyntaxError as exc:
            mod_node = GraphNode(
                node_id=mod_name,
                rel_path=norm_rel,
                kind="module",
                name=mod_name.rsplit(".", 1)[-1],
                qualified_name=mod_name,
                start_line=1,
                end_line=max(1, len(source.splitlines())),
                signature=mod_name,
            )
            return FileIndexResult(
                rel_path=norm_rel,
                module_name=mod_name,
                content_sha256=content_hash,
                nodes=(mod_node,),
                edges=(),
                imports_map={},
                parse_error=f"SyntaxError line {exc.lineno}: {exc.msg}",
            )

        lines = source.splitlines()
        nodes: list[GraphNode] = [
            GraphNode(
                node_id=mod_name,
                rel_path=norm_rel,
                kind="module",
                name=mod_name.rsplit(".", 1)[-1],
                qualified_name=mod_name,
                start_line=1,
                end_line=max(1, len(lines)),
                signature=mod_name,
            )
        ]
        edges: list[GraphEdge] = []
        imports_map: dict[str, str] = {}
        local_defs: dict[str, str] = {}
        class_methods: dict[str, set[str]] = {}

        # Pre-collect top-level classes, functions, and imports for intra-module resolution
        for stmt in tree.body:
            if isinstance(stmt, ast.Import):
                for alias in stmt.names:
                    bound = alias.asname or alias.name.split(".")[0]
                    imports_map[bound] = alias.name if alias.asname else alias.name.split(".")[0]
                    if "." in alias.name and not alias.asname:
                        imports_map[alias.name] = alias.name
                    edges.append(
                        GraphEdge(
                            src_id=mod_name,
                            dst_name=alias.name,
                            edge_type="imports",
                            resolved=True,
                            line_no=stmt.lineno,
                        )
                    )
            elif isinstance(stmt, ast.ImportFrom):
                base_mod = _resolve_relative_module(mod_name, stmt.module, stmt.level)
                for alias in stmt.names:
                    if alias.name == "*":
                        continue
                    target = f"{base_mod}.{alias.name}" if base_mod else alias.name
                    bound = alias.asname or alias.name
                    imports_map[bound] = target
                    edges.append(
                        GraphEdge(
                            src_id=mod_name,
                            dst_name=target,
                            edge_type="imports",
                            resolved=True,
                            line_no=stmt.lineno,
                        )
                    )
            elif isinstance(stmt, ast.ClassDef):
                cls_fqn = f"{mod_name}.{stmt.name}"
                local_defs[stmt.name] = cls_fqn
                methods: set[str] = set()
                for child in stmt.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        methods.add(child.name)
                class_methods[cls_fqn] = methods
            elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                local_defs[stmt.name] = f"{mod_name}.{stmt.name}"

        def resolve_callee(
            call_node: ast.Call,
            var_types: dict[str, str],
            current_class_fqn: str | None,
        ) -> tuple[str, bool]:
            func = call_node.func
            if isinstance(func, ast.Name):
                if func.id in {"getattr", "eval", "exec", "__import__"}:
                    return f"<dynamic:{func.id}>", False
                if func.id in local_defs:
                    return local_defs[func.id], True
                if func.id in imports_map:
                    return imports_map[func.id], True
                return func.id, False

            dotted = _dotted_expr(func)
            if dotted is not None:
                root, rest = dotted.split(".", 1)
                if root == "self" and current_class_fqn is not None:
                    method_name = rest.split(".", 1)[0]
                    if method_name in class_methods.get(current_class_fqn, set()):
                        return f"{current_class_fqn}.{rest}", True
                    return f"{current_class_fqn}.{rest}", False
                if root in var_types:
                    return f"{var_types[root]}.{rest}", True
                if root in imports_map:
                    return f"{imports_map[root]}.{rest}", True
                if root in local_defs:
                    return f"{local_defs[root]}.{rest}", True
                return dotted, False

            return "<dynamic:expr>", False

        def collect_var_types(body: list[ast.stmt]) -> dict[str, str]:
            inferred: dict[str, str] = {}
            for node in body:
                if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
                    target_cls: str | None = None
                    if isinstance(node.value.func, ast.Name):
                        cname = node.value.func.id
                        if cname in local_defs:
                            target_cls = local_defs[cname]
                        elif cname in imports_map:
                            target_cls = imports_map[cname]
                    if target_cls is not None:
                        for tgt in node.targets:
                            if isinstance(tgt, ast.Name):
                                inferred[tgt.id] = target_cls
                elif (
                    isinstance(node, ast.AnnAssign)
                    and isinstance(node.target, ast.Name)
                    and isinstance(node.annotation, ast.Name)
                ):
                    ann = node.annotation.id
                    if ann in local_defs:
                        inferred[node.target.id] = local_defs[ann]
                    elif ann in imports_map:
                        inferred[node.target.id] = imports_map[ann]
            return inferred

        def extract_calls_in_block(
            stmts: list[ast.stmt],
            owner_id: str,
            owner_is_test: bool,
            current_class_fqn: str | None,
        ) -> None:
            var_types = collect_var_types(stmts)
            for stmt in stmts:
                for sub in ast.walk(stmt):
                    if isinstance(sub, ast.Call):
                        dst_name, is_resolved = resolve_callee(sub, var_types, current_class_fqn)
                        edges.append(
                            GraphEdge(
                                src_id=owner_id,
                                dst_name=dst_name,
                                edge_type="calls",
                                resolved=is_resolved,
                                line_no=getattr(sub, "lineno", 0),
                            )
                        )
                        if owner_is_test and is_resolved:
                            edges.append(
                                GraphEdge(
                                    src_id=owner_id,
                                    dst_name=dst_name,
                                    edge_type="tests",
                                    resolved=True,
                                    line_no=getattr(sub, "lineno", 0),
                                )
                            )
                    elif owner_is_test and isinstance(sub, ast.Name):
                        target = imports_map.get(sub.id) or local_defs.get(sub.id)
                        if target is not None and isinstance(sub.ctx, ast.Load):
                            edges.append(
                                GraphEdge(
                                    src_id=owner_id,
                                    dst_name=target,
                                    edge_type="tests",
                                    resolved=True,
                                    line_no=getattr(sub, "lineno", 0),
                                )
                            )

        def visit_function(
            fn: ast.FunctionDef | ast.AsyncFunctionDef,
            parent_id: str,
            parent_class_name: str | None,
            current_class_fqn: str | None,
        ) -> None:
            fn_fqn = f"{parent_id}.{fn.name}"
            is_test = _is_test_function(fn.name, norm_rel, parent_class_name)
            kind: NodeKind = "test" if is_test else "function"
            nodes.append(
                GraphNode(
                    node_id=fn_fqn,
                    rel_path=norm_rel,
                    kind=kind,
                    name=fn.name,
                    qualified_name=fn_fqn,
                    start_line=fn.lineno,
                    end_line=fn.end_lineno or fn.lineno,
                    signature=_format_signature(fn),
                )
            )
            edges.append(
                GraphEdge(
                    src_id=parent_id,
                    dst_name=fn_fqn,
                    dst_id=fn_fqn,
                    edge_type="defines",
                    resolved=True,
                    line_no=fn.lineno,
                )
            )
            extract_calls_in_block(fn.body, fn_fqn, is_test, current_class_fqn)

        module_level_stmts: list[ast.stmt] = []
        for stmt in tree.body:
            if isinstance(stmt, ast.ClassDef):
                cls_fqn = f"{mod_name}.{stmt.name}"
                nodes.append(
                    GraphNode(
                        node_id=cls_fqn,
                        rel_path=norm_rel,
                        kind="class",
                        name=stmt.name,
                        qualified_name=cls_fqn,
                        start_line=stmt.lineno,
                        end_line=stmt.end_lineno or stmt.lineno,
                        signature=f"class {stmt.name}",
                    )
                )
                edges.append(
                    GraphEdge(
                        src_id=mod_name,
                        dst_name=cls_fqn,
                        dst_id=cls_fqn,
                        edge_type="defines",
                        resolved=True,
                        line_no=stmt.lineno,
                    )
                )
                for member in stmt.body:
                    if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        visit_function(member, cls_fqn, stmt.name, cls_fqn)
            elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit_function(stmt, mod_name, None, None)
            else:
                module_level_stmts.append(stmt)

        if module_level_stmts:
            extract_calls_in_block(module_level_stmts, mod_name, False, None)

        return FileIndexResult(
            rel_path=norm_rel,
            module_name=mod_name,
            content_sha256=content_hash,
            nodes=tuple(nodes),
            edges=tuple(edges),
            imports_map=imports_map,
            parse_error=None,
        )
