#!/usr/bin/env python3
"""K19: replicate the adapter request with the session key the adapter would
send: 'paperclip:company:<id>:agent:<id>:issue:<iid>' — maybe the COLONS in the
session key break the gateway auth (e.g. header parsing)."""
import json
import urllib.request
import urllib.error

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

sk = "paperclip:company:ca743e8c-e414-49c8-9134-890ea933a3f6:agent:5e7091a2-4837-46bd-8465-5fdb597d6fc6:issue:0b6c6642"
body = {"input": "K19 probe", "instructions": "x", "session_id": sk}
req = urllib.request.Request(
    "http://127.0.0.1:8642/v1/runs",
    data=json.dumps(body).encode(),
    headers={
        "Authorization": f"Bearer {env_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "k19-colon-probe",
        "X-Hermes-Session-Key": sk,
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print("with paperclip-style session key:", r.status)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code)
