"""Contract test for Pydantic v2.14.4 frozen models and strict JSON round-trip.

Docs URL: https://docs.pydantic.dev/latest/concepts/models/
Docs URL: https://docs.pydantic.dev/latest/concepts/json/
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import BaseModel, ConfigDict, ValidationError


class _SampleFrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    run_id: str
    when: datetime
    tags: tuple[str, ...]


@pytest.mark.contract
def test_pydantic_v2_frozen_and_json_contract() -> None:
    item = _SampleFrozenModel(
        run_id="run-1",
        when=datetime(2026, 11, 25, 12, 0, 0, tzinfo=UTC),
        tags=("a", "b"),
    )
    with pytest.raises(ValidationError):
        item.run_id = "mutated"  # type: ignore[misc]

    dumped = item.model_dump_json()
    restored = _SampleFrozenModel.model_validate_json(dumped)
    assert restored == item
    assert item.model_dump(mode="json")["tags"] == ["a", "b"]
