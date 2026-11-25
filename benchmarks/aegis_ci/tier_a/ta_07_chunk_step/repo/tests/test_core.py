from pkg.core import chunk_list

def test_chunk() -> None:
    assert chunk_list([1, 2, 3, 4], 2) == [[1, 2], [3, 4]]
