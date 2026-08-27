#!/usr/bin/env python3
"""K19: check the gateway's _get_scoped_secret — the process env has NO
API_SERVER_KEY, so the key must come from the profile secret scope (a file).
Find where scoped secrets are stored on disk and compare digests."""
import hashlib
import glob

def d16(v):
    return hashlib.sha256(v.encode()).hexdigest()[:16] if v else None

# search for files containing API_SERVER_KEY under /root/.hermes state dirs
import subprocess
out = subprocess.run(
    ["grep", "-rl", "API_SERVER_KEY", "/root/.hermes/state", "/root/.hermes/secrets",
     "/root/.hermes/gateway", "/root/.hermes/profiles"],
    capture_output=True, text=True,
)
files = [f for f in out.stdout.splitlines() if "logs" not in f and "cache" not in f]
print("candidate files:", files[:10])

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()
print("env key digest:", d16(env_key))

for f in files:
    try:
        content = open(f).read()
        if "API_SERVER_KEY" in content:
            # try json
            import json as j
            try:
                data = j.loads(content)
                def walk(d, path=""):
                    if isinstance(d, dict):
                        for k, v in d.items():
                            p = f"{path}{k}"
                            if isinstance(v, dict):
                                walk(v, p + ".")
                            elif "API_SERVER_KEY" in p.upper() and isinstance(v, str):
                                print(f"{f}: {p} digest={d16(v)} match={d16(v)==d16(env_key)}")
                walk(data)
            except Exception:
                for ln in content.splitlines():
                    if "API_SERVER_KEY=" in ln:
                        val = ln.split("API_SERVER_KEY=", 1)[1].strip()
                        print(f"{f}: digest={d16(val)} match={d16(val)==d16(env_key)}")
    except Exception as e:
        print(f, "ERR", e)
