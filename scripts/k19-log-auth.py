#!/usr/bin/env python3
"""K19: inspect the run's full log ndjson — the redacted Authorization header
length is printed by the adapter's redactor as [redacted len=N] only when the
value differs from the key. Check the raw header line in the latest failed run."""
import subprocess

ref = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select log_ref from heartbeat_runs where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' "
     "and status='failed' order by created_at desc limit 1"],
    capture_output=True, text=True,
).stdout.strip()
path = f"/root/paperclip-data/instances/default/data/run-logs/{ref}"
print("log:", path)
text = open(path).read()
for line in text.splitlines():
    if "Authorization" in line or "redacted" in line.lower():
        print(line[:400])
