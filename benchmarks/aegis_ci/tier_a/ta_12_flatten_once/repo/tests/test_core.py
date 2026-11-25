from pkg.core import flatten_once

def test_flat() -> None:
    assert flatten_once([[1, 2], [3]]) == [1, 2, 3]
