#!/usr/bin/env python3
"""K19: check agent.env in config.yaml for an API_SERVER_KEY override (digest)."""
import hashlib
import yaml

def d16(v):
    return hashlib.sha256(v.encode()).hexdigest()[:16] if v else None

cfg = yaml.safe_load(open("/root/.hermes/config.yaml"))
agent_env = cfg.get("agent", {}).get("env", {}) or {}
for k, v in agent_env.items():
    if "SERVER" in k.upper() or "KEY" == k.upper():
        print(k, "->", d16(str(v)))

print("done; API_SERVER_KEY in agent.env:", "API_SERVER_KEY" in agent_env)
