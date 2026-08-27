#!/usr/bin/env python3
"""K19: replicate the adapter's EXACT body (input + instructions + session_id)
and headers, from the host, to see if the 401 reproduces."""
import json
import urllib.request
import urllib.error

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

body = {
    "input": "K19 probe",
    "instructions": "Follow the Paperclip wake instructions exactly. Do not expose secrets in logs, comments, or final output.",
    "session_id": "k19-issue-0b6c662-test",
}
req = urllib.request.Request(
    "http://127.0.0.1:8642/v1/runs",
    data=json.dumps(body).encode(),
    headers={
        "Authorization": f"Bearer {env_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "k19-exact-body-probe",
        "X-Hermes-Session-Key": "k19-issue-0b6c662-test",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print("status:", r.status)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code, e.read(200))
