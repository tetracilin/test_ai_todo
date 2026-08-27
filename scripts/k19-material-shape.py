#!/usr/bin/env python3
"""K19: check the secret material structure — is the local_encrypted provider's
decrypted value actually a JSON envelope like {"key": ...}? Inspect the stored
material fields (NOT the ciphertext values) to understand its shape."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select jsonb_object_keys(material) from company_secret_versions "
     "where secret_id='d672fbb1-a8c1-4ab5-b62b-dfd1ff49bb80'"],
    capture_output=True, text=True,
)
print("material keys:", out.stdout.split())

# Also compare with another working agent's secret (Ada etc. use claude adapters,
# but check whether any OTHER hermes_gateway agent exists with a WORKING key).
out2 = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select s.id, s.name from company_secrets s where s.provider='local_encrypted' limit 10"],
    capture_output=True, text=True,
)
print("local_encrypted secrets:")
print(out2.stdout)
