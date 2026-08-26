#!/bin/sh
# K18 — capture entity counts + migration state from a target PG into JSON.
# Usage: COUNT_TARGET=embedded|compose OUT=file.json k18-counts.sh
#   embedded : old host-network container's embedded PG (127.0.0.1:54329) via node+pg
#   compose  : the deploy-prod dedicated PG via `docker compose exec -T db psql`
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/compose.yaml}
ENV_FILE=${COMPOSE_ENV_FILE:-$DEPLOY_DIR/runtime.env}
[ -f "$ENV_FILE" ] || ENV_FILE=$DEPLOY_DIR/.env
TARGET=${COUNT_TARGET:-embedded}
OUT=${OUT:-$DEPLOY_DIR/backups/counts-$TARGET.json}

TABLE_LIST='companies agents issues issue_comments projects heartbeat_runs plugin_entities plugins activity_log users sessions'

if [ "$TARGET" = "embedded" ]; then
  docker exec paperclip node -e '
    const {Client}=require("/app/node_modules/.pnpm/pg@8.18.0/node_modules/pg");
    const c=new Client({host:"127.0.0.1",port:54329,user:"paperclip",password:"paperclip",database:"paperclip",connectionTimeoutMillis:8000});
    (async()=>{
      await c.connect();
      const q=async(t)=>(await c.query(t)).rows;
      const tables = process.argv.slice(1);
      const counts={};
      for(const t of tables){
        const qn = t==="users" ? "\"user\"" : t==="sessions" ? "session" : t;
        try{ counts[t]=(await q("select count(*) n from "+qn))[0].n; }catch(e){ counts[t]="ERR:"+String(e.message).split("\n")[0]; }
      }
      const mig=await q("select count(*) n, max(id) mx from drizzle.__drizzle_migrations");
      const companies=await q("select name, status, paused_at is not null as paused from companies order by name");
      const agents=await q("select count(*) n from agents where status not in (\x27paused\x27,\x27terminated\x27)");
      console.log(JSON.stringify({capturedAt:new Date().toISOString(),target:"embedded",counts,migrations:mig[0],activeAgents:agents[0].n,companies},null,1));
      await c.end();
    })().catch(e=>{console.error("ERR",e.message);process.exit(1)});
  ' $TABLE_LIST > "$OUT"
else
  cd "$DEPLOY_DIR"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -tA -F '|' -c "select tablename from pg_tables where schemaname='public' and tablename in ('companies','agents','issues','issue_comments','projects','heartbeat_runs','plugin_entities','plugins','activity_log','user','session') order by tablename" > /tmp/k18-tables.txt
  # shellcheck disable=SC2013
  for t in $(cat /tmp/k18-tables.txt); do
    n=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -tA -c "select count(*) from \"$t\"" | tr -d '[:space:]')
    echo "$t=$n"
  done > /tmp/k18-counts.txt
  mig=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db psql -U paperclip -d paperclip -tA -c "select count(*)||'/'||max(id) from drizzle.__drizzle_migrations" | tr -d '[:space:]')
  {
    echo "capturedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "migrations=$mig"
    cat /tmp/k18-counts.txt
  } > "$OUT"
fi
printf 'wrote %s\n' "$OUT"
