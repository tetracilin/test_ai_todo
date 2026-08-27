#!/usr/bin/env python3
"""K19 diagnostic: does the running gateway's key come from /root/.hermes/.env?
Compare digests of API_SERVER_KEY (env file) vs the agent apiKey (DB). No values."""
import hashlib

def digest(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

print("env-file API_SERVER_KEY sha256[:16] =", digest(env_key.encode()) if env_key else None)

# agent key from earlier check: e7f155576c145ec9... len 162 -> not equal to env-file key.
# So where does the gateway get its key? Check gateway config module default path.
import subprocess
out = subprocess.run(
    ["grep", "-rn", "API_SERVER_KEY",
     "/usr/local/lib/hermes-agent/"],
    capture_output=True, text=True,
)
for line in out.stdout.splitlines()[:12]:
    # print file paths and code context but mask any literal values after '='
    parts = line.split("=", 1)
    print(parts[0][:160] + ("= <masked>" if len(parts) > 1 else ""))
