#!/usr/bin/env python3
"""K19 diagnostic: compare the running gateway process's API_SERVER_KEY digest
with the agent apiKey digest (digests only, never print secret values)."""
import hashlib

def digest(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

with open("/proc/74380/environ", "rb") as f:
    env = f.read().decode("utf-8", "replace").split("\0")

server_key = None
for entry in env:
    if entry.startswith("API_SERVER_KEY="):
        server_key = entry.split("=", 1)[1]
print("running-gateway API_SERVER_KEY present:", server_key is not None)
if server_key:
    print("running-gateway key sha256[:16] =", digest(server_key.encode()))
