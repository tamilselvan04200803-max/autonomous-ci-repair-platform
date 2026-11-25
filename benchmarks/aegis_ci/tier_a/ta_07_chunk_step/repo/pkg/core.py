def chunk_list(items: list[int], size: int) -> list[list[int]]:
    step = max(1, size - 1)
    return [items[i : i + size] for i in range(0, len(items), step)]
