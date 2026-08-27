#!/usr/bin/env python3
"""K19 diagnostic: check whether the temp agent's gateway apiKey matches the
Hermes gateway's API_SERVER_KEY (compare SHA-256 digests only; no secrets printed)."""
import hashlib
import json
import subprocess
import urllib.request

AGENT_ID = "5e7091a2-4837-46bd-8465-5fdb597d6fc6"

def psql(query: str) -> str:
    out = subprocess.run(
        ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip", "-tAc", query],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()

def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()[:16]

# agent key from DB
raw = psql(f"select adapter_config->>'apiKey' from agents where id='{AGENT_ID}'")
agent_key_b = raw.encode()
print("agent apiKey sha256[:16] =", digest(agent_key_b), "len:", len(raw))

# expected gateway key from host env file
env = open("/root/.hermes/.env").read().splitlines()
server_key = None
for line in env:
    if line.startswith("API_SERVER_KEY="):
        server_key = line.split("=", 1)[1].strip()
print("gateway API_SERVER_KEY sha256[:16] =", digest(server_key.encode()) if server_key else None)
print("match:", bool(server_key) and server_key == raw)

# probe the gateway directly with the agent key
req = urllib.request.Request(
    "http://127.0.0.1:8642/v1/health",
    headers={"Authorization": f"Bearer {raw}"},
)
try:
    with urllib.request.urlopen(req, timeout=5) as r:
        print("gateway /v1/health with agent key:", r.status)
except Exception as e:  # noqa: BLE001
    print("gateway /v1/health with agent key FAIL:", e)
