# Paperclip (T3) — Operator Runbook & New-User Onboarding

Production: Paperclip on host `srv1772676` (Tailscale IP `100.103.41.112`),
serving commit `7927f06fa2ff091ce518e3ea29c51efa8bf971c0` from image
`paperclip:k15-7927f06fa`, with a dedicated PostgreSQL 17.9 container.

---

## Part A — New-user onboarding (try it in 5 minutes)

1. **Get access.** Ask the operator for the URL `http://100.103.41.112:3100`
   (reachable only over Tailscale — install Tailscale and join tailnet
   `tail9831b.ts.net` first). There is no public internet exposure.
2. **Sign up.** Click *Sign up*, use your real e-mail and a strong password.
   The first account for a company becomes its owner.
3. **Create/join a company.** After sign-up you land on company setup.
   Name it after your team. The demo data company is `T3`.
4. **Create your first issue.** Click *New issue*, give it a title and
   description, pick a priority, and assign it to yourself or leave unassigned.
5. **Schedule it (optional).** Open the issue → *Scheduling* → set a date/time
   and duration; it will appear on the Today/Schedule board.
6. **Attach a file.** On the issue page, attach a file — it is stored in S3
   (MinIO) under `paperclip/<company>/issues/...` and survives restarts.
7. **Where to go next.**
   - Board view = kanban of issues (todo / in progress / done).
   - Agents page = hire AI agents that work issues for you.
   - Routines = recurring scheduling rules (e.g. "every weekday 09:00").

If anything fails, check `http://127.0.0.1:3100/api/health` on the host or call
the operator.

---

## Part B — Daily operations cheat-sheet

All commands run on the host as root. Compose project lives in
`deploy-prod/` of the ops repo (`runtime.env` holds credentials).

### Health & status

```sh
curl -s http://127.0.0.1:3100/api/health          # expect status:ok + commit
docker inspect paperclip --format '{{.State.Health.Status}} {{.RestartCount}}'
docker ps --filter name=paperclip --filter name=t3-prod-db-1
docker port t3-prod-db-1                          # must print NOTHING (internal only)
docker network inspect t3-prod_database --format '{{.Internal}}'   # must be true
```

### Logs

```sh
docker logs paperclip --since 30m        # app logs
docker logs t3-prod-db-1 --since 30m     # postgres logs
tail -50 /root/.hermes/logs/gateway.log  # Hermes gateway log (AI runs)
```

### Restart

```sh
docker compose --env-file deploy-prod/runtime.env -f deploy-prod/compose.yaml restart paperclip
# wait ~30 s then check health again
```

### Backups (automatic)

Postgres dumps are produced by the built-in backup task
(`/api/health` shows `databaseBackup.status=ok`). Manual dump:

```sh
docker exec t3-prod-db-1 pg_dump -U paperclip paperclip > manual-$(date -u +%Y%m%dT%H%M%SZ).sql
```

### Restore (from a dump)

```sh
cat <dump>.sql | docker exec -i t3-prod-db-1 psql -U paperclip -d paperclip
```

For full disaster recovery (old embedded-PG layout) see
`docs/deploy/k18-cutover-runbook.md` → "Rollback".

---

## Part C — Hermes gateway (the AI-run path)

Paperclip agents with adapter type `hermes_gateway` dispatch runs to the local
Hermes gateway (`hermes gateway run`, listening on `127.0.0.1:8642`).

Path from the container:
`paperclip container → host.docker.internal (=172.21.0.1):8642 → socat relay → 127.0.0.1:8642 (Hermes)`.

The socat relays must be running:

```sh
ss -tlnp | grep 8642
# expect TWO socat lines: bind=172.20.0.1 and bind=172.21.0.1, plus hermes on 127.0.0.1
```

If a relay line is missing, start it (no systemd unit yet — see Known gaps):

```sh
socat TCP-LISTEN:8642,bind=<bridge-ip>,fork,reuseaddr TCP:127.0.0.1:8642 \
  >>/var/log/paperclip-prod-relay.log 2>&1 &
```

Bridge IPs come from `docker network inspect t3-staging_gateway` /
`t3-prod_database` (gateway field).

### Agent requirements (each of these MUST hold)

| requirement | where |
|---|---|
| `adapter_type = 'hermes_gateway'` | agents table |
| `adapter_config.apiBaseUrl` reachable from inside the container (`http://172.21.0.1:8642`) | agents.adapter_config |
| `apiKey` = `{type:'secret_ref', secretId:<uuid>}` pointing at an ACTIVE secret whose plaintext equals the gateway's API_SERVER_KEY | agents.adapter_config |
| a row in `company_secret_bindings` matching `(company_id, secret_id, target_type='agent', target_id, config_path='apiKey')` AND in the SAME company as the agent | DB |
| `dangerouslyAllowInsecureRemoteHttp=true` while apiBaseUrl is plain-HTTP to a non-loopback IP | agents.adapter_config |
| agent `status='idle'` (not paused/terminated) | agents table |

### Verifying end-to-end

```sh
# from the HOST — should return 200
curl -s -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/v1/models | head
# from INSIDE the container — should return 202 (creates a run)
docker exec paperclip curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://host.docker.internal:8642/v1/runs \
  -H "Authorization: Bearer $API_SERVER_KEY" -H 'Content-Type: application/json' \
  -d '{"input":"health probe"}'
```

Watch a live run:

```sh
docker exec t3-prod-db-1 psql -U paperclip -d paperclip -c \
  "select id,status,error_code from heartbeat_runs order by created_at desc limit 5"
tail -f /root/.hermes/logs/gateway.log       # look for 'rejected invalid API key'
```

Common errors:

| error_code | meaning | fix |
|---|---|---|
| `hermes_gateway_api_key_missing` | apiKey binding missing/empty on the agent | add binding + secret |
| `hermes_gateway_plain_http_remote_denied` | apiBaseUrl uses http:// to non-loopback IP without escape hatch | set dangerouslyAllowInsecureRemoteHttp=true |
| `hermes_gateway_connect_failed` | relay down / wrong bridge IP | restart socat, verify ss output |
| `hermes_gateway_auth_failed` | key sent ≠ listener key | re-sync secret value with API_SERVER_KEY |

---

## Part D — Guard rails

```sh
bash /usr/local/bin/paperclip-healthcheck ; echo $?      # expect 0
docker exec paperclip node /paperclip/scripts/paperclip-circuit-breaker.cjs ; echo $?   # expect 0
ls /root/paperclip-*-ALERT.md 2>/dev/null                 # absence = good
cat /etc/cron.d/paperclip-healthcheck                     # every 5 min
```

Circuit breaker trips when an agent has ≥5 consecutive failed runs in 90 min;
it pauses the offender and writes `/root/paperclip-circuit-breaker-ALERT.md`.
A tripped agent stays paused until a human resumes it.

---

## Part E — Known gaps / follow-ups

- No systemd unit for the socat relays — they die on reboot. Install one per
  bridge (pattern: `deploy-staging/hermes-bridge-relay.service`).
- No cron entry for the circuit breaker — run manually or add to cron.d.
- Host-reboot behaviour of the whole stack is still unverified.
- Old embedded-PG data dir (~11 GB) retained at `/root/paperclip-data` as the
  K18 rollback source; reclaim after this acceptance is signed off.
