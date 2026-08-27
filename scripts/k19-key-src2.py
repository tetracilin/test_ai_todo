#!/usr/bin/env python3
"""K19: find where the RUNNING gateway process's API server key is configured
(search hermes_cli/hermes agent package source for the config field name)."""
import subprocess

out = subprocess.run(
    ["grep", "-rln", "api_server_key",
     "/usr/local/lib/hermes-agent/venv/lib/"],
    capture_output=True, text=True,
)
files = [f for f in out.stdout.splitlines() if "/hermes/" in f or "hermes_cli" in f]
for f in files[:10]:
    print(f)
