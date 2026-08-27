#!/usr/bin/env python3
"""K19: fetch run ndjson log from minio with a temp mc alias (creds from
runtime.env; the secret key is passed via env, not printed)."""
import subprocess

env = {}
for line in open("/root/projects/t3-paperclip-Aitodo/.worktrees/t_5ffb66c6/deploy-prod/runtime.env"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v

ref = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select log_ref from heartbeat_runs where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' "
     "and status='failed' order by created_at desc limit 1"],
    capture_output=True, text=True,
).stdout.strip()
print("log ref:", ref)

alias_set = [
    "mc", "alias", "set", "k19minio",
    "http://nas-storage-t19.tail9831b.ts.net:9000",
    env["AWS_ACCESS_KEY_ID"], env["AWS_SECRET_ACCESS_KEY"],
]
subprocess.run(alias_set, capture_output=True, text=True)

cat = subprocess.run(
    ["mc", "cat", f"k19minio/paperclip/{ref}"],
    capture_output=True, text=True, timeout=60,
)
text = cat.stdout or ""
print("log lines:", len(text.splitlines()))
for line in text.splitlines():
    if any(s in line for s in ("hermes-gateway", "creating run", "run created", "401")):
        print(line[:280])
