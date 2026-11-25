from vendor_sdk import fetch

def call() -> str:
    return fetch('https://x', timeout_s=3)
