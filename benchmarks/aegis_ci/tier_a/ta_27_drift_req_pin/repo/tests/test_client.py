from pkg.client import min_ver_ok

def test_req() -> None:
    assert min_ver_ok() is True
