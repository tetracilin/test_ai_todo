#!/usr/bin/env python3
"""K19: verify the agent reply on the succeeded issue (K19-HERMES-RUN-OK)."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-c",
     "select left(body, 300), created_at from issue_comments "
     "where issue_id='6521013d-ebd9-4ad6-a21e-5c98e65e7edd' order by created_at asc"],
    capture_output=True, text=True,
)
print(out.stdout)
