from pkg.client import call

def test_call() -> None:
    assert call() == 'https://x:3'
