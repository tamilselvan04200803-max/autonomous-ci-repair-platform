"""Flake detection by rerunning failing checks k times on unmodified base SHA (A3)."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

from aegis.domain.models import FailureClass

if TYPE_CHECKING:
    from collections.abc import Callable


class FlakeVerdict(StrEnum):
    """Outcome of k-run determinism reproduction probe."""

    DETERMINISTIC_FAILURE = "DETERMINISTIC_FAILURE"
    FLAKY = "FLAKY"
    NOT_REPRODUCED = "NOT_REPRODUCED"


@dataclass(frozen=True)
class FlakeCheckResult:
    """Result of rerunning baseline test command k times on unmodified commit."""

    verdict: FlakeVerdict
    failure_class: FailureClass | None
    exit_codes: tuple[int, ...]
    should_patch: bool
    reason: str


def detect_flaky_failure(run_once: Callable[[], int], *, runs: int = 3) -> FlakeCheckResult:
    """Run failing test suite ``runs`` times cleanly.

    Mixed pass/fail outcomes -> F5 FLAKY (never patch).
    All passing outcomes -> NOT_REPRODUCED (never patch).
    All failing outcomes -> DETERMINISTIC_FAILURE (safe to proceed).
    """
    if runs < 2:
        raise ValueError("Flake detection requires at least 2 runs")

    codes = tuple(int(run_once()) for _ in range(runs))
    passed_count = sum(1 for c in codes if c == 0)
    failed_count = runs - passed_count

    if passed_count > 0 and failed_count > 0:
        return FlakeCheckResult(
            verdict=FlakeVerdict.FLAKY,
            failure_class=FailureClass.F5_FLAKY,
            exit_codes=codes,
            should_patch=False,
            reason=(
                f"Mixed outcomes across {runs} runs "
                f"({failed_count} failed, {passed_count} passed)"
            ),
        )
    if failed_count == 0:
        return FlakeCheckResult(
            verdict=FlakeVerdict.NOT_REPRODUCED,
            failure_class=None,
            exit_codes=codes,
            should_patch=False,
            reason=f"Failure did not reproduce across {runs} runs (all exited 0)",
        )
    return FlakeCheckResult(
        verdict=FlakeVerdict.DETERMINISTIC_FAILURE,
        failure_class=None,
        exit_codes=codes,
        should_patch=True,
        reason=f"Deterministically failed {failed_count}/{runs} times",
    )
