from pkg.client import get_tok

def test_tok() -> None:
    assert get_tok() == 'v2'
