# K14 embedded-to-standalone PostgreSQL rehearsal

Date: 2026-08-22 UTC

## Scope and safety

Rehearsal used only a consistent custom-format `pg_dump` from live embedded PostgreSQL on `127.0.0.1:54329`. Live Paperclip stayed running and healthy; no live database write, restart, deployment, or volume operation occurred. Restore target was disposable Compose project `k14rehearsal`, alternate app port `33114`, with an isolated PostgreSQL volume and no database host port.

Dump evidence:

- Source server: PostgreSQL 18.1.
- Source logical database size at capture: `816371391` bytes.
- Custom dump size: `73273342` bytes.
- Dump catalog: `1733` entries.
- `sha256sum -c`: `embedded-consistent.dump: OK`.
- `pg_restore --list`: exit 0.
- Live container remained healthy with restart count 0.

Dump and disposable credentials remain gitignored under `deploy/backups/` and `deploy/secrets/`; they are not repository artifacts.

## Restore and migration

Target image: `postgres:17.9-alpine@sha256:c7526c0f6c3f30260a563d7bcf8ad778effac59a44f8ffa86678c35418338609`.

Application rehearsal image: local K13 fork build `t3-paperclip:k13`, image digest `sha256:1d9131a85c61b98135abe58f626cfed586bc0f2940bbe9fc48c2d56e08563514`, build commit `96e04ce55059a0e89b7b12f40a454be66df9b3f0`.

Source dump restored with 216 Drizzle migrations. Fork startup applied migrations 217-226, including scheduling migration `0227_nappy_doorman.sql`. Final migration state was `count=226`, `max(id)=226`. Application became healthy on `127.0.0.1:33114`, restart count remained 0, and database exposure inspection returned `HostConfig.PortBindings={}` and `NetworkSettings.Ports={5432/tcp:null}`.

Restore script ran twice from the same verified dump:

| Run | Result | Elapsed |
|---|---|---:|
| 1 | checksum, database recreation, restore, 10 migrations, app health | 58 seconds |
| 2 | checksum, database recreation, restore, 10 migrations, app health | 53 seconds |

Earlier raw restore timing, excluding app migration/start and health, was 41 seconds. Conservative maintenance estimate for final DB restore plus migration/start health is 60 seconds; production window should reserve 5 minutes for checks and rollback decision.

## Data comparison

Key entity counts matched before and after fork migrations:

| Table | Before | After |
|---|---:|---:|
| `companies` | 2 | 2 |
| `agents` | 13 | 13 |
| `issues` | 99 | 99 |
| `issue_comments` | 747 | 747 |
| `projects` | 3 | 3 |
| `heartbeat_runs` | 21014 | 21014 |
| `plugins` | 1 | 1 |
| `user` | 3 | 3 |
| `session` | 7 | 7 |
| `issue_scheduling` | n/a | 0 |
| `scheduling_routines` | n/a | 0 |
| `execution_workspace_runtime_leases` | n/a | 0 |

Sample hashes matched for `companies`, `issues`, `issue_comments`, and `projects`. Normalized hashes also matched for all 13 agents, all users, and all sessions. Agent comparison excluded only migration/startup-maintained `capabilities` and `updated_at`; startup intentionally expanded two built-in summarizer capability strings to include execution-workspace summaries and updated four timestamps. No entity ID changed.

Expected startup/migration row deltas:

- Added empty tables: `execution_workspace_runtime_leases`, `issue_scheduling`, `scheduling_routines`.
- `activity_log`: +1 startup reconciliation record.
- `agent_config_revisions`: +4 built-in-agent reconciliation revisions.
- `document_revisions`: +1 built-in summary document revision.
- `routine_revisions`: +2 built-in routine revisions.

No other table-count difference appeared. Constraint totals changed only through migrations: checks `51→51`, foreign keys `581→593`, primary keys `172→175`, unique constraints `5→6`. This matches three new tables plus migration constraints.

Sequence check:

- `public.heartbeat_run_events_id_seq` stayed `84325`, increment 1.
- Drizzle migration sequence advanced from `216` to `226`, increment 1, matching ten applied migrations.

Database size comparison:

- Source embedded cluster database: `816371391` bytes.
- Dump restored before fork migrations: `703329971` bytes.
- Standalone database after migrations: `703829683` bytes.

Logical restore being 13.79% smaller than embedded storage is expected from dump/restore compaction, not row loss; key counts and hashes matched.

## Login and board smoke

Authenticated smoke on alternate port passed:

- `/auth` returned HTTP 200.
- Disposable account sign-up returned a user and session.
- `/api/auth/get-session` returned the authenticated user.
- A temporary hashed board API key, created only in disposable DB, listed both restored companies: `T3`, `T3-ver2`.
- Board issue query returned restored issue data; sample was `TVE-2`, status `done`.
- `/api/health` returned `status=ok`, commit `96e04ce55059a0e89b7b12f40a454be66df9b3f0`, and `bootstrapStatus=ready`.

## Script fixes found by rehearsal

Rehearsal hardened reusable scripts:

1. Backup checksum sidecars now store a basename, so verification works regardless of caller working directory.
2. Restore resolves input to an absolute path before changing into `deploy/`.
3. Restore recreates the dedicated application database before `pg_restore`, making repeated restores deterministic and removing objects introduced by a previous migrated run.

`pnpm run test:deploy-entrypoint`, shell syntax checks, `docker compose config --quiet`, dump checksum/catalog checks, and both full restore runs passed.

## Rollback steps

1. Keep current embedded container and `/root/paperclip-data` untouched until standalone acceptance completes.
2. Stop new writes and stop candidate Paperclip with its 45-second grace period.
3. Preserve failed standalone PostgreSQL and Paperclip data volumes; never run `docker compose down -v`.
4. Restart prior embedded Paperclip container/image against unchanged embedded data.
5. Verify health, authenticated login, two-company visibility, key entity counts, and representative board issue.
6. Return traffic only after checks pass; retain verified dump and checksum for investigation.

## Residual risk

Rehearsal image is local K13 build, not final K15-published digest. Plugin code/storage outside PostgreSQL was not copied into disposable Paperclip data volume, so restored Honcho plugin entered an expected error state; production must restore matching `paperclip-data`, especially plugin packages and encrypted secrets master key. Live final cutover still requires scheduler/write quiescence and a final verified dump.
