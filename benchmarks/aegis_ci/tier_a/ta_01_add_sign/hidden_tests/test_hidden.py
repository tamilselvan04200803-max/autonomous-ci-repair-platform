from pkg.core import add

def test_add_neg() -> None:
    assert add(-4, 9) == 5
    assert add(0, 7) == 7
