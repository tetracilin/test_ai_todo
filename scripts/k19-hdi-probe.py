#!/usr/bin/env python3
"""K19: run the exact adapter request from inside the container against
host.docker.internal:8642 with the CORRECT key to see if auth passes there.
If it passes, the key the DB secret resolves to must be wrong/stale."""
import subprocess

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

probe = f"""
import json, urllib.request, urllib.error
body = json.dumps({{"input": "K19 probe"}}).encode()
req = urllib.request.Request(
    "http://host.docker.internal:8642/v1/runs",
    data=body,
    headers={{"Authorization": "Bearer {env_key}", "Content-Type": "application/json"}},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print("status:", r.status)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code)
except Exception as e:
    print("ERR:", e)
"""
subprocess.run(["docker", "exec", "paperclip", "python3", "-c", probe])
