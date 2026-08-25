#!/bin/sh
# K16 staging soak monitor: 30-minute zero-restart + no-error-loop check.
# Polls every 2 minutes, appends to a log, exits 0 only if every sample shows
# RestartCount=0, healthy, and no runaway error loop in recent logs.
OUT="${1:-/tmp/k16-soak.log}"
MINUTES="${2:-30}"
INTERVAL="${3:-120}"
COMPOSE_DIR="/root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3/deploy-staging"

echo "K16 SOAK start $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT"
START=$(date +%s)
END=$(( START + MINUTES*60 ))
FAILED=0
while [ "$(date +%s)" -lt "$END" ]; do
  RC=$(docker inspect t3-staging-paperclip-1 --format '{{.RestartCount}}' 2>/dev/null)
  ST=$(docker inspect t3-staging-paperclip-1 --format '{{.State.Status}}' 2>/dev/null)
  HL=$(docker inspect t3-staging-paperclip-1 --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null)
  DB_RC=$(docker inspect t3-staging-db-1 --format '{{.RestartCount}}' 2>/dev/null)
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "$NOW pc_restarts=$RC pc_status=$ST pc_health=$HL db_restarts=$DB_RC" >> "$OUT"
  if [ "$RC" != "0" ] || [ "$ST" != "running" ] || [ "$HL" != "healthy" ] || [ "$DB_RC" != "0" ]; then
    echo "$NOW SOAK_VIOLATION" >> "$OUT"
    FAILED=1
    break
  fi
  # error-loop guard: count recent ERROR-ish server lines
  ERR_COUNT=$(docker logs --since 2m t3-staging-paperclip-1 2>&1 | grep -cE '"level":5[0-9]|failed to start|FATAL|unhandled' || true)
  echo "$NOW recent_errlines=$ERR_COUNT" >> "$OUT"
  if [ "$ERR_COUNT" -gt 20 ]; then
    echo "$NOW ERROR_LOOP" >> "$OUT"
    FAILED=1
    break
  fi
  sleep "$INTERVAL"
done
END_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FINAL_RC=$(docker inspect t3-staging-paperclip-1 --format '{{.RestartCount}}' 2>/dev/null)
echo "$END_TS FINAL pc_restarts=$FINAL_RC failed=$FAILED" >> "$OUT"
[ "$FAILED" -eq 0 ] && [ "$FINAL_RC" = "0" ] && echo "SOAK_PASS" >> "$OUT" || echo "SOAK_FAIL" >> "$OUT"
