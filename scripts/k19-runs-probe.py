#!/usr/bin/env python3
"""K19: end-to-end probe of the exact path the adapter uses.
Simulate the adapter call to the gateway: POST /v1/runs with the env key.
This verifies the gateway accepts /v1/runs with the correct key (i.e. the
401 must come from a wrong key value reaching the adapter)."""
import json
import urllib.request
import urllib.error

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

body = json.dumps({
    "message": "K19 connectivity probe - reply with exactly: K19-PROBE-OK",
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
    with urllib.request.urlopen(req, timeout=10) as r:
        print("POST /v1/runs status:", r.status)
        print("body head:", r.read(200))
except urllib.error.HTTPError as e:
    print("POST /v1/runs HTTPError:", e.code, e.reason)
    print(e.read(300))
