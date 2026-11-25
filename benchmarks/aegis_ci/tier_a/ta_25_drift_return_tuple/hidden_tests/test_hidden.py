from pkg.client import left

def test_left_hidden() -> None:
    assert left('hello:world') == 'hello'
