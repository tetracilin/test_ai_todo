#!/usr/bin/env python3
"""K19: check the gateway's api_server connect() to see where _api_key came
from at startup, and whether a profile-scoped secret overrides. Read the
startup guard section of api_server.py around line 1511 and 8310."""
lines = open("/usr/local/lib/hermes-agent/gateway/platforms/api_server.py").read().splitlines()
print("\n".join(lines[1500:1530]))
print("=====")
print("\n".join(lines[8300:8340]))
