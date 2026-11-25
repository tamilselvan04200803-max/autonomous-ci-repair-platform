from pkg.core import is_valid_port

def test_port_bounds() -> None:
    assert is_valid_port(8080) is True
    assert is_valid_port(65536) is False
