"""Contract test for PyJWT RS256 encoding/decoding with cryptography RSA keys.

Docs URL: https://pyjwt.readthedocs.io/en/stable/usage.html#encoding-decoding-tokens-with-rs256-rsa
"""

from __future__ import annotations

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


@pytest.mark.contract
def test_pyjwt_rs256_contract() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_private = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_key = private_key.public_key()
    token = jwt.encode({"iss": "12345", "iat": 1000, "exp": 1300}, pem_private, algorithm="RS256")
    decoded = jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        options={"verify_exp": False},
    )
    assert decoded["iss"] == "12345"
