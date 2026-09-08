# kmv8 stack inventory

**Host:** VPS `kmv8` (`srv1772676`), reachable over Tailscale as
`hostinger-kvm8-host.tail9831b.ts.net`.
**Captured:** 2026-09-08, from `docker ps -a` plus repo cross-reference.
**Why this file exists:** four rounds of debugging were spent on an adapter that was
configured correctly, because the URL under test did not say which stack it belonged to.
A hostname and a port are not enough to identify a deployment on this box.

> **Refresh before trusting this file.** Container state drifts; this document does not.
> ```
> docker ps -a --format 'table {{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Image}}\t{{.Status}}'
> ```

---

## The short answer

| I want... | Stack | Reach it at | Kept current by |
|---|---|---|---|
| CI/CD staging | `t3-nightly` | `127.0.0.1:33130` on the host — needs an SSH tunnel | `t3-nightly.yml` |
| production | `t3-prod` | `100.103.41.112:33100` (tailnet) | nothing automatic — see below |
| the WOPI / office pilot | `t3-wopi-staging` | `:8445` (editor UI on `:8444`) | nothing |

**`t3-nightly` is the only stack any workflow currently deploys.** `t3-prod` is *meant* to be
deployed by `t3-release.yml`, but that workflow has never run; the running production
containers were put there by hand. Everything else on this host was hand-started and will not
pick up anything merged to `develop`.

---

## Stacks

### `t3-nightly` — CI/CD staging
| | |
|---|---|
| Containers | `t3-nightly-paperclip-1`, `t3-nightly-db-1` |
| Compose file | `deploy/compose.yaml`, project `t3-nightly` |
| Deployed by | `.github/workflows/t3-nightly.yml` — 22:00 UTC, **only if `develop` changed since the last run**, or on demand via Run workflow |
| Port | `127.0.0.1:33130` → 3100. Not on the tailnet, by design (`t3-nightly.yml:122`) |
| Secrets | `/etc/t3/secrets/nightly/` — four files required (`t3-nightly.yml:88-91`) |

Browse it from a laptop with `ssh -L 33130:127.0.0.1:33130 kmv8`, then open
`http://127.0.0.1:33130`. This needs an SSH key on the host and a `kmv8` alias in your
`~/.ssh/config`. **If you did not open that tunnel, you are not looking at nightly.**

Because the schedule skips when `develop` has not moved, "no deploy happened" can mean
skipped, not failed. Check the Actions tab rather than inferring.

### `t3-prod` — production
| | |
|---|---|
| Containers | `t3-prod-paperclip-1`, `t3-prod-db-1` |
| Compose file | `deploy/compose.yaml`, project `t3-prod` |
| Deployed by | **Nothing, in practice.** `t3-release.yml` exists and triggers on `v*` tags, but has never run. Current containers were deployed by hand |
| Port | `100.103.41.112:33100` → 3100 |
| Secrets | `/etc/t3/secrets/prod/` — same four files (`t3-release.yml:100-102`) |

Production tracks `v*` tags on `main`, **not** `develop`.

### `t3-wopi-staging` — WOPI / document-editing pilot
| | |
|---|---|
| Containers | `t3-wopi-staging-paperclip-1`, `t3-wopi-staging-db-1` |
| Deployed by | **Nothing.** Hand-run; no workflow, no compose file in this repo |
| Ports | `:8445` callback origin, `:8444` editor origin — both *defaults* in `server/src/services/wopi.ts:4-5`, overridable via `PAPERCLIP_WOPI_EDITOR_ORIGIN` / `PAPERCLIP_WOPI_CALLBACK_ORIGIN` |

Its image is a hand-built branch tag (`t3-paperclip:wopi-smoke-fix-taskview-v2`) dated
2026-09-02, six days before this capture. It cannot show anything merged after that date.
Pairs with `t3-office-staging`.

### `t3-office-staging` — Collabora backend
One container running `collabora/code:latest`, the document renderer behind WOPI, reached at
`:8444`. The repo's nearest equivalent is `deploy-staging/office/compose.yaml`, which declares
project name `t8578-office-staging` — a different name, so the running stack came from a
modified or older copy.

### `teable-sandbox-infra` — Teable and its dependencies. **Do not stop.**
| Container | Role |
|---|---|
| `teable`, `teable-db`, `teable-redis` | Teable — system of records for tabular data |
| `minio`, `minio-init` | **Teable's** S3-compatible object store (`minio-init` exits 0 after bucket setup; that is normal) |
| `infra-service`, `git-registry` | Teable infra services |
| `caddy` | Reverse proxy with Cloudflare TLS. Serves `:8444` / `:8445` |

Teable is a first-class evidence provider (`backlog.md:53`) and the target of PC-010, a
Slice 1 work item (`backlog.md:314`). Stopping any of `teable`, `teable-db`, `teable-redis`
or `minio` takes Teable down.

