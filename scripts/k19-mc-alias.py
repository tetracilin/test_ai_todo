#!/usr/bin/env python3
"""K19: fetch run log from minio using host mc (already configured alias?)."""
import subprocess

out = subprocess.run(["mc", "alias", "list"], capture_output=True, text=True)
print(out.stdout[:400] or out.stderr[:200])
