#!/usr/bin/env python3
"""K19 diagnostic: list env var NAMES of the running gateway process (no values)."""
with open("/proc/74380/environ", "rb") as f:
    env = f.read().decode("utf-8", "replace").split("\0")

names = sorted(e.split("=", 1)[0] for e in env if "=" in e)
hermes_related = [n for n in names if any(k in n.upper() for k in ("HERMES", "KEY", "TOKEN", "GATEWAY", "SERVER"))]
print("total env vars:", len(names))
print("key/token/gateway-related names:", hermes_related)
