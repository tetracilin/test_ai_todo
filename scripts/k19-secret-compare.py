#!/usr/bin/env python3
"""K19: compare value_sha256 of ALL hermes_gateway.apikey.* secret versions
against the gateway env-file key digest. Find one whose material IS the current
gateway key, and point the temp agent at that secret instead."""
import hashlib
import subprocess

def d16(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()
target = d16(env_key.encode())
print("gateway key digest:", target)

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select csv.secret_id, left(csv.value_sha256,16), s.name "
     "from company_secret_versions csv join company_secrets s on s.id=csv.secret_id "
     "where s.name like 'hermes_gateway.apikey%' and csv.status='current'"],
    capture_output=True, text=True,
)
for line in out.stdout.strip().splitlines():
    parts = line.split("|")
    match = "<== MATCHES GATEWAY KEY" if parts[1] == target else ""
    print(line, match)
