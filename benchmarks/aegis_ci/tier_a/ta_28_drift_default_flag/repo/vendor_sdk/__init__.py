def render(name: str, *, strict: bool = True) -> str:
    if strict:
        raise ValueError('strict mode')
    return f'ok:{name}'
