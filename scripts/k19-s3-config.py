#!/usr/bin/env python3
"""K19: pull the failed run's ndjson log from minio S3 using host mc/client.
The storage config lives in the paperclip config (S3 backend, tailnet minio).
We use the run log to see the exact Authorization header the adapter sent."""
import json
import subprocess

# read S3 creds from the compose runtime env (host-side file)
env = {}
for line in open("/root/projects/t3-paperclip-Aitodo/.worktrees/t_5ffb66c6/deploy-prod/runtime.env"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v

print("runtime.env keys:", [k for k in env if "AWS" in k or "S3" in k or "MINIO" in k])
cfg = json.load(open("/root/paperclip-data/instances/default/config.json"))
storage = cfg.get("storage") or cfg.get("s3") or {}
def mask(d):
    return {k: ("<set>" if isinstance(v, str) and ("key" in k.lower() or "secret" in k.lower()) else v)
            for k, v in d.items()} if isinstance(d, dict) else d
print("config storage section:", json.dumps(mask(storage))[:400])
