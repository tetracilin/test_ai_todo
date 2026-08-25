#!/bin/sh
# K17 QA — container restart persistence (staging app container).
set -eu
COMPOSE_DIR="/root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3/deploy-staging"
cd "$COMPOSE_DIR"

echo "== pre-restart =="
docker inspect t3-staging-paperclip-1 --format 'restarts={{.RestartCount}} health={{.State.Health.Status}}'
PRE_ISSUES=$(docker compose exec -T db psql -U paperclip -d paperclip -qtA -c "select count(*) from issues;")
PRE_RUNS=$(docker compose exec -T db psql -U paperclip -d paperclip -qtA -c "select count(*) from heartbeat_runs;")
PRE_COMMIT=$(curl -sS http://127.0.0.1:33120/api/health | sed -E 's/.*"commit":"([^"]+)".*/\1/')
echo "pre issues=$PRE_ISSUES runs=$PRE_RUNS commit=$PRE_COMMIT"

echo "== restarting paperclip container =="
docker restart t3-staging-paperclip-1
sleep 18

echo "== post-restart =="
docker inspect t3-staging-paperclip-1 --format 'restarts={{.RestartCount}} health={{.State.Health.Status}}'
POST_ISSUES=$(docker compose exec -T db psql -U paperclip -d paperclip -qtA -c "select count(*) from issues;")
POST_RUNS=$(docker compose exec -T db psql -U paperclip -d paperclip -qtA -c "select count(*) from heartbeat_runs;")
POST_COMMIT=$(curl -sS http://127.0.0.1:33120/api/health | sed -E 's/.*"commit":"([^"]+)".*/\1/')
echo "post issues=$POST_ISSUES runs=$POST_RUNS commit=$POST_COMMIT"

[ "$PRE_ISSUES" = "$POST_ISSUES" ] && [ "$PRE_RUNS" = "$POST_RUNS" ] && [ "$PRE_COMMIT" = "$POST_COMMIT" ] \
  && echo "K17_RESTART_PERSISTENCE_PASS" || echo "K17_RESTART_PERSISTENCE_FAIL"
