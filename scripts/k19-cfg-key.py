#!/usr/bin/env python3
"""K19: check whether the gateway's _api_key differs from the env-file key.
The process env has NO API_SERVER_KEY (checked earlier), so the key comes from
config.yaml platforms.api_server.extra.key OR profile-scoped secrets.
Compare digests of any key found in config.yaml with what the listener expects."""
import hashlib
import yaml

def d16(v):
    if v is None:
        return None
    return hashlib.sha256(v).hexdigest()[:16]

cfg = yaml.safe_load(open("/root/.hermes/config.yaml"))
plat = cfg.get("platforms", {})
api = plat.get("api_server", {}) if isinstance(plat, dict) else {}
extra = api.get("extra", {}) or {}
key = extra.get("key")
print("config.yaml platforms.api_server.extra.key digest:", d16(key.encode()) if key else None)
print("env-file API_SERVER_KEY digest:", d16(open('/root/.hermes/.env').read().split('API_SERVER_KEY=')[1].splitlines()[0].strip().encode()))

# Also check gateway multiplex profiles config
print("multiplex_profiles:", cfg.get("gateway", {}).get("multiplex_profiles", cfg.get("multiplex_profiles", "not-set")))
