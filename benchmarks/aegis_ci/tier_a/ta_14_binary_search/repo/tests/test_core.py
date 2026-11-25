from pkg.core import binary_search

def test_bsearch() -> None:
    assert binary_search([1, 3, 5, 7], 7) == 3
