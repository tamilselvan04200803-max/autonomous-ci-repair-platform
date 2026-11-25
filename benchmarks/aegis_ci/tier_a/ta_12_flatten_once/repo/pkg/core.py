def flatten_once(nested: list[list[int]]) -> list[int]:
    out: list[int] = []
    for sub in nested:
        if sub:
            out.append(sub[0])
    return out
