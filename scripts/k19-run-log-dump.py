#!/usr/bin/env python3
"""K19: dump the run's full stdout_excerpt + error to see the adapter log lines
including whether it logged 'run created' (meaning POST /v1/runs succeeded and
the 401 came from a SUBSEQUENT call, e.g. events stream)."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select stdout_excerpt || E'\n---STDERR---\n' || coalesce(stderr_excerpt,'') "
     "from heartbeat_runs where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' "
     "and status='failed' order by created_at desc limit 1"],
    capture_output=True, text=True,
)
print(out.stdout[:2000])
