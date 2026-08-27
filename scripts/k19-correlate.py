#!/usr/bin/env python3
"""K19: check the gateway log for the api_server startup line that prints key
source/fingerprint, and check whether the listener's key was loaded from a
different file. Also verify the gateway accepted our probes (202) — meaning
listener key == env-file key. The adapter sends the resolved secret, which we
verified equals the same value. So why 401?

Remaining possibility: the ADAPTER (node fetch inside paperclip container)
sends through socat relay; maybe the relay is fine. BUT our successful probes
ran as root on host or in-container with the SAME key...

Wait - check user_agent of rejections: 'node'. Our probes used python/curl.
The Paperclip server process (user 'node'? no, node is the runtime).
Check if ANOTHER hermes-gateway integration (the discord-bridge?) is polling
with an old key and the 401s belong to THAT, not to our runs!

Look at run timing vs rejection timing precisely."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select id, status, error_code, started_at, finished_at from heartbeat_runs "
     "where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' order by created_at desc limit 2"],
    capture_output=True, text=True,
)
print(out.stdout)

gw = subprocess.run(
    ["grep", "rejected invalid API key", "/root/.hermes/logs/gateway.log"],
    capture_output=True, text=True,
).stdout.strip().splitlines()[-6:]
for line in gw:
    print(line[:160])
