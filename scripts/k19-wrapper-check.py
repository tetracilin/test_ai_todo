#!/usr/bin/env python3
"""K19: check whether the gateway's loaded API key differs from the env-file
value. The gateway process (pid 74380) started Aug 25; if the key was rotated
in .env after start, the process holds the OLD key. Compare via /v1/models
auth: try the current env-file key (works, verified). So the listener accepts
the CURRENT env key. Then the adapter must be sending something different.
Next: check what value the adapter resolves — maybe Paperclip's local_encrypted
provider decrypts to a DIFFERENT historical value whose sha256 was computed over
a wrapped form. Verify by comparing value_sha256 against sha256('API_SERVER_KEY='
+ key) style wrappers."""
import hashlib
import json

def d16(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

candidates = {
    "raw": env_key,
    "json-quoted": json.dumps(env_key),
    "bearer-prefixed": "Bearer " + env_key,
    "kv-wrapped": f"API_SERVER_KEY={env_key}",
}
for name, val in candidates.items():
    print(f"{name}: {d16(val.encode())}")
print("DB value_sha256: abdb9cc77dbb82c4")
