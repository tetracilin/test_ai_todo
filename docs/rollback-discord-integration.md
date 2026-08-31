# Rollback — Discord bridge staging deployment

Status: runbook for reverting the staging `discord-bridge` deployment to a
previous known-good commit. Applies to the K16 staging project (`t3-staging`),
never to the live host-network Paperclip (port 3100) or the production `deploy/`
project. Target time to execute the full revert is under 15 minutes.

Scope and sources:

- Deployment pipeline: `.github/workflows/discord-staging.yml` (manual
  `Discord staging deploy` workflow).
- Service definition: `deploy-staging/compose.yaml` (project `t3-staging`).
- Verification probe: `deploy-staging/scripts/healthcheck.sh`.
- Integration contract: `docs/discord-integration.md`.

## 1. What "known good" means here

The staging host builds the bridge image **from source at a pinned commit** — the
fork does not publish registry images yet. The workflow's `build` job resolves an
immutable SHA (`git rev-parse HEAD` of the dispatched ref) and the `deploy-staging`
job checks out exactly that SHA on the host before `docker compose up -d --build`.

Consequence: **reverting the deployment means reverting the checkout, then
rebuilding.** There is no `docker pull <previous-tag>` step. The previous
known-good deployment is the last commit whose deploy run ended with a passing
`./scripts/healthcheck.sh`.

Record it before every deploy:

```sh
# on the staging host, before dispatching a new deploy
git -C "$STAGING_DEPLOY_PATH" rev-parse HEAD   # -> previous known-good SHA
```

The CI run also exposes the deployed SHA: the `build` job output `sha` and the
`Deploy staging Compose project` step log.

## 2. Detect a failed deployment

A deployment is failed if **any** of the following is true. Stop here and roll
back; do not keep retrying the new commit.

CI signals (workflow run):

- `build` job fails: bridge tests, `tsc` build, `docker compose config`, or
  `docker build` errors.
- `deploy-staging` job fails: any SSH step errors, or `./scripts/healthcheck.sh`
  exits non-zero.

Host signals (`cd deploy-staging` on the staging host):

```sh
docker compose -f compose.yaml ps
```

- `discord-bridge` shows `unhealthy`, `restarting`, or `exited`.
- `docker compose ps` reports the service at all times as `starting` (the
  readiness endpoint keeps returning `503 {"status":"starting"}` — the gateway
  connection never established).
- `./scripts/healthcheck.sh` exits non-zero on the bridge probe:

```sh
docker compose -f compose.yaml exec -T discord-bridge node -e \
  "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
```

Log signals:

```sh
docker compose -f compose.yaml logs --tail=100 discord-bridge
```

- `discord_bridge_login_failed` in the logs (bad/rotated token or network
  block to Discord).
- No `discord_bridge_ready` line after the container stabilizes.
- Container restart loops (`docker inspect ... --format '{{.RestartCount}}'`
  keeps climbing).

Behavioral signals:

- The bot is offline in the Discord server.
- Slash commands do not respond, or notifications do not arrive.

Note: `docker compose up -d --build` failing the Compose healthcheck does **not**
fail the command itself — the deploy job's subsequent `./scripts/healthcheck.sh`
is what detects it. A run that ends green but shows a restarting bridge means the
deploy actually failed; trust the probe, not the job color alone.

## 3. Revert staging to the previous known-good commit

Requirements: SSH access to the staging host (`$STAGING_SSH_USER@$STAGING_SSH_HOST`,
same access the workflow uses) and shell access to `$STAGING_DEPLOY_PATH` (the repo
checkout on the host). All secret files live outside git in
`deploy-staging/secrets/*` and are **untouched** by this procedure.

```sh
ssh "$STAGING_SSH_USER@$STAGING_SSH_HOST" \
  "cd '$STAGING_DEPLOY_PATH' && \
   git fetch origin && \
   git checkout --detach '<PREVIOUS_KNOWN_GOOD_SHA>' && \
   cd deploy-staging && \
   docker compose -f compose.yaml up -d --build"
```

- `git fetch origin` ensures the known-good SHA is present locally; if it is not
  yet fetched, fetch first (or reference the SHA by a tag/branch that contains it).
- The compose default bridge image (`ghcr.io/paperclipai/paperclip-discord-bridge:canary`)
  is only a fallback; with `build:` present and no `PAPERCLIP_DISCORD_BRIDGE_IMAGE`
  override in `deploy-staging/.env`, the host rebuilds from the checked-out source.
  Keep the `.env` override unset to stay on the source-build path.
