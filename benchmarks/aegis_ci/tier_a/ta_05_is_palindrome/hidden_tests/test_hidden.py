from pkg.core import is_palindrome

def test_pal_false() -> None:
    assert is_palindrome('Python') is False
    assert is_palindrome('Level') is True
