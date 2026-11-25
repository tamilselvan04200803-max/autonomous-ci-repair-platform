from pkg.core import clamp

def test_clamp() -> None:
    assert clamp(15, 0, 10) == 10
