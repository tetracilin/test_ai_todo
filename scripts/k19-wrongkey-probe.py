#!/usr/bin/env python3
"""K19: check the gateway's api_server _expected_api_key with profile scope:
the adapter may be sending an X-Hermes-Profile header? No — check whether the
gateway runs multiplexed profiles; then profile-scoped get_secret reads
~/.hermes/profiles/<name>/.env. All profile .envs match the env key, so auth
should pass. Since it doesn't, verify what key value the ADAPTER actually
resolves at run time: add temporary observability via Paperclip activity_log?
No - simplest decisive test: change the shared API_SERVER_KEY? NO - too risky.

Better: check if there are TWO listeners on 8642 (hermes direct + socat) and
the container path hits socat -> 127.0.0.1:8642 = hermes. Same process.

Actually re-examine: our in-container probe DID succeed (202). The only
difference between probe and adapter request: user-agent and exact header set.
The gateway logs show user_agent='node' for rejected requests. Our python
probe had user_agent='Python-urllib'. Both hit same listener.

=> The adapter IS sending a wrong key. The secret access events log success,
but that's the DB read, not what reaches fetch(). Perhaps the runtime passes
the WHOLE binding object as the apiKey string (JSON), not the decrypted value.
Test locally: send a request with Authorization: Bearer <json-object> and see
if we reproduce 401 + 'node'-like behavior."""
import base64
import hashlib
import json
import subprocess
import urllib.request

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# decrypt current secret material to double-check plaintext is plain string
master_b64 = open("/root/paperclip-data/instances/default/secrets/master.key").read().strip()
key = base64.b64decode(master_b64)
out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select material::text from company_secret_versions where secret_id='9bd02b0b-7256-4167-819c-0b8b0a26b5f1'"],
    capture_output=True, text=True,
)
material = json.loads(out.stdout.strip())
iv = base64.b64decode(material["iv"]); tag = base64.b64decode(material["tag"])
ct = base64.b64decode(material["ciphertext"])
plain = AESGCM(key).decrypt(iv, ct + tag, None)
print("plaintext type check: len", len(plain), "starts-with-brace:", plain[:1] == b"{")

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()
print("plain == env key:", plain.decode() == env_key)

# now test: binding object as bearer
binding = json.dumps({"type": "secret_ref", "secretId": secret_id}) if False else None
req = urllib.request.Request(
    "http://127.0.0.1:8642/v1/runs",
    data=json.dumps({"input": "x"}).encode(),
    headers={"Authorization": "Bearer NOT-THE-REAL-KEY-1234567890",
             "Content-Type": "application/json"},
    method="POST",
)
try:
    urllib.request.urlopen(req, timeout=10)
except urllib.error.HTTPError as e:
    print("wrong-key probe:", e.code)
