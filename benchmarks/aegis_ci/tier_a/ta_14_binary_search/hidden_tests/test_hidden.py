from pkg.core import binary_search

def test_bsearch_found() -> None:
    assert binary_search([1, 3, 5, 7], 9) == -1
    assert binary_search([1, 3, 5, 7], 1) == 0
