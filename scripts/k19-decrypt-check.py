#!/usr/bin/env python3
"""K19: THE decisive test — resolve the secret exactly as the server does, by
asking the running Paperclip process itself. Use the server's own decryption:
query the material, decrypt with the master key file from the container env.

Steps:
1. Read PAPERCLIP_SECRETS_MASTER_KEY(_FILE) from the paperclip container env.
2. Pull the secret material (iv/tag/scheme/ciphertext) from the DB.
3. Decrypt (AES-256-GCM) and print ONLY the sha256 digest of the plaintext.
"""
import base64
import hashlib
import json
import subprocess

def d16(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

def container_env(name: str) -> str | None:
    out = subprocess.run(
        ["docker", "exec", "paperclip", "printenv", name],
        capture_output=True, text=True,
    )
    return out.stdout.strip() or None

master_b64 = container_env("PAPERCLIP_SECRETS_MASTER_KEY")
key_file = container_env("PAPERCLIP_SECRETS_MASTER_KEY_FILE")
print("container has PAPERCLIP_SECRETS_MASTER_KEY:", master_b64 is not None)
print("container has PAPERCLIP_SECRETS_MASTER_KEY_FILE:", key_file)

if not master_b64 and key_file:
    # read the key file from inside the container
    out = subprocess.run(
        ["docker", "exec", "paperclip", "cat", key_file],
        capture_output=True, text=True,
    )
    master_b64 = out.stdout.strip()

if not master_b64:
    raise SystemExit("no master key found in container")

key = base64.b64decode(master_b64)
if len(key) != 32:
    # maybe hex or raw
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

from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # host-side; may fail

iv = base64.b64decode(material["iv"])
tag = base64.b64decode(material["tag"])
ciphertext = base64.b64decode(material["ciphertext"])
aes = AESGCM(key)
plain = aes.decrypt(iv, ciphertext + tag, None)
print("decrypted plaintext sha256[:16] =", d16(plain))
print("matches gateway key:", d16(plain) == d16(env_key.encode()))
