#!/usr/bin/env python3
"""K19: verify the gateway accepts the key from INSIDE the paperclip container
(via the relay), replicating the adapter's exact request: POST /v1/runs."""
import json
import subprocess
import urllib.request
import urllib.error

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

# Write the probe script into the container and run it there.
probe = f"""
import json, urllib.request, urllib.error
body = json.dumps({{"input": "K19 probe"}}).encode()
req = urllib.request.Request(
    "http://172.21.0.1:8642/v1/runs",
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
subprocess.run([
    "docker", "exec", "paperclip", "python3", "-c", probe,
])
