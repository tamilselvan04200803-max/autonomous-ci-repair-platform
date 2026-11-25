"""Aegis-CI benchmark runner, metrics, and Wilson confidence intervals."""

from aegis.bench.metrics import WilsonInterval, summarize_rate, wilson_ci
from aegis.bench.runner import BenchmarkReport, run_benchmark_replay

__all__ = [
    "BenchmarkReport",
    "WilsonInterval",
    "run_benchmark_replay",
    "summarize_rate",
    "wilson_ci",
]
