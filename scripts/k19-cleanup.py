#!/usr/bin/env python3
"""K19 cleanup: delete the temp acceptance agent and all its K19 test issues
(now blocked/cancelled), leaving production data as before the test."""
import subprocess

DB = ["docker", "exec", "t3-prod-db-1", "psql", "-U", "paperclip", "-d", "paperclip", "-c"]
AGENT = "5e7091a2-4837-46bd-8465-5fdb597d6fc6"

sql = f"""
-- delete test issues assigned to temp agent (and their comments/scheduling)
delete from issue_comments where issue_id in (select id from issues where assignee_agent_id='{AGENT}');
delete from issue_scheduling where issue_id in (select id from issues where assignee_agent_id='{AGENT}');
delete from issue_attachments where issue_id in (select id from issues where assignee_agent_id='{AGENT}');
update issues set assignee_agent_id = null, status='deleted' where assignee_agent_id='{AGENT}';
delete from issues where assignee_agent_id is null and title like 'K19 Hermes gateway acceptance%';
-- delete temp secret + binding + version
delete from company_secret_bindings where secret_id='9bd02b0b-7256-4167-819c-0b8b0a26b5f1';
delete from company_secret_versions where secret_id='9bd02b0b-7256-4167-819c-0b8b0a26b5f1';
delete from company_secrets where id='9bd02b0b-7256-4167-819c-0b8b0a26b5f1';
-- delete temp agent
delete from agents where id='{AGENT}';
"""
open("/tmp/k19-cleanup.sql", "w").write(sql)
subprocess.run(["docker", "cp", "/tmp/k19-cleanup.sql", "t3-prod-db-1:/tmp/k19-cleanup.sql"])
out = subprocess.run(DB + ["-f", "/tmp/k19-cleanup.sql"], capture_output=True, text=True)
print(out.stdout[-800:], out.stderr[:200])
