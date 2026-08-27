#!/usr/bin/env python3
"""K19: check the gateway log around 07:41:50 for the rejected key entry —
compare the count of POST /v1/runs rejections with the run's create attempts.
Also test: does the gateway accept the key when sent WITHOUT 'Bearer ' prefix,
or with extra whitespace? The adapter builds 'Bearer <key>' — same as probe.
The remaining difference: the ADAPTER runs inside the container and reaches the
gateway via host.docker.internal -> 172.21.0.1 (socat). Our successful probes
used the same path... but from a DIFFERENT source port. Timing? Let's tail
gateway log entries at the exact second of a new run attempt."""
import subprocess

# Trigger nothing; just watch correlation for 30s while runs retry
out = subprocess.run(["tail", "-20", "/root/.hermes/logs/gateway.log"],
                     capture_output=True, text=True)
print(out.stdout)
