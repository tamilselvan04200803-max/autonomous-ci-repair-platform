from pkg.core import chunk_list

def test_chunk_rem() -> None:
    assert chunk_list([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
