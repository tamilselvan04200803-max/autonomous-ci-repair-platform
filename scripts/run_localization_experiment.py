"""Run B0 vs B1 vs B2 localization experiment across Tier A FIX cases and apply Section 7.5 rule."""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]
from aegis.domain.models import Diagnosis, FailureClass
from aegis.graph.store import CodeGraphStore
from aegis.localization.localizer import (
    LocalizationExperimentResult,
    Localizer,
    select_localization_mode,
)

ROOT = Path(__file__).resolve().parent.parent
TIER_A_DIR = ROOT / "benchmarks" / "aegis_ci" / "tier_a"
OUT_PATH = ROOT / "docs" / "measurements" / "localization_experiment.json"

_CLASS_MAP: dict[str, FailureClass] = {
    "F1": FailureClass.F1_TEST_REGRESSION,
    "F2": FailureClass.F2_LINT_FORMAT,
    "F3": FailureClass.F3_TYPE_ERROR,
    "F4": FailureClass.F4_DEPENDENCY_DRIFT,
}


def run_experiment() -> dict[str, Any]:
    b0_hits = b1_hits = b2_hits = total = 0
    b0_tokens: list[int] = []
    b1_tokens: list[int] = []
    b2_tokens: list[int] = []
    rows: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        tmp_path = Path(tmp)
        for cdir in sorted(p for p in TIER_A_DIR.iterdir() if p.is_dir()):
            meta = yaml.safe_load((cdir / "meta.yaml").read_text(encoding="utf-8"))
            if meta["expected_outcome"] != "FIX":
                continue
            target_files = [str(x) for x in meta.get("target_files", [])]
            if not target_files:
                continue
            repo_dir = cdir / "repo"
            fclass = _CLASS_MAP.get(str(meta["failure_class"]), FailureClass.F1_TEST_REGRESSION)
            parts = str(meta["visible_cmd"]).split()
            cmd = [sys.executable, "-m", parts[0], *parts[1:]]
            proc = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True, check=False)
            output_blob = f"{proc.stdout}\n{proc.stderr}"
            diag = Diagnosis(
                failure_class=fclass,
                parser=parts[0],
                failing_command=str(meta["visible_cmd"]),
                error_summary=output_blob[:400],
                evidence_excerpt=output_blob[:2000],
                confidence=0.95,
            )

            graph_store = CodeGraphStore(tmp_path / f"{meta['id']}.db")
            graph_store.index_repo(repo_dir)
            localizer = Localizer(repo_dir, graph_store=graph_store, max_tokens=4000)

            m0 = localizer.localize("B0", diag)
            m1 = localizer.localize("B1", diag)
            m2 = localizer.localize("B2", diag)
            graph_store.close()

            h0 = any(t in m0.files for t in target_files)
            h1 = any(t in m1.files for t in target_files)
            h2 = any(t in m2.files for t in target_files)

            total += 1
            b0_hits += int(h0)
            b1_hits += int(h1)
            b2_hits += int(h2)
            b0_tokens.append(m0.total_tokens)
            b1_tokens.append(m1.total_tokens)
            b2_tokens.append(m2.total_tokens)
            rows.append(
                {
                    "case_id": meta["id"],
                    "targets": target_files,
                    "b0_hit": h0,
                    "b0_tokens": m0.total_tokens,
                    "b1_hit": h1,
                    "b1_tokens": m1.total_tokens,
                    "b2_hit": h2,
                    "b2_tokens": m2.total_tokens,
                }
            )

    exp = LocalizationExperimentResult(
        b0_pass_rate=b0_hits / total if total else 0.0,
        b0_median_tokens=int(statistics.median(b0_tokens)) if b0_tokens else 0,
        b1_pass_rate=b1_hits / total if total else 0.0,
        b1_median_tokens=int(statistics.median(b1_tokens)) if b1_tokens else 0,
        b2_pass_rate=b2_hits / total if total else 0.0,
        b2_median_tokens=int(statistics.median(b2_tokens)) if b2_tokens else 0,
    )
    selected = select_localization_mode(exp)
    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "n_cases": total,
        "b0": {"recall_at_k": round(exp.b0_pass_rate, 4), "median_tokens": exp.b0_median_tokens},
        "b1": {"recall_at_k": round(exp.b1_pass_rate, 4), "median_tokens": exp.b1_median_tokens},
        "b2": {"recall_at_k": round(exp.b2_pass_rate, 4), "median_tokens": exp.b2_median_tokens},
        "selected_mode": selected,
        "section_7_5_rule": (
            "Keep B2 if B2 recall >= B1 + 0.05 OR (|B2 - B1| < 0.05 and B2 tokens <= 0.70 * B1)."
        ),
        "cases": rows,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"[LOCALIZATION EXPERIMENT] n={total} "
        f"B0={exp.b0_pass_rate:.3f} ({exp.b0_median_tokens} tok), "
        f"B1={exp.b1_pass_rate:.3f} ({exp.b1_median_tokens} tok), "
        f"B2={exp.b2_pass_rate:.3f} ({exp.b2_median_tokens} tok) -> Selected: {selected}"
    )
    return payload


if __name__ == "__main__":
    run_experiment()
