from pkg.core import apply_discount

def test_discount_extra() -> None:
    assert apply_discount(50.0, 10.0) == 45.0
    assert apply_discount(200.0, 0.0) == 200.0
