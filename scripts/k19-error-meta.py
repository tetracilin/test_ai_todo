#!/usr/bin/env python3
"""K19: check the gateway's runtime config for API_SERVER_KEY as loaded.
The hermes CLI exposes `hermes config get`; try reading the effective value's
digest without printing it. Also check profile secret scope files."""
import hashlib
import os
import glob

def d16(v):
    return hashlib.sha256(v).hexdigest()[:16] if v else None

# profile-scoped secrets: look for files under /root/.hermes that store secrets
candidates = []
for pat in [
    "/root/.hermes/secrets/*",
    "/root/.hermes/state/secrets/*",
    "/root/.hermes/profiles/default/.env",
]:
    candidates.extend(glob.glob(pat))

print("secret-scope candidate paths:", candidates or "none")

# The gateway process was started Aug 25 10:39 (log line). If API_SERVER_KEY in
# /root/.hermes/.env was rotated AFTER start, the running listener holds the old
# key while new connections use the new one — but our probe with the CURRENT env
# key succeeded (202), so the listener key == current env key.
#
# Therefore the 401 must come from a DIFFERENT key being sent by the adapter.
# Next: dump the run's error_meta body to see the gateway's response details.
import subprocess
out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select coalesce(error_meta::text, 'no-meta') from heartbeat_runs "
     "where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' and status='failed' "
     "order by created_at desc limit 1"],
    capture_output=True, text=True,
)
print("error_meta:", out.stdout.strip()[:500])
