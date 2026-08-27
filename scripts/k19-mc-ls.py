#!/usr/bin/env python3
"""K19: list recent run logs in minio for the temp agent and cat the newest."""
import subprocess

env = {}
for line in open("/root/projects/t3-paperclip-Aitodo/.worktrees/t_5ffb66c6/deploy-prod/runtime.env"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v

subprocess.run([
    "mc", "alias", "set", "k19minio",
    "http://nas-storage-t19.tail9831b.ts.net:9000",
    env["AWS_ACCESS_KEY_ID"], env["AWS_SECRET_ACCESS_KEY"],
], capture_output=True, text=True)

ls = subprocess.run(
    ["mc", "ls", "--recursive", "k19minio/paperclip/ca743e8c-e414-49c8-9134-890ea933a3f6/5e7091a2-4837-46bd-8465-5fdb597d6fc6/"],
    capture_output=True, text=True, timeout=60,
)
lines = [l for l in ls.stdout.strip().splitlines() if l.strip()]
print("objects:", len(lines))
for l in lines[-3:]:
    print(l)

# take last object name
if lines:
    name = lines[-1].split()[-1]
    print("cat:", name)
    cat = subprocess.run(
        ["mc", "cat", f"k19minio/paperclip/ca743e8c-e414-49c8-9134-890ea933a3f6/5e7091a2-4837-46bd-8465-5fdb597d6fc6/{name}"],
        capture_output=True, text=True, timeout=60,
    )
    for line in cat.stdout.splitlines():
        if any(s in line for s in ("hermes-gateway", "creating run", "run created", "401", "error")):
            print(line[:280])