- The `paperclip` app image is pinned independently via `PAPERCLIP_IMAGE`
  (default `paperclip:k15-7927f06fa`); reverting the checkout does not change it.
  Only pin it explicitly if a bad app image was deployed.

If you only need to halt Discord activity immediately and decide later (fastest
containment, no rebuild):

```sh
ssh "$STAGING_SSH_USER@$STAGING_SSH_HOST" \
  "cd '$STAGING_DEPLOY_PATH/deploy-staging' && docker compose -f compose.yaml stop discord-bridge"
```

The bridge holds no durable state (transport only; see `docs/discord-integration.md`
§1), so stopping it loses nothing. Paperclip and Postgres keep serving.

## 4. Restore the previous Docker Compose service state

After the checkout revert (or instead of it, for a service-state-only restore):

```sh
cd "$STAGING_DEPLOY_PATH/deploy-staging"

# Recreate the three services from the reverted checkout
docker compose -f compose.yaml up -d --build

# Confirm expected service set
docker compose -f compose.yaml ps
```

Expected state: services `db`, `paperclip`, `discord-bridge`; `db` and `paperclip`
`healthy`; `discord-bridge` transitions `starting` -> `healthy` once the gateway
connects (30s start period + up to 12 retries of the 15s probe).

Restart-policy caveats:

- `restart: unless-stopped` on all services: a `docker compose stop discord-bridge`
  stays stopped across daemon restarts, but any `docker compose up` will start it
  again. After verifying rollback, either keep it stopped (if the bridge stays
  broken) or let the reverted image run.
- Never run `docker compose down -v` during recovery — it deletes the named
  volumes `t3-staging_postgres-data` and `t3-staging_paperclip-data` (DB and
  Paperclip data). Plain `docker compose down` (volumes kept) is safe if the whole
  staging stack must stop, but is not needed for a bridge rollback.
- Do not run DB downgrades. Migration `0231` (Discord schema) is additive; the
  Discord outbox/delivery tables must remain durable.

## 5. Verify the rollback succeeded

Run every check; the rollback is only complete when all pass.

1. Checkout matches the known-good commit:

   ```sh
   git -C "$STAGING_DEPLOY_PATH" rev-parse HEAD   # == <PREVIOUS_KNOWN_GOOD_SHA>
   ```

2. Full probe suite passes:

   ```sh
   cd "$STAGING_DEPLOY_PATH/deploy-staging" && ./scripts/healthcheck.sh   # exit 0
   ```

   This covers: Postgres readiness (`pg_isready`), Paperclip
   `http://127.0.0.1:3100/api/health`, Hermes relay
   `http://host.docker.internal:8642/health`, and the bridge
   `http://127.0.0.1:8080/health` (200 only when the gateway is connected).

3. Service state is stable:

   ```sh
   docker compose -f compose.yaml ps
   docker inspect "$(docker compose -f compose.yaml ps -q discord-bridge)" \
     --format '{{.State.Health.Status}} restarts={{.RestartCount}}'
   # expect: healthy restarts=0 (or a small stable count that is not climbing)
   ```

4. Bridge logs confirm a clean start:

   ```sh
   docker compose -f compose.yaml logs --tail=100 discord-bridge
   # expect: discord_bridge_ready present, no discord_bridge_login_failed
   ```

5. Functional smoke (Discord side): the bot shows online; a test
   `/paperclip task create` in the staging guild resolves the actor and project,
   creates the issue, and does **not** echo a create notification back to the
   originating channel. If slash commands were not registered in the reverted
   image, register them explicitly:

   ```sh
   docker compose -f compose.yaml run --rm discord-bridge node dist/registerCommands.js
   ```

6. Paperclip still healthy and reachable at `http://127.0.0.1:33120` (independent
   of the bridge).

## 6. Credential-related failure (rotate instead of just revert)

If the failure cause is a leaked or invalid Discord credential, reverting the
commit is not enough:

1. Rotate `DISCORD_BOT_TOKEN` in the Discord Developer Portal and
   `PAPERCLIP_DISCORD_BRIDGE_TOKEN` in the operator secret manager.
2. Update the protected `discord-staging` GitHub Environment secrets to match.
3. Re-run `Discord staging deploy` (or rewrite `deploy-staging/secrets/*` on the
   host to the new values and `docker compose up -d --build`).
4. Verify per §5. Disable channel mappings until validation completes.

## 7. After the rollback

- Leave a comment on the deployment run / card: rolled-back SHA, reason, and
  verification results.
- The reverted checkout on the host is detached; the next successful deploy of a
  fixed commit via the workflow returns it to a pinned checkout automatically.
