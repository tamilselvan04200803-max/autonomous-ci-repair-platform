"""Shared formatting and math helpers."""


def clamp_nonneg(value: int) -> int:
    return max(value, 0)


def format_label(name: str, count: int) -> str:
    return f"{name.strip()}:{count}"
