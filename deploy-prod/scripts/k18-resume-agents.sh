#!/bin/sh
# K18 — restore agent statuses after the cutover passes, from the snapshot
# written by k18-pause-writes.sh. Only touches agents whose pause_reason is
# still `maintenance` (i.e. ones WE paused); pre-existing manual/company
# pauses are left exactly as they were.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SNAP=${1:-$DEPLOY_DIR/backups/agents-status-before.json}
[ -r "$SNAP" ] || { echo "snapshot not readable: $SNAP" >&2; exit 1; }

# target PG: the new compose db (postgres) via psql, or embedded if RUN_TARGET=embedded
RUN_TARGET=${RUN_TARGET:-compose}
if [ "$RUN_TARGET" = "embedded" ]; then
  docker exec paperclip node -e '
    const {Client}=require("/app/node_modules/.pnpm/pg@8.18.0/node_modules/pg");
    const c=new Client({host:"127.0.0.1",port:54329,user:"paperclip",password:"paperclip",database:"paperclip",connectionTimeoutMillis:8000});
    (async()=>{
      await c.connect();
      const rows=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      let restored=0;
      for(const r of rows){
        const res=await c.query("update agents set status=$1, paused_at=null, pause_reason=null where id=$2 and pause_reason=\x27maintenance\x27",[r.status, r.id]);
        restored+=res.rowCount;
      }
      console.log(JSON.stringify({restored, total:rows.length}));
      await c.end();
    })().catch(e=>{console.log("ERR",e.message);process.exit(1)});
  ' "$SNAP"
else
  ENV_FILE=${COMPOSE_ENV_FILE:-$DEPLOY_DIR/runtime.env}
  [ -f "$ENV_FILE" ] || ENV_FILE=$DEPLOY_DIR/.env
  COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
  cd "$DEPLOY_DIR"
  node -e '
    const rows=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const q=(v)=>JSON.stringify(v).replaceAll("\"","\x27");
    for(const r of rows){
      console.log(`update agents set status=${q(r.status)}, paused_at=null, pause_reason=null where id=${q(r.id)} and pause_reason=${q("maintenance")};`);
    }
  ' "$SNAP" > /tmp/k18-resume.sql
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -v ON_ERROR_STOP=1 -f - < /tmp/k18-resume.sql
  echo "resume SQL applied (rows: $(wc -l < /tmp/k18-resume.sql))"
fi
