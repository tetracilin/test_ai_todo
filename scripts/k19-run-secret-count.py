#!/usr/bin/env python3
"""K19: check whether the resolved config the runtime uses actually contains
the apiKey binding or a PLAIN value. Inspect the run's error_meta / context for
clues and count how many distinct secrets were accessed per run."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-tAc",
     "select id, created_at from heartbeat_runs where agent_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' "
     "and status='failed' order by created_at desc limit 3"],
    capture_output=True, text=True,
)
runs = [l.split("|")[0] for l in out.stdout.strip().splitlines()]
print("recent failed runs:", runs)

for run_id in runs:
    q = (
        "select count(*) from secret_access_events sae "
        "where sae.heartbeat_run_id = '" + run_id + "'"
    )
    out2 = subprocess.run(
        ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip", "-tAc", q],
        capture_output=True, text=True,
    )
    print(run_id, "secret reads:", out2.stdout.strip())
