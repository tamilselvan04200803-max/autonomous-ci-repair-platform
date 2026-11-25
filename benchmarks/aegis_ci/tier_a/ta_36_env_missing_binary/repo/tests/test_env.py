import shutil

def test_bin() -> None:
    assert shutil.which('nonexistent-ci-tool-xyz') is not None
