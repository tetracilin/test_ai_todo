#!/usr/bin/env python3
"""K19: check the gateway's api_server _api_key resolution — the process env
lacks API_SERVER_KEY, so it must come from _get_scoped_secret. Find that fn."""
lines = open("/usr/local/lib/hermes-agent/gateway/platforms/api_server.py").read().splitlines()
for i, l in enumerate(lines):
    if "_get_scoped_secret" in l and ("def " in l or "import" in l):
        print(i + 1, l)
