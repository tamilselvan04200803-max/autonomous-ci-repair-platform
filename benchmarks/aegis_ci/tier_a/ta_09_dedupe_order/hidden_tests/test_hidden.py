from pkg.core import dedupe_preserve

def test_dedupe_more() -> None:
    assert dedupe_preserve(['z', 'a', 'z']) == ['z', 'a']
