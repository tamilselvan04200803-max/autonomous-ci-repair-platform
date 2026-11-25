import os

def test_secret() -> None:
    assert 'PROD_API_TOKEN' in os.environ
