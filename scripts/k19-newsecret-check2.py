import base64
import hashlib
import json
import subprocess

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

master_b64 = open("/root/paperclip-data/instances/default/secrets/master.key").read().strip()
key = base64.b64decode(master_b64)

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select material::text from company_secret_versions where secret_id='9bd02b0b-7256-4167-819c-0b8b0a26b5f1' and status='current'"],
    capture_output=True, text=True,
)
material = json.loads(out.stdout.strip())
iv = base64.b64decode(material["iv"]); tag = base64.b64decode(material["tag"])
ct = base64.b64decode(material["ciphertext"])
plain = AESGCM(key).decrypt(iv, ct + tag, None)

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

print("new-secret plaintext len:", len(plain))
print("matches gateway env key:", plain.decode() == env_key)
print("sha256[:16]:", hashlib.sha256(plain).hexdigest()[:16])
