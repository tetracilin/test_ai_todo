#!/usr/bin/env python3
"""K19: check the gateway's api_server platform _api_key at runtime.
The gateway is a python process; use /proc/74380 mem? No. Instead check
hermes_cli config get output via the CLI (read-only)."""
import subprocess

out = subprocess.run(
    ["/usr/local/lib/hermes-agent/venv/bin/python", "-m", "hermes_cli.main",
     "config", "get", "platforms.api_server"],
    capture_output=True, text=True, timeout=60,
    env={"PATH": "/usr/bin:/bin", "HERMES_HOME": "/root/.hermes",
         "VIRTUAL_ENV": "/usr/local/lib/hermes-agent/venv"},
)
print("stdout:", out.stdout[:400])
print("stderr:", out.stderr[:200])
