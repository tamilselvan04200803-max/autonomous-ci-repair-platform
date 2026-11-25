"""Bounded LLM repair loop, diff normalization, cassettes, and budget governor."""

from aegis.repair.cassettes import (
    CassetteEntry,
    CassetteMissError,
    CassetteStore,
    compute_cassette_key,
)
from aegis.repair.diff_utils import (
    DiffValidationError,
    apply_diff_to_copy,
    build_patch_from_proposal,
    edits_to_unified_diff,
    validate_unified_diff,
)
from aegis.repair.governor import BudgetConfig, BudgetExceededError, BudgetGovernor
from aegis.repair.llm import (
    LLMClient,
    LLMClientError,
    LLMResponse,
    OpenAICompatibleClient,
    RecordedReplayClient,
)
from aegis.repair.loop import RepairLoop, RepairLoopConfig, RepairLoopResult
from aegis.repair.models import RepairProposal

__all__ = [
    "BudgetConfig",
    "BudgetExceededError",
    "BudgetGovernor",
    "CassetteEntry",
    "CassetteMissError",
    "CassetteStore",
    "DiffValidationError",
    "LLMClient",
    "LLMClientError",
    "LLMResponse",
    "OpenAICompatibleClient",
    "RecordedReplayClient",
    "RepairLoop",
    "RepairLoopConfig",
    "RepairLoopResult",
    "RepairProposal",
    "apply_diff_to_copy",
    "build_patch_from_proposal",
    "compute_cassette_key",
    "edits_to_unified_diff",
    "validate_unified_diff",
]
