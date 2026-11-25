from pkg.client import run

def test_run() -> None:
    assert run(5) == 15
