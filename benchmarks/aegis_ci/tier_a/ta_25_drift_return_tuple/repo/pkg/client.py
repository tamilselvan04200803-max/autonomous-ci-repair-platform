from vendor_sdk import split_pair

def left(s: str) -> str:
    head, _mid, _tail = split_pair(s)
    return head
