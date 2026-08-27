#!/usr/bin/env python3
"""K19: check the .env.bak.pre-paperclip-gateway key digest — if the gateway
loaded its key BEFORE that backup was made (process start Aug 25, file Aug 13),
the listener may hold an older key. Compare digests."""
import hashlib

def d16(path):
    key = None
    for line in open(path):
        if line.startswith("API_SERVER_KEY="):
            key = line.split("=", 1)[1].strip()
    return (hashlib.sha256(key.encode()).hexdigest()[:16], len(key)) if key else (None, 0)

for p in [
    "/root/.hermes/.env",
    "/root/.hermes/.env.bak.20260813_045035",
    "/root/.hermes/.env.bak.pre-paperclip-gateway",
]:
    d, ln = d16(p)
    print(p, "->", d, "len", ln)
