from pkg.client import preview

def test_preview() -> None:
    assert preview('box') == 'ok:box'
