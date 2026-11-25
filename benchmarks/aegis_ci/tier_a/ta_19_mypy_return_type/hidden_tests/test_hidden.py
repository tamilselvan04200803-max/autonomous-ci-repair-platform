from pkg.typed import compute_count

def test_count() -> None:
    assert compute_count(['a', 'b']) == 2