> **This `minio` is not Paperclip's artifact store.** Paperclip's evidence MinIO lives on a
> *different host*: `http://nas-storage-t19.tail9831b.ts.net:9000`
> (`docs/deploy/minio-nas-artifact-storage.md:13-14`), and
> `server/src/services/evidence-provider-minio.ts` calls it "the NAS MinIO evidence bucket."
> Separately, neither deployed Paperclip stack uses S3 at all today:
> `deploy/paperclip-config.json:35` selects `"provider": "local_disk"`, and its `s3` block has
> no `endpoint` and no credential refs. The `paperclip_artifacts_*` secrets are mounted but
> unread. Do not conflate the two MinIOs, as an earlier draft of this file did.

### `honcho` — plugin backend. **Do not stop.**
`honcho-api`, `honcho-deriver`, `honcho-redis`, `honcho-database` (pgvector). Backs a
Paperclip **plugin**; see `docs/deploy/k14-postgres-rehearsal.md:114`, which records a restore
rehearsal where the Honcho plugin entered an error state because plugin storage outside
PostgreSQL was not copied.

### `t3-mvp04-candidate` — possible rollback target
Runs `t3-paperclip:6673cb65b` — **the same image as production.** No repo references. Since
`t3-release` has never run, a hand-rolled standby may be the only rollback path that exists.
Establish what it is before touching it.

### `t3-mvp04-scratch` — probable orphan
Runs `ghcr.io/paperclipai/paperclip:sha-6a4e2e1`, the literal fallback in
`deploy/compose.yaml:26`. Somebody ran `docker compose up` without setting `PAPERCLIP_IMAGE`
and left a full app + database stack running. No repo references.

### Unlabelled containers
| Container | Notes |
|---|---|
| `t3-qa-e2e-pg` | Bare `postgres:17.9-alpine`, no compose project, no repo references. Probable leftover test database |
| `9router` | `decolua/9router:latest`, no compose project, no repo references. **Unknown.** The name suggests it routes traffic; on a host reached over Tailscale and proxying `:8444`/`:8445`, do not stop it before establishing what depends on it |

---

## A dependency that is not a container here

Both `t3-nightly` and `t3-prod` are configured to reach a Hermes API on the host:

```
HERMES_API_BASE_URL: ${HERMES_API_BASE_URL:-http://host.docker.internal:8642}
```

`deploy/compose.yaml:60`, with `extra_hosts: host.docker.internal:host-gateway`. Whatever
serves `:8642` is not in the container list above and is not documented here. If agent runs
fail on both stacks at once, check it.

---

## Before you stop or remove anything

Three different operations, three different consequences.

Halt a container. Data untouched.
```
docker stop t3-mvp04-scratch-paperclip-1
```
Undo:
```
docker start t3-mvp04-scratch-paperclip-1
```

Remove the container. Volumes survive, so data survives.
```
docker rm t3-mvp04-scratch-paperclip-1
```
Undo: recreate it from its compose file, **with the same project name and file**:
```
docker compose -p t3-mvp04-scratch -f deploy/compose.yaml up -d
```
Omitting `-p` creates a *new* stack called `t3-paperclip`, because
`deploy/compose.yaml:1` is `name: ${COMPOSE_PROJECT_NAME:-t3-paperclip}`. Omitting
`PAPERCLIP_IMAGE` pulls the upstream fallback at line 26. Between them, that is how
`t3-mvp04-scratch` came to exist.

**Destroys the data. No undo without a backup.**
```
docker compose down -v
```
```
docker volume rm <volume>
```
```
docker volume prune
```
Never run `docker volume prune` on this host: it does not ask which project you meant, and
Teable's database and object store both live in volumes here. Each Paperclip stack owns a
PostgreSQL volume holding its own companies, agents and issues.

Restart order for a Paperclip stack is database first, then the app.

---

## Known gaps in this document

Recorded rather than guessed, so the next reader knows what was never established:

1. `9router` and `git-registry` have no repo references and no established owner.
2. Whether `t3-mvp04-candidate` is an intentional rollback standby or an abandoned stack.
3. Whether `/etc/t3/secrets/prod/` holds all four required files. `t3-release.yml:100-102`
   gates on them and has never run, so the first production release may stop there.
   The equivalent question for **nightly** is answered: the two artifact-key files were
   missing from 2026-09-04 until the operator created them on 2026-09-08.
4. Which process deployed `t3-prod`'s current containers, and whether the Hermes cron
   (`8b51805f9dc5`, which `CICD/PLAN_CICD.md:229` says to retire) is still running. The
   operator reports still receiving its morning build notifications, so it is not retired.
5. What serves `:8642` (see above).

## Related

- `CICD/PLAN_CICD.md` — pipeline plan, host provisioning runbook (§3), current status (§0)
- `docs/deploy/minio-nas-artifact-storage.md` — the NAS MinIO, which is *not* on this host
- `docs/deploy/tailscale-private-access.md` — tailnet access
- `docs/operating-with-claude-code.md` — how to drive deployments and PRs safely
