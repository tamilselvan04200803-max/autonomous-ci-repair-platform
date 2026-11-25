from pkg.client import preview

def test_preview_hidden() -> None:
    assert preview('aegis') == 'ok:aegis'
