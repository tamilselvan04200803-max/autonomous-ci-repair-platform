"""Statistical metrics and Wilson 95% confidence intervals for Aegis-CI benchmarks."""

from __future__ import annotations

import math
from dataclasses import dataclass

# 97.5th percentile of standard normal distribution for two-sided 95% CI.
_Z_95 = 1.959963984540054


@dataclass(frozen=True, slots=True)
class WilsonInterval:
    """Proportion estimate with Wilson score 95% confidence interval."""

    successes: int
    total: int
    rate: float
    lower: float
    upper: float

    def to_dict(self) -> dict[str, int | float]:
        return {
            "successes": self.successes,
            "total": self.total,
            "rate": round(self.rate, 4),
            "ci_95_lower": round(self.lower, 4),
            "ci_95_upper": round(self.upper, 4),
        }


def wilson_ci(successes: int, total: int, *, z: float = _Z_95) -> WilsonInterval:
    """Compute Wilson score 95% confidence interval for a binomial proportion."""
    if total <= 0:
        return WilsonInterval(successes=0, total=0, rate=0.0, lower=0.0, upper=0.0)
    if successes < 0 or successes > total:
        raise ValueError(f"successes ({successes}) must be in [0, {total}]")
    p = successes / total
    z2 = z * z
    denom = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denom
    half = (z / denom) * math.sqrt((p * (1.0 - p) / total) + (z2 / (4.0 * total * total)))
    return WilsonInterval(
        successes=successes,
        total=total,
        rate=p,
        lower=0.0 if successes == 0 else max(0.0, center - half),
        upper=1.0 if successes == total else min(1.0, center + half),
    )


def summarize_rate(successes: int, total: int) -> dict[str, int | float]:
    """Return a JSON-serializable summary dict with rate and Wilson 95% CI."""
    return wilson_ci(successes, total).to_dict()
