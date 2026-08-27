#!/usr/bin/env python3
"""K19: which profile's API_SERVER_KEY matches the agent apiKey? digests only."""
import hashlib

def digest(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

AGENT_KEY_DIGEST = "e7f155576c145ec9"  # from k19-key-check.py (agent apiKey, len 162)
GATEWAY_LISTENER_DIGEST = "abdb9cc77dbb82c4"  # /root/.hermes/.env API_SERVER_KEY

import glob
for envf in glob.glob("/root/.hermes/profiles/*/.env") + ["/root/.hermes/.env"]:
    key = None
    for line in open(envf):
        if line.startswith("API_SERVER_KEY="):
            key = line.split("=", 1)[1].strip()
    if key:
        d = digest(key.encode())
        marker = " <== matches AGENT KEY" if d == AGENT_KEY_DIGEST else ""
        print(f"{envf}: sha256[:16]={d} len={len(key)}{marker}")
