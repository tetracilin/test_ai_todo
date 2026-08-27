#!/usr/bin/env python3
"""K19: probe with a 48-char key (the length of the stored secret) — the
env-file key is 48 chars and works. So key length isn't the issue.

Remaining hypothesis: the runtime passes a DIFFERENT resolved value — maybe the
run uses `runtimeConfig.adapterConfig` overriding apiKey, or an env var
HERMES_GATEWAY_API_KEY. Check the agents.runtime_config column for the temp
agent (inherited from source agent) — it may carry a stale plain key."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select runtime_config::text from agents where id='5e7091a2-4837-46bd-8465-5fdb597d6fc6'"],
    capture_output=True, text=True,
)
rc = out.stdout.strip()
print("runtime_config:", rc[:400])

# Also check the SOURCE agent's runtime_config
out2 = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select runtime_config::text from agents where id='24c36c90-a6f8-4a58-ac67-b143eaa142dc'"],
    capture_output=True, text=True,
)
print("source runtime_config:", out2.stdout.strip()[:400])
