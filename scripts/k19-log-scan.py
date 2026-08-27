#!/usr/bin/env python3
"""K19: check whether the adapter's apiKey resolution is failing silently.
Look at the paperclip container logs for the run execution path and any
'apiKey' / 'secretKeys' mentions around the failed run timestamps."""
import subprocess

out = subprocess.run(
    ["docker", "logs", "paperclip", "--since", "15m"],
    capture_output=True, text=True,
).stdout

for line in out.splitlines():
    low = line.lower()
    if ("secret" in low or "apikey" in low or "adapterconfig" in low) and '"req"' not in line:
        print(line[:400])
