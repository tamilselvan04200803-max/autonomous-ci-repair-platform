"""TDD tests for Milestone A5: Code Graph, Localizer (B0/B1/B2), and MCP v2 Server."""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

import anyio
import pytest
from aegis.domain.models import Diagnosis, FailureClass
from aegis.graph.frontend import PythonAstFrontend
from aegis.graph.store import CodeGraphStore
from aegis.localization.localizer import (
    LocalizationExperimentResult,
    Localizer,
    select_localization_mode,
)
from aegis.mcp.server import ALLOWED_READONLY_TOOLS, create_code_graph_mcp_server
from mcp.server.mcpserver.exceptions import ToolError


def _build_sample_repo(root: Path) -> Path:
    (root / "pkg").mkdir(parents=True, exist_ok=True)
    (root / "tests").mkdir(parents=True, exist_ok=True)
    (root / "pkg" / "__init__.py").write_text("", encoding="utf-8")
    (root / "pkg" / "pricing.py").write_text(
        textwrap.dedent(
            '''\
            """Pricing helpers."""

            def apply_discount(price: float, rate: float) -> float:
                if rate < 0:
                    raise ValueError("negative rate")
                return round(price * (1.0 - rate), 2)


            def compute_total(price: float, tax: float, rate: float) -> float:
                discounted = apply_discount(price, rate)
                return round(discounted * (1.0 + tax), 2)
            '''
        ),
        encoding="utf-8",
    )
    (root / "pkg" / "invoice.py").write_text(
        textwrap.dedent(
            '''\
            from pkg.pricing import compute_total


            class InvoiceBuilder:
                def build_line(self, amount: float) -> float:
                    return compute_total(amount, 0.1, 0.2)

                def dynamic_hook(self, hook: object) -> object:
                    return getattr(hook, "run")()
            '''
        ),
        encoding="utf-8",
    )
    (root / "pkg" / "unrelated.py").write_text(
        textwrap.dedent(
            """\
            def format_banner(title: str) -> str:
                return f"== {title} =="
            """
        ),
        encoding="utf-8",
    )
    (root / "tests" / "test_invoice.py").write_text(
        textwrap.dedent(
            """\
            from pkg.invoice import InvoiceBuilder


            def test_invoice_total() -> None:
                builder = InvoiceBuilder()
                assert builder.build_line(100.0) == 88.0
            """
        ),
        encoding="utf-8",
    )
    return root


def test_python_ast_frontend_extracts_nodes_calls_and_test_edges(tmp_path: Path) -> None:
    repo = _build_sample_repo(tmp_path)
    frontend = PythonAstFrontend()

    pricing_res = frontend.parse_file(
        repo / "pkg" / "pricing.py",
        "pkg/pricing.py",
        (repo / "pkg" / "pricing.py").read_text(encoding="utf-8"),
    )
    node_kinds = {n.qualified_name: n.kind for n in pricing_res.nodes}
    assert node_kinds["pkg.pricing"] == "module"
    assert node_kinds["pkg.pricing.apply_discount"] == "function"
    assert node_kinds["pkg.pricing.compute_total"] == "function"

    invoice_res = frontend.parse_file(
        repo / "pkg" / "invoice.py",
        "pkg/invoice.py",
        (repo / "pkg" / "invoice.py").read_text(encoding="utf-8"),
    )
    assert any(n.kind == "class" and n.name == "InvoiceBuilder" for n in invoice_res.nodes)
    assert any(e.edge_type == "calls" and e.resolved is False for e in invoice_res.calls)

    test_res = frontend.parse_file(
        repo / "tests" / "test_invoice.py",
        "tests/test_invoice.py",
        (repo / "tests" / "test_invoice.py").read_text(encoding="utf-8"),
    )
    assert any(n.kind == "test" and n.name == "test_invoice_total" for n in test_res.nodes)
    assert any(e.edge_type == "tests" for e in test_res.test_edges)


def test_code_graph_store_incremental_index_and_impact_queries(tmp_path: Path) -> None:
    repo = _build_sample_repo(tmp_path)
    db_path = tmp_path / "graph.db"

    with CodeGraphStore(db_path) as store:
        stats1 = store.index_repo(repo)
        assert stats1.added_files == 5
        assert stats1.skipped_files == 0

        stats2 = store.index_repo(repo)
        assert stats2.added_files == 0
        assert stats2.updated_files == 0
        assert stats2.skipped_files == 5

        matches = store.lookup_symbol("apply_discount")
        assert len(matches) == 1
        assert matches[0].rel_path == "pkg/pricing.py"

        callers = store.find_callers("pkg.pricing.apply_discount")
        caller_names = {c.src_qualified_name for c in callers}
        assert "pkg.pricing.compute_total" in caller_names

        callees = store.find_callees("pkg.invoice.InvoiceBuilder.build_line")
        callee_names = {c.dst_name for c in callees}
        assert any("compute_total" in name for name in callee_names)

        impact = store.analyze_impact(["pkg/pricing.py"], hops=3)
        assert "pkg/invoice.py" in impact.impacted_files
        assert "tests/test_invoice.py" in impact.affected_test_files

        # Edit pricing.py: only that file is re-indexed
        (repo / "pkg" / "pricing.py").write_text(
            textwrap.dedent(
                """\
                def apply_discount(price: float, rate: float) -> float:
                    return round(price * (1.0 - rate), 2)
                """
            ),
            encoding="utf-8",
        )
        stats3 = store.index_repo(repo)
        assert stats3.updated_files == 1
        assert stats3.skipped_files == 4
        assert store.lookup_symbol("compute_total") == []


