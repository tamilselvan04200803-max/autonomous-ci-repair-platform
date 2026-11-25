from pkg.typed import build_scores

def test_scores() -> None:
    assert build_scores()['alice'] == 10
