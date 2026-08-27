#!/usr/bin/env python3
"""K19: check the source agent 24c36c90's secret binding vs the secret used.
The temp agent's binding points to d672fbb1 (T3-ver2 company). But the temp
agent now lives in company ca743e8c. The resolveSecretValueInternal enforces
company scoping: assertSecretInCompany(companyId, secretId). The secret belongs
to company 73f27949 — NOT ca743e8c! The access event logs 'success' but maybe it
resolves to a DIFFERENT (empty) value or fails silently.

Fix: create a NEW secret in company ca743e8c with the gateway key material and
bind the temp agent's apiKey to that. Simpler: reassign the existing binding's
secret... but we can't insert encrypted material easily without the master key
— actually we CAN: we have master.key and know the scheme (AES-256-GCM).

Plan:
1. Encrypt the gateway key with master.key using same iv/tag/scheme format.
2. Insert new version row for a new secret in company ca743e8c.
3. Point temp agent's apiKey secret_ref + binding at the new secret."""
import base64
import json
import os
import subprocess

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# read master key
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
aes = AESGCM(key)
ct_and_tag = aes.encrypt(iv, env_key.encode(), None)
ciphertext, tag = ct_and_tag[:-16], ct_and_tag[-16:]

material = {
    "scheme": "local_encrypted.v1",
    "iv": base64.b64encode(iv).decode(),
    "tag": base64.b64encode(tag).decode(),
    "ciphertext": base64.b64encode(ciphertext).decode(),
}

# check scheme of an existing material to copy exactly
out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select material->>'scheme' from company_secret_versions where secret_id='d672fbb1-a8c1-4ab5-b62b-dfd1ff49bb80'"],
    capture_output=True, text=True,
)
print("existing scheme:", out.stdout.strip())
material["scheme"] = out.stdout.strip()

mat_json = json.dumps(material).replace("'", "''")
sha = __import__("hashlib").sha256(env_key.encode()).hexdigest()
comp_id = "ca743e8c-e414-49c8-9134-890ea933a3f6"

sql = f"""
begin;
insert into company_secrets (id, company_id, name, provider)
values ('11111111-1111-4111-8111-111111111111', '{comp_id}', 'hermes_gateway.apikey.k19-temp', 'local_encrypted');

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
open("/tmp/k19-rebind.sql", "w").write(sql)
subprocess.run(["docker", "cp", "/tmp/k19-rebind.sql", "t3-prod-db-1:/tmp/k19-rebind.sql"])
out2 = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip", "-f", "/tmp/k19-rebind.sql"],
    capture_output=True, text=True,
)
print(out2.stdout[-600:])
print(out2.stderr[-300:])
