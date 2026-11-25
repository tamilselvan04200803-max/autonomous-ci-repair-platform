def slugify(text: str) -> str:
    return '_'.join(text.lower().split())
