#!/usr/bin/env python3
"""K19: check whether the secret material (decrypted) equals the gateway key.
Compares value_sha256 of the secret version against digests of candidate keys.
No secret values printed."""
import hashlib

def digest(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()
print("gateway env-file key sha256[:16] =", digest(env_key.encode())[:16])
