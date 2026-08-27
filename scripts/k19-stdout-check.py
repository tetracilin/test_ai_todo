#!/usr/bin/env python3
"""K19: check the run's stdout_excerpt — the adapter logs 'creating run' and
'request headers (redacted)'. This shows what Authorization header prefix was
actually sent (e.g. Bearer <redacted> length)."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select left(stdout_excerpt, 600) from heartbeat_runs "
     "where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' and status='failed' "
     "order by created_at desc limit 1"],
    capture_output=True, text=True,
)
print(out.stdout)
