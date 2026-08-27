#!/usr/bin/env python3
"""K19: read a FAILED run's ndjson log from S3 (via the minio mc or aws cli in
the container) and inspect the Authorization-related lines to determine what key
value the adapter actually sent. Only redacted content is printed."""
import subprocess

# Find the most recent failed run's log_ref
out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select log_ref from heartbeat_runs where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' "
     "and status='failed' order by created_at desc limit 1"],
    capture_output=True, text=True,
)
ref = out.stdout.strip()
print("log ref:", ref)

# Try reading via docker exec + curl against local s3? Instead check if the
# paperclip container has an awscli / mc. Fall back: use the app's own API?
probe = f"""
set -e
if command -v aws >/dev/null 2>&1; then echo HAS_AWS; fi
if command -v mc >/dev/null 2>&1; then echo HAS_MC; fi
ls /paperclip/instances/default/logs 2>/dev/null | head -5 || true
"""
out2 = subprocess.run(["docker", "exec", "paperclip", "sh", "-c", probe],
                      capture_output=True, text=True)
print(out2.stdout)
