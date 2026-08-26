#!/bin/sh
# K18 — quiesce production writes before the final dump:
#   1. snapshot every non-terminated agent's (id, status, pause_reason) to
#      deploy-prod/backups/agents-status-before.json (restored by k18-resume-agents.sh)
#   2. pause all of them (pause_reason=maintenance) — host-native scheduler gate
#   3. cancel active issue_recovery_actions (stops the stranded-recovery backstop)
# Run INSIDE the maintenance window, immediately before the dump.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
OUT=${1:-$DEPLOY_DIR/backups/agents-status-before.json}
mkdir -p "$(dirname -- "$OUT")"

docker exec paperclip node -e '
const {Client}=require("/app/node_modules/.pnpm/pg@8.18.0/node_modules/pg");
const c=new Client({host:"127.0.0.1",port:54329,user:"paperclip",password:"paperclip",database:"paperclip",connectionTimeoutMillis:8000});
(async()=>{
  await c.connect();
  const q=async(t)=>(await c.query(t)).rows;
  const rows=await q("select id, name, status, pause_reason from agents where status <> \x27terminated\x27 order by name");
  const paused=await q("update agents set status=\x27paused\x27, paused_at=now(), pause_reason=\x27maintenance\x27 where status <> \x27paused\x27 and status <> \x27terminated\x27 returning id, name");
  let cancelled=null;
  try{ const r=await q("update issue_recovery_actions set status=\x27cancelled\x27, outcome=\x27cancelled_by_operator\x27, resolved_at=now() where status=\x27active\x27 returning id"); cancelled=r.length; }catch(e){ cancelled="ERR:"+String(e.message).split("\n")[0]; }
  const holds=await q("select count(*) n from issue_tree_holds where status=\x27active\x27");
  console.log(JSON.stringify({snapshot:rows, pausedNow:paused.length, recoveryCancelled:cancelled, activeHoldsAfter:holds[0].n},null,1));
  await c.end();
})().catch(e=>{console.log("ERR",e.message);process.exit(1)});
' > "$OUT.snapshot.json"

# keep only the snapshot array in the canonical file
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
fs.writeFileSync(process.argv[2], JSON.stringify(j.snapshot,null,1));
' "$OUT.snapshot.json" "$OUT"

cat "$OUT.snapshot.json"
printf 'wrote %s\n' "$OUT"
