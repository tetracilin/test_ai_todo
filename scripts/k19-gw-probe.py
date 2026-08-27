#!/usr/bin/env python3
"""K19: probe the gateway API with the secret material value (decrypted via
Paperclip's own local_encrypted provider is not directly callable; instead
verify which key the gateway accepts by testing candidate keys from env files).
Digests only — no key material printed."""
import hashlib
import json
import urllib.request

GATEWAY = "http://127.0.0.1:8642"

# The Paperclip secret version's sha256 (value_sha256) = abdb9cc7... matches the
# env-file API_SERVER_KEY digest, so the STORED secret IS the gateway key.
# Yet the gateway rejects it. Test: maybe gateway expects the raw key but the
# adapter sends something else (e.g. JSON-encoded binding).

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

def try_key(key: bytes, label: str):
    req = urllib.request.Request(
        GATEWAY + "/v1/models",
        headers={"Authorization": "Bearer " + key.decode()},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            print(label, "->", r.status)
            return r.status == 200
    except Exception as e:  # noqa: BLE001
        print(label, "-> FAIL", e)
        return False

try_key(env_key.encode(), "env-file key against /v1/models:")
