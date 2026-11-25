from pkg.core import merge_counts

def test_merge_empty() -> None:
    assert merge_counts({}, {'x': 4}) == {'x': 4}
    assert merge_counts({'x': 1}, {'x': 2}) == {'x': 3}
