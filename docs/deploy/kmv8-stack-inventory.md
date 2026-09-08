# kmv8 stack inventory

**Host:** VPS `kmv8` (`srv1772676`), reachable over Tailscale as
`hostinger-kvm8-host.tail9831b.ts.net`.
**Captured:** 2026-09-08, from `docker ps -a` plus repo cross-reference.
**Why this file exists:** four rounds of debugging were spent on an adapter that was
configured correctly, because the URL under test did not say which stack it belonged to.
A hostname and a port are not enough to identify a deployment on this box.

> **Refresh this file before trusting it.** Container state drifts; this document does not.
> ```sh
> docker ps -a --format 'table {{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Image}}\t{{.Status}}'
> ```

---

## The short answer

| I want... | Stack | Reach it at |
|---|---|---|
| the CI/CD staging target | `t3-nightly` | `127.0.0.1:33130` on the host only — needs an SSH tunnel |
| production | `t3-prod` | `100.103.41.112:33100` (tailnet) |
| the WOPI / office pilot | `t3-wopi-staging` | `https://hostinger-kvm8-host.tail9831b.ts.net:8445` |

**Only `t3-nightly` and `t3-prod` are deployed by CI.** Everything else on this host was
started by hand and will not pick up changes merged to `develop`.

---

## Stacks

### `t3-nightly` — CI/CD staging
| | |
|---|---|
| Containers | `t3-nightly-paperclip-1`, `t3-nightly-db-1` |
| Compose file | `deploy/compose.yaml` |
| Deployed by | `.github/workflows/t3-nightly.yml` (22:00 UTC + manual dispatch) |
| Port | `127.0.0.1:33130` → 3100. Not on the tailnet, by design (`t3-nightly.yml:122`) |
| Secrets | `/etc/t3/secrets/nightly/` — four files required |

Browse it from a laptop with `ssh -L 33130:127.0.0.1:33130 kmv8`, then open
`http://127.0.0.1:33130`. If you did not open that tunnel, you are not looking at nightly.

### `t3-prod` — production
| | |
|---|---|
| Containers | `t3-prod-paperclip-1`, `t3-prod-db-1` |
| Compose file | `deploy/compose.yaml` |
| Deployed by | `.github/workflows/t3-release.yml` — **which has never run.** The current containers were deployed by hand |
| Port | `100.103.41.112:33100` → 3100 |
| Secrets | `/etc/t3/secrets/prod/` — four files required |

### `t3-wopi-staging` — WOPI / document-editing pilot
| | |
|---|---|
| Containers | `t3-wopi-staging-paperclip-1`, `t3-wopi-staging-db-1` |
| Deployed by | **Nothing.** Hand-run; no workflow, no compose file in this repo |
| Reached at | `:8445`, hardcoded as the WOPI callback origin in `server/src/services/wopi.ts:5` |

Its image is a hand-built branch tag (`t3-paperclip:wopi-smoke-fix-taskview-v2`) from
2026-09-02. **It predates most of `develop`** and will not show features merged after that
date. Pairs with `t3-office-staging`.

### `t3-office-staging` — Collabora backend
Single container running `collabora/code:latest`, the document renderer behind WOPI. The
repo's nearest equivalent is `deploy-staging/office/compose.yaml`, which declares project
name `t8578-office-staging` — a different name, so the running stack was launched from a
modified or older copy.

### `teable-sandbox-infra` — shared data services. **Do not stop.**
| Container | Role |
|---|---|
| `minio` | Artifact / evidence object store. What `paperclip_artifacts_access_key` authenticates to |
| `minio-init` | One-shot bucket setup (`Exited (0)`, normal) |
| `teable`, `teable-db`, `teable-redis` | Teable — the system of records for tabular data |
| `infra-service`, `git-registry` | Teable infra services |
| `caddy` | Reverse proxy with Cloudflare TLS. Serves the `:8445` endpoint |

**Production depends on this stack.** MinIO backs the evidence substrate
(`server/src/services/evidence-provider-minio.ts`, `docs/deploy/minio-nas-artifact-storage.md`)
for every Paperclip deployment on the box, not just staging. Teable is a first-class evidence
provider (`backlog.md:53`) and the target of PC-010, a Slice 1 work item (`backlog.md:314`).

### `honcho` — plugin backend. **Do not stop.**
`honcho-api`, `honcho-deriver`, `honcho-redis`, `honcho-database` (pgvector). Backs a
Paperclip **plugin**; see `docs/deploy/k14-postgres-rehearsal.md:114`, which records a
restore rehearsal where the Honcho plugin entered an error state because plugin storage
outside PostgreSQL was not copied.

### `t3-mvp04-candidate` — possible rollback target
Runs `t3-paperclip:6673cb65b` — **the same image as production.** No repo references. Since
`t3-release` has never run, a hand-rolled standby may be the only rollback path that exists.
Establish what it is before touching it.

### `t3-mvp04-scratch` — probable orphan
Runs `ghcr.io/paperclipai/paperclip:sha-6a4e2e1`, which is the literal fallback value in
`deploy/compose.yaml:26`. That means someone ran `docker compose up` without setting
`PAPERCLIP_IMAGE` and left a full app + database stack running. No repo references.

### Unlabelled containers
| Container | Notes |
|---|---|
| `t3-qa-e2e-pg` | Bare `postgres:17.9-alpine`, no compose project, no repo references. Probable leftover test database |
| `9router` | `decolua/9router:latest`, no compose project, no repo references. **Unknown.** The name suggests it routes traffic; on a host reached over Tailscale and proxying `:8445`, do not stop it before establishing what depends on it |

---

## Before you stop or remove anything

These are three different operations with three different consequences:

| Command | Effect | Undo |
|---|---|---|
| `docker stop <name>` | Container halts. **Data untouched** | `docker start <name>` |
| `docker rm <name>` | Container removed. Volumes survive | Recreate from compose |
| `docker compose down -v`, `docker volume rm`, `docker volume prune` | **Destroys the data** | Restore from backup, if one exists |

Each Paperclip stack has its own PostgreSQL volume holding its own companies, agents and
issues. Never run `docker volume prune` on this host: it does not ask which project you meant,
and MinIO's object store and Teable's database both live in volumes here.

The safe sequence for a suspected orphan is: `docker stop` it, leave it stopped for a week,
and only then consider removal. Restart order for a Paperclip stack is database first, then
the app.

---

## Known gaps in this document

Recorded rather than guessed, so the next reader knows what was never established:

1. `9router` and `git-registry` have no repo references and no established owner.
2. Whether `t3-mvp04-candidate` is an intentional rollback standby or an abandoned stack.
3. Whether `/etc/t3/secrets/prod/` holds all four required secret files. `t3-release.yml:99-102`
   gates on them and has never run, so the first production release may stop there.
4. Which process deployed `t3-prod`'s current containers, and whether the Hermes cron
   (`8b51805f9dc5`, which `CICD/PLAN_CICD.md:229` says to retire) is still running. The
   operator reports still receiving its morning build notifications, so it is not retired.

## Related

- `CICD/PLAN_CICD.md` — pipeline plan, host provisioning runbook (§3), current status (§0)
- `docs/deploy/minio-nas-artifact-storage.md` — MinIO artifact storage
- `docs/deploy/tailscale-private-access.md` — tailnet access
- `docs/operating-with-claude-code.md` — how to drive deployments and PRs safely
