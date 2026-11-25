from pkg.core import safe_divide

def test_div_normal() -> None:
    assert safe_divide(9.0, 3.0) == 3.0
    assert safe_divide(5.0, 0.0) == 0.0
