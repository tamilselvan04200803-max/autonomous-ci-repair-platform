"""Static configuration defaults."""

DEFAULT_ENV = "test"
MAX_RETRIES = 3


def get_timeout(multiplier: int = 1) -> int:
    return 10 * max(1, multiplier)
