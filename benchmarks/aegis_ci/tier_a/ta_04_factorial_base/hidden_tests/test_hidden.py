from pkg.core import factorial

def test_factorial_zero() -> None:
    assert factorial(0) == 1
    assert factorial(5) == 120
