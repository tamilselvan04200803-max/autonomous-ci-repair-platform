from pkg.core import dedupe_preserve

def test_dedupe() -> None:
    assert dedupe_preserve(['b', 'a', 'b', 'c']) == ['b', 'a', 'c']
