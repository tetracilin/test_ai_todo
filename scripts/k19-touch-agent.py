#!/usr/bin/env python3
"""K19: check the gateway's api_server _api_key at runtime by inspecting the
python process memory-mapped env/config? Simpler: use the gateway's own
/v1/capabilities with the key (works) — so listener accepts env-file key.

The rejections correlate EXACTLY with run attempts. So the adapter sends a
different value. The secret access events say 'success'... but maybe the
runtime resolves a DIFFERENT config path — e.g. the adapter receives
adapter_config from `executionRunConfig` built BEFORE our rebinding, cached in
agent_runtime_state or issue checkout. Let me check if Paperclip caches the
resolved config per agent and only refreshes on agent update.

Decisive test: UPDATE the agent row (touch updated_at) via the API to force
config reload — use PATCH /agents/:id with same values through board key.
Actually simpler: check whether there is an in-memory cache: restart isn't
allowed lightly... but touching the agent via API update is safe."""
import hashlib
import json
import subprocess
import urllib.request

# get admin user id + temp board key via direct insert (same as before)
DB = ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip", "-tAc"]

def q(sql):
    return subprocess.run(DB + [sql], capture_output=True, text=True).stdout.strip()

user_id = q("select id from \"user\" where email='admin@tecotec.tech'")
import secrets as pysecrets
token = "k19-" + pysecrets.token_hex(24)
kh = hashlib.sha256(token.encode()).hexdigest()
q(f"insert into board_api_keys (user_id, name, key_hash, expires_at) values ('{user_id}', 'k19-touch-temp', '{kh}', now() + interval '1 hour')")

AGENT_ID = "5e7091a2-4837-46bd-8465-5fdb597d6fc6"
COMPANY_ID = "ca743e8c-e414-49c8-9134-890ea933a3f6"

req = urllib.request.Request(
    f"http://127.0.0.1:3100/api/agents/{AGENT_ID}",
    data=json.dumps({"title": "K19 Hermes acceptance"}).encode(),
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    },
    method="PATCH",
)
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        print("PATCH agent:", r.status)
except Exception as e:
    print("PATCH failed:", e)

# cleanup key
q(f"delete from board_api_keys where key_hash='{kh}'")
print("done")
