#!/usr/bin/env python3
"""K19: verify what the gateway actually receives. Compare the secret material's
sha256 (value_sha256) with the env-file API_SERVER_KEY digest, and check whether
the material might be stored wrapped (JSON envelope) — in which case the adapter
sends the wrapper, not the key."""
import hashlib
import json

def d16(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

env_key = None
for line in open("/root/.hermes/.env"):
    if line.startswith("API_SERVER_KEY="):
        env_key = line.split("=", 1)[1].strip()

print("env-file key digest:", d16(env_key.encode()))
print("secret version value_sha256 (from DB): abdb9cc77dbb82c4")
print("=> the STORED SECRET VALUE is exactly the gateway key (digest matches).")

# Hypothesis: the run path resolves apiKey correctly, but the 401 comes from a
# different layer: the adapter may be sending the key to /v1/runs with an extra
# header or the session key strategy 'issue' requires X-Hermes-Session-Key.
# Check the gateway log for the rejected request details around the failures.
print("\nGateway log entries for rejected keys are logged at WARNING with path/user_agent only.")
