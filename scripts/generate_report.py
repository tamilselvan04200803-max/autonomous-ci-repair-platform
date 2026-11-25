"""Run replay benchmark and regenerate verified README/docs metric tables."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from aegis.bench.runner import run_benchmark_replay

ROOT = Path(__file__).resolve().parent.parent
RESULT_PATH = ROOT / "benchmarks" / "results" / "tier_a_replay.json"
AEGIS_DOC_PATH = ROOT / "docs" / "AEGIS_CI.md"

_BEGIN_MARKER = "<!-- BEGIN_GENERATED_BENCHMARK_TABLE -->"
_END_MARKER = "<!-- END_GENERATED_BENCHMARK_TABLE -->"


def render_markdown_table(payload: dict[str, Any]) -> str:
    m = payload["metrics"]

    def _fmt_rate(key: str) -> str:
        entry = m[key]
        pct = f"{entry['rate'] * 100:.1f}%"
        ci = f"[{entry['ci_95_lower'] * 100:.1f}%, {entry['ci_95_upper'] * 100:.1f}%]"
        return f"{pct} ({entry['successes']}/{entry['total']}) | {ci}"

    lines = [
        _BEGIN_MARKER,
        f"*Generated from `benchmarks/results/tier_a_replay.json` "
        f"(git `{payload['git_sha']}`, mode `{payload['mode']}`, "
        f"backend `{payload['execution_backend']}`, n_tier_a={payload['n_tier_a']}, "
        f"n_adversarial={payload['n_adversarial']}).*",
        "",
        "| Metric | Result (n/N) | Wilson 95% CI |",
        "| --- | --- | --- |",
        f"| Verified-fix rate (FIX cases) | {_fmt_rate('verified_fix_rate')} |",
        f"| False-fix rate (passes visible, fails hidden) | {_fmt_rate('false_fix_rate')} |",
        f"| Gate false-deny rate on oracle patches | {_fmt_rate('gate_false_deny_rate')} |",
        f"| Refusal precision (Flaky + Env-unfixable) | {_fmt_rate('refusal_precision')} |",
        f"| Flaky recall | {_fmt_rate('flaky_recall')} |",
        f"| Escalation accuracy (ambiguous / >3 files) | {_fmt_rate('escalation_accuracy')} |",
        f"| Attack success rate (Gate **ON**) | {_fmt_rate('attack_success_rate_gated')} |",
        (
            f"| Attack success rate (Gate **OFF** ablation) | "
            f"{_fmt_rate('attack_success_rate_ungated')} |"
        ),
        f"| Median wall-clock per case | {m['median_wall_clock_ms']} ms | — |",
        f"| Median tokens per fixed case (cassette) | {m['median_tokens_per_fixed_case']} | — |",
        _END_MARKER,
    ]
    return "\n".join(lines)


def inject_table(doc_path: Path, table_md: str) -> None:
    if not doc_path.exists():
        return
    text = doc_path.read_text(encoding="utf-8")
    if _BEGIN_MARKER in text and _END_MARKER in text:
        before = text.split(_BEGIN_MARKER, 1)[0]
        after = text.split(_END_MARKER, 1)[1]
        doc_path.write_text(f"{before}{table_md}{after}", encoding="utf-8")


def main() -> int:
    report = run_benchmark_replay(ROOT)
    report.write_json(RESULT_PATH)
    table_md = render_markdown_table(report.payload)
    inject_table(AEGIS_DOC_PATH, table_md)
    print(f"[REPORT OK] Wrote {RESULT_PATH}")
    print(json.dumps(report.payload["metrics"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
