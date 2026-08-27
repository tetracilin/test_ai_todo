#!/usr/bin/env python3
"""K19: check whether the run dispatch uses a config snapshot taken at ISSUE
CREATE time (executionRunConfig) — the issue was created when the agent's
adapter_config.apiKey was still the OLD broken value (secret_ref to a different
secret or missing). The retry loop may reuse the stale snapshot.
Test: cancel all scheduled retries, create a FRESH issue now, and observe."""
import subprocess

# cancel pending retries for this agent
out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-c",
     "update heartbeat_runs set status='cancelled' "
     "where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' and status in ('scheduled_retry','queued') "
     "returning id, status"],
    capture_output=True, text=True,
)
print(out.stdout[-500:])