def test_localizer_b0_b1_b2_and_preregistered_selection_rule(tmp_path: Path) -> None:
    repo = _build_sample_repo(tmp_path)
    db_path = tmp_path / "graph.db"
    with CodeGraphStore(db_path) as store:
        store.index_repo(repo)
        localizer = Localizer(repo_root=repo, graph_store=store, max_tokens=2000)

        diagnosis = Diagnosis(
            failure_class=FailureClass.F1_TEST_REGRESSION,
            parser="pytest",
            failing_command="pytest tests/test_invoice.py",
            error_summary="AssertionError in test_invoice_total",
            failing_test_ids=("tests/test_invoice.py::test_invoice_total",),
            error_files=("tests/test_invoice.py",),
            confidence=0.95,
            evidence_excerpt='File "tests/test_invoice.py", line 6, in test_invoice_total',
        )

        m_b0 = localizer.localize("B0", diagnosis)
        m_b1 = localizer.localize("B1", diagnosis)
        m_b2 = localizer.localize("B2", diagnosis)

        assert m_b0.method == "B0"
        assert m_b1.method == "B1"
        assert m_b2.method == "B2"
        assert m_b2.total_tokens <= 2000
        assert "tests/test_invoice.py" in m_b1.files
        assert "tests/test_invoice.py" in m_b2.files
        # B2 expands through graph k-hop reachability into production code even when traceback only names test file
        assert "pkg/invoice.py" in m_b2.files
        assert "pkg/pricing.py" in m_b2.files

    # Pre-registered Section 7.5 selection rule checks:
    # 1) B2 wins on accuracy >= B1 + 5%
    assert (
        select_localization_mode(
            LocalizationExperimentResult(
                b0_pass_rate=0.50,
                b0_median_tokens=4000,
                b1_pass_rate=0.60,
                b1_median_tokens=1500,
                b2_pass_rate=0.66,
                b2_median_tokens=1600,
            )
        )
        == "B2"
    )
    # 2) B2 wins on tie if tokens <= 70% of B1
    assert (
        select_localization_mode(
            LocalizationExperimentResult(
                b0_pass_rate=0.50,
                b0_median_tokens=4000,
                b1_pass_rate=0.70,
                b1_median_tokens=2000,
                b2_pass_rate=0.70,
                b2_median_tokens=1300,
            )
        )
        == "B2"
    )
    # 3) Default to simpler B1 when B2 neither beats by +5% nor reduces tokens by >=30%
    assert (
        select_localization_mode(
            LocalizationExperimentResult(
                b0_pass_rate=0.50,
                b0_median_tokens=4000,
                b1_pass_rate=0.70,
                b1_median_tokens=1500,
                b2_pass_rate=0.72,
                b2_median_tokens=1400,
            )
        )
        == "B1"
    )


def test_mcp_server_exposes_only_four_readonly_tools(tmp_path: Path) -> None:
    repo = _build_sample_repo(tmp_path)
    db_path = tmp_path / "graph.db"
    with CodeGraphStore(db_path) as store:
        store.index_repo(repo)
        server = create_code_graph_mcp_server(store)

        async def exercise() -> None:
            tools = await server.list_tools()
            names = {tool.name for tool in tools}
            assert names == ALLOWED_READONLY_TOOLS
            assert names == {"lookup_symbol", "find_callers", "find_callees", "analyze_impact"}

            for tool in tools:
                assert tool.annotations is not None
                assert tool.annotations.read_only_hint is True
                assert tool.annotations.destructive_hint is False

            res = await server.call_tool("lookup_symbol", {"query": "compute_total"})
            data = json.loads(res.content[0].text)
            assert any(item["rel_path"] == "pkg/pricing.py" for item in data["matches"])

            impact_res = await server.call_tool(
                "analyze_impact", {"targets": ["pkg/pricing.py"], "hops": 2}
            )
            impact_data = json.loads(impact_res.content[0].text)
            assert "pkg/invoice.py" in impact_data["impacted_files"]

            with pytest.raises(ToolError):
                await server.call_tool("apply_patch", {"diff": ""})

        anyio.run(exercise)
