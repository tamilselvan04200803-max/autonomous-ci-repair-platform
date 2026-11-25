import os, tempfile
from pathlib import Path

def test_flaky_5() -> None:
    marker = Path(tempfile.gettempdir()) / 'aegis_flaky_ta_33_flaky_case_5.cnt'
    n = int(marker.read_text()) if marker.exists() else 0
    marker.write_text(str(n + 1))
    assert (n % 2) == 1
