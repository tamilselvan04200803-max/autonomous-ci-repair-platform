from pkg.client import run

def test_run_hidden() -> None:
    assert run(0) == 10
