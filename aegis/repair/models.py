"""Pydantic schema models for bounded repair proposals and LLM responses."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aegis.domain.models import SearchReplaceEdit  # noqa: TC001


class RepairProposal(BaseModel):
    """Structured LLM repair output validated strictly before diff generation."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    rationale: str = Field(min_length=1, max_length=2000)
    edits: tuple[SearchReplaceEdit, ...] = ()
    unified_diff: str = ""

    @model_validator(mode="after")
    def _require_edits_or_diff(self) -> RepairProposal:
        if not self.edits and not self.unified_diff.strip():
            raise ValueError("RepairProposal must contain at least one edit or unified_diff")
        return self
