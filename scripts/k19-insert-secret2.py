#!/usr/bin/env python3
"""K19: insert the company-scoped secret (fixed psql invocation)."""
import base64
import hashlib
import json
import os
import subprocess

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

master_b64 = open("/root/paperclip-data/instances/default/secrets/master.key").read().strip()
key = base64.b64decode(master_b64)
if len(key) != 32:
    try:
        key = bytes.fromhex(master_b64)
    except ValueError:
        key = master_b64.encode()[:32]

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

iv = os.urandom(12)
ct_and_tag = AESGCM(key).encrypt(iv, env_key.encode(), None)
material = {
    "scheme": "local_encrypted_v1",
    "iv": base64.b64encode(iv).decode(),
    "tag": base64.b64encode(ct_and_tag[-16:]).decode(),
    "ciphertext": base64.b64encode(ct_and_tag[:-16]).decode(),
}
sha = hashlib.sha256(env_key.encode()).hexdigest()
comp_id = "ca743e8c-e414-49c8-9134-890ea933a3f6"
mat_json = json.dumps(material).replace("'", "''")

sql1 = f"""insert into company_secrets (company_id, name, provider, key)
values ('{comp_id}', 'hermes_gateway.apikey.k19-temp', 'local_encrypted', 'hermes_gateway.apikey.k19-temp')
returning id;"""
open("/tmp/k19-s1.sql", "w").write(sql1)

out1 = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-f", "/tmp/k19-s1.sql"],
    capture_output=True, text=True,
)
print(out1.stdout.strip(), out1.stderr[:200])
