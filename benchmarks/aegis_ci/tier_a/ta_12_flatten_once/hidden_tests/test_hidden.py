from pkg.core import flatten_once

def test_flat_empty() -> None:
    assert flatten_once([[], [4, 5]]) == [4, 5]
