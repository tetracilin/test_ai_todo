#!/usr/bin/env python3
"""K19: POST /v1/runs with the required 'input' field to prove auth+run path."""
import json
import urllib.request
import urllib.error

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

body = json.dumps({
    "input": "K19 connectivity probe. Reply with exactly: K19-PROBE-OK",
}).encode()

req = urllib.request.Request(
    "http://127.0.0.1:8642/v1/runs",
    data=body,
    headers={
        "Authorization": f"Bearer {env_key}",
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print("POST /v1/runs status:", r.status)
        data = json.loads(r.read())
        run_id = data.get("id") or data.get("run_id")
        print("run id:", run_id)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code)
    print(e.read(300))
