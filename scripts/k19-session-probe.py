#!/usr/bin/env python3
"""K19: replicate the adapter's EXACT request INCLUDING the X-Hermes-Session-Key
header (session strategy = issue). Hypothesis: the session-key header triggers a
profile-scoped key check that fails even with the right bearer token."""
import json
import subprocess
import urllib.request
import urllib.error

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

body = json.dumps({
    "input": "K19 probe",
    "session_id": "k19-probe-session-1",
}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:8642/v1/runs",
    data=body,
    headers={
        "Authorization": f"Bearer {env_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "k19-probe-2",
        "X-Hermes-Session-Key": "k19-probe-session-1",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print("with session header:", r.status)
except urllib.error.HTTPError as e:
    print("with session header HTTPError:", e.code)
