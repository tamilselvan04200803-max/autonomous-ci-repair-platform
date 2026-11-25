from pkg.typed import upper_or_empty

def test_upper() -> None:
    assert upper_or_empty(None) == ''
    assert upper_or_empty('hi') == 'HI'
