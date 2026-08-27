#!/usr/bin/env python3
"""K19: decrypt the secret material with the container's master.key and compare
the plaintext digest with (a) the DB value_sha256, (b) the gateway env key.
Only digests printed."""
import base64
import hashlib
import json
import subprocess

def d16(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

# master key from bind mount on host
master_b64 = open("/root/paperclip-data/instances/default/secrets/master.key").read().strip()
key = base64.b64decode(master_b64)
if len(key) != 32:
    try:
        key = bytes.fromhex(master_b64)
    except ValueError:
        key = master_b64.encode()[:32]

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select material::text from company_secret_versions "
     "where secret_id='d672fbb1-a8c1-4ab5-b62b-dfd1ff49bb80' and status='current'"],
    capture_output=True, text=True,
)
material = json.loads(out.stdout.strip())

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

iv = base64.b64decode(material["iv"])
tag = base64.b64decode(material["tag"])
ct = base64.b64decode(material["ciphertext"])
plain = AESGCM(key).decrypt(iv, ct + tag, None)

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

print("plaintext digest:", d16(plain), "len:", len(plain))
print("db value_sha256 : abdb9cc77dbb82c4")
print("gateway key digest:", d16(env_key.encode()))
print("PLAINTEXT MATCHES GATEWAY KEY:", d16(plain) == d16(env_key.encode()))
