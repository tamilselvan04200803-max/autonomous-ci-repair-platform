from pkg.client import call

def test_call_hidden() -> None:
    assert call().endswith(':3')
