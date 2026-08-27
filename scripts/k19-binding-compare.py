#!/usr/bin/env python3
"""K19: compare binding row shape against a WORKING agent's binding (e.g. an
agent whose hermes_gateway run works — none in prod, but check what columns
differ: projection_class, version_selector, required)."""
import subprocess

out = subprocess.run(
    ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip",
     "-c",
     "select id, secret_id, target_id, config_path, version_selector, required, projection_class "
     "from company_secret_bindings where target_id='5e7091a2-4837-46bd-8465-5fdb597d6fc6' or target_id='24c36c90-a6f8-4a58-ac67-b143eaa142dc'"],
    capture_output=True, text=True,
)
print(out.stdout)
