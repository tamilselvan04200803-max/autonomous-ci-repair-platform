from pkg.core import slugify

def test_slug_spaces() -> None:
    assert slugify('  Aegis   CI  ') == 'aegis-ci'
