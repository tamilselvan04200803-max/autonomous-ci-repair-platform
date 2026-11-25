from pathlib import Path

def min_ver_ok() -> bool:
    req = Path('requirements.txt').read_text(encoding='utf-8')
    return '>=2.0.0' in req
