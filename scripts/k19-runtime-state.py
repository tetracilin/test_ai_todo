#!/usr/bin/env python3
"""K19: check whether the gateway's api_server platform is bound to a DIFFERENT
HERMES profile scope. The gateway runs with HERMES_HOME=/root/.hermes and no
API_SERVER_KEY in process env — so the key comes from the .env load at startup.
The env_loader loads /root/.hermes/.env with override semantics. The listener
accepted our probe with the current .env key, so the LISTENER's key matches.

=> The adapter must be sending a DIFFERENT key. The only remaining candidate:
the run dispatch resolves adapter_config fresh each attempt, and the secret
access events say success... but maybe the resolved value passed to the adapter
is the SECRET REF OBJECT (json), not the decrypted string, because the runtime
config path differs (e.g. executionRunConfig from agent_runtime_state).

Check agent_runtime_state for this agent."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-c",
     "select column_name from information_schema.columns where table_name='agent_runtime_state' order by ordinal_position"],
    capture_output=True, text=True,
)
print(out.stdout)
out2 = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-c",
     "select * from agent_runtime_state where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' limit 1"],
    capture_output=True, text=True,
)
print(out2.stdout[:800])
