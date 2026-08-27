#!/usr/bin/env python3
"""K19: retry the company-scoped secret insert with required `key` column."""
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

sql = f"""
begin;
insert into company_secrets (id, company_id, name, provider, key)
values ('11111111-1111-4111-8111-111111111111', '{comp_id}', 'hermes_gateway.apikey.k19-temp', 'local_encrypted', 'hermes_gateway.apikey.k19-temp');

insert into company_secret_versions (id, secret_id, version, material, value_sha256, status)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1,
        '{mat_json}'::jsonb, '{sha}', 'current');

update company_secret_bindings
set secret_id='11111111-1111-4111-8111-111111111111'
where target_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' and config_path='apiKey';

update agents
set adapter_config = jsonb_set(adapter_config, '{{apiKey,secretId}}', '"11111111-1111-4111-8111-111111111111"'::jsonb)
where id='5e7091a2-4837-46bd-8465-5fdb597d6fc6';
commit;
"""
open("/tmp/k19-rebind2.sql", "w").write(sql)
subprocess.run(["docker", "cp", "/tmp/k19-rebind2.sql", "t3-prod-db-1:/tmp/k19-rebind2.sql"])
out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip", "-f", "/tmp/k19-rebind2.sql"],
    capture_output=True, text=True,
)
print(out.stdout[-400:], out.stderr[-300:])
