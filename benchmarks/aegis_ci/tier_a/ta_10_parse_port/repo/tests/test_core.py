from pkg.core import is_valid_port

def test_port() -> None:
    assert is_valid_port(0) is False
