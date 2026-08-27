#!/usr/bin/env python3
"""K19: replicate the adapter's EXACT request (headers + body) with the CORRECT
key from inside the container. If this succeeds, the DB-resolved key differs."""
import json
import subprocess

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

probe = f'''
import json, urllib.request, urllib.error, uuid
body = {{
    "input": "K19 exact-replica probe. Reply with exactly: K19-PROBE-OK",
}}
headers = {{
    "Authorization": "Bearer {env_key}",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Idempotency-Key": str(uuid.uuid4()),
    "X-Hermes-Session-Key": "k19-probe-session",
}}
req = urllib.request.Request(
    "http://host.docker.internal:8642/v1/runs",
    data=json.dumps(body).encode(),
    headers=headers,
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print("status:", r.status)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code)
except Exception as e:
    print("ERR:", e)
'''
subprocess.run(["docker", "exec", "paperclip", "python3", "-c", probe])
