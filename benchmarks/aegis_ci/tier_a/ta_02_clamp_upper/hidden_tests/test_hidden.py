from pkg.core import clamp

def test_clamp_bounds() -> None:
    assert clamp(-5, 0, 10) == 0
    assert clamp(5, 0, 10) == 5
    assert clamp(20, 1, 9) == 9
