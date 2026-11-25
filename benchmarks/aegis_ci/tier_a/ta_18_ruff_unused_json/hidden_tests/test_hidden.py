from pkg.util import is_missing

def test_missing() -> None:
    assert is_missing(None) is True
