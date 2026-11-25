from pkg.core import apply_discount

def test_discount() -> None:
    assert apply_discount(100.0, 20.0) == 80.0
