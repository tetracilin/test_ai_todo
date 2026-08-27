#!/usr/bin/env python3
"""K19: insert the missing secret VERSION row for secret 9bd02b0b (the version
insert in the earlier transaction was rolled back with the failed batch), then
rebind and retest."""
import base64
import hashlib
import json
import os
import subprocess

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

master_b64 = open("/root/paperclip-data/instances/default/secrets/master.key").read().strip()
key = base64.b64decode(master_b64)

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

iv = os.urandom(12)
ct_tag = AESGCM(key).encrypt(iv, env_key.encode(), None)
material = {
    "scheme": "local_encrypted_v1",
    "iv": base64.b64encode(iv).decode(),
    "tag": base64.b64encode(ct_tag[-16:]).decode(),
    "ciphertext": base64.b64encode(ct_tag[:-16]).decode(),
}
sha = hashlib.sha256(env_key.encode()).hexdigest()
mat_json = json.dumps(material).replace("'", "''")

sql = f"""
insert into company_secret_versions (secret_id, version, material, value_sha256, status)
values ('9bd02b0b-7256-4167-819c-0b8b0a26b5f1', 1, '{mat_json}'::jsonb, '{sha}', 'current')
returning id;

update agents
set adapter_config = jsonb_set(adapter_config, '{{apiKey,secretId}}', '"9bd02b0b-7256-4167-819c-0b8b0a26b5f1"'::jsonb)
where id='5e7091a2-4837-46bd-8465-5fdb597d6fc6'
returning id;
"""
open("/tmp/k19-s3.sql", "w").write(sql)
subprocess.run(["docker", "cp", "/tmp/k19-s3.sql", "t3-prod-db-1:/tmp/k19-s3.sql"])
out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-f", "/tmp/k19-s3.sql"],
    capture_output=True, text=True,
)
print(out.stdout[-300:], out.stderr[:200])
