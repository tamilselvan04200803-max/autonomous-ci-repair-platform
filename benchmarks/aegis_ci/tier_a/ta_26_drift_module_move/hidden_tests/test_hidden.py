from pkg.client import get_tok

def test_tok_hidden() -> None:
    assert get_tok() == 'v2'
