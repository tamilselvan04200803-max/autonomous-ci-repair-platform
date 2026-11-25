from pkg.client import left

def test_left() -> None:
    assert left('a:b') == 'a'
