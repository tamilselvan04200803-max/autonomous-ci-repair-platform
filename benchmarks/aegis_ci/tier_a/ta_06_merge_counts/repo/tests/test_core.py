from pkg.core import merge_counts

def test_merge() -> None:
    assert merge_counts({'a': 2}, {'a': 3, 'b': 1}) == {'a': 5, 'b': 1}
