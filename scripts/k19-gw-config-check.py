#!/usr/bin/env python3
"""K19 diagnostic: find where the running Hermes gateway gets its server key
(names/paths only; values never printed)."""
import hashlib
import json

def digest(v: bytes) -> str:
    return hashlib.sha256(v).hexdigest()[:16]

# 1. config.yaml — look for gateway api key paths (names only)
import yaml  # noqa: E402

cfg = yaml.safe_load(open("/root/.hermes/config.yaml"))

hits = []

def walk(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{path}{k}"
            if isinstance(v, (dict, list)):
                walk(v, p + ".")
            elif any(s in k.lower() for s in ("key", "token", "secret")):
                hits.append((p, bool(v)))

walk(cfg)
for path, present in hits:
    if "gateway" in path.lower():
        print(f"config: {path} = {'<present>' if present else '<empty>'}")

# 2. gateway_state.json
try:
    state = json.load(open("/root/.hermes/gateway_state.json"))
    print("gateway_state.json keys:", sorted(state.keys()))
except Exception as e:  # noqa: BLE001
    print("gateway_state.json:", e)
