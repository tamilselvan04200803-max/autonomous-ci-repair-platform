from pkg.util import banner

def test_banner() -> None:
    assert banner() == 'ready'
