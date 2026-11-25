from pkg.core import safe_divide

def test_div() -> None:
    assert safe_divide(10.0, 0.0, -1.0) == -1.0
