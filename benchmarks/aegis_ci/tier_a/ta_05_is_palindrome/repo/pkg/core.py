def is_palindrome(text: str) -> bool:
    cleaned = text.strip()
    return cleaned == cleaned[::-1]
