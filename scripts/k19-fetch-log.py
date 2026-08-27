#!/usr/bin/env python3
"""K19: fetch the failed run's ndjson log from minio and grep the
'creating run' / 'run created' lines to see whether POST /v1/runs succeeded
(401 must then come from a later call) or failed immediately."""
import subprocess

env = {}
for line in open("/root/projects/t3-paperclip-Aitodo/.worktrees/t_5ffb66c6/deploy-prod/runtime.env"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v

ref = "ca743e8c-e414-49c8-9134-890ea933a3f6/5e7091a2-4837-46bd-8465-5fdb597d6fc6"
out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select log_ref from heartbeat_runs where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' "
     "and status='failed' order by created_at desc limit 1"],
    capture_output=True, text=True,
)
log_ref = out.stdout.strip()

# Use docker exec into the paperclip container with node + aws sdk? Simpler:
# use host curl against minio with AWS sig v2 is complex. Try mc if installed on host.
mc = subprocess.run(["which", "mc"], capture_output=True, text=True).stdout.strip()
print("host mc:", mc or "not installed")

# Alternative: minio client via docker
out2 = subprocess.run(
    ["docker", "run", "--rm", "--network", "host",
     "-e", f"MC_HOST_minio=http://{env['AWS_ACCESS_KEY_ID']}:{env['AWS_SECRET_ACCESS_KEY']}@nas-storage-t19.tail9831b.ts.net:9000",
     "minio/mc", "cat", f"minio/paperclip/{log_ref}"],
    capture_output=True, text=True, timeout=120,
)
text = out2.stdout or out2.stderr
for line in text.splitlines():
    if "hermes-gateway" in line or "creating run" in line or "run created" in line:
        print(line[:300])
if not text.strip():
    print("no output from mc")
