from pkg.core import mean

def test_mean_two() -> None:
    assert mean([10.0, 20.0]) == 15.0
