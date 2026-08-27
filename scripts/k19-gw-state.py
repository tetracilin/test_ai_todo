#!/usr/bin/env python3
"""K19: check the gateway's own runtime state for the effective API key source.
Look at gateway_state.json argv and any profile env snapshot. Also check whether
there is a second Hermes gateway (different HERMES_HOME) listening on 8642 —
the process cwd/environ shows HERMES_HOME=/root/.hermes."""
import json
import subprocess

state = json.load(open("/root/.hermes/gateway_state.json"))
print("argv:", state.get("argv"))
print("pid:", state.get("pid"), "hermes_home:", state.get("hermes_home"))

# check the process cwd
out = subprocess.run(["readlink", "-f", "/proc/74380/cwd"], capture_output=True, text=True)
print("cwd:", out.stdout.strip())
