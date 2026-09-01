# Release Note — 2026-09-01

## Summary

PaperclipAI was updated in production. Candidate commit
`6673cb65b7139078323a56d90131ed01e52b5f5c` was deployed to **t3-prod** and is healthy
on `localhost:33100` (host mapping to the container's port 3100). The release integrates
the NotebookLM (NLM) adapter series, task-agent cancellation, MinIO/NAS artifact storage
(project folders and company default artifact storage), the Discord bridge authority,
versioned artifact editing, and deterministic company project-list ordering. UI, API
health, OpenAPI, database, migrations, and post-deploy logs all pass.

## Release identifier

| Field        | Value                                                        |
|--------------|--------------------------------------------------------------|
| Release date | 2026-09-01                                                   |
| Deployed SHA | `6673cb65b7139078323a56d90131ed01e52b5f5c`                   |
| Deploy branch| `wt/qa-no-go-aba9eae0-fix-r2` (PR #22)                       |
| Product      | PaperclipAI (T3 fork), t3-prod                               |
| Service      | `localhost:33100` → container port 3100                      |

The deployed candidate descends from integration base `aba9eae0d`
(`merge: integrate current origin/main (Discord bridge authority, lifecycle notifications,
docker/worktree ignores) into nightly integration`). It is based on `origin/main`
(`8fea5a31d`), which was the last commit integrated at deployment time.

## User-visible changes

- **NotebookLM (`notebooklm_local`) adapter** — full adapter lifecycle: `nlm` CLI baked
  into the image, scaffolded adapter package with typed `execute`/`parse`/`config-schema`,
  a `testEnvironment()` auth probe, policy/adapter surface registration, UI config and
  transcript polish, and safely formatted CLI results. (`NLM-a01` … `NLM-a10`)
- **Task-agent cancellation** — board users can cancel active queued, running, and
  scheduled-retry task agents. (`5edb99af8`)
- **Subtasks** — new subtask progress/status APIs and UI reporting. (`752115ff7`,
  `e241c6c3c`)
- **Comment-only task chat delivery** — issue chat can be delivered as comments only.
  (`0d4439b09`)
- **Versioned artifact editing** — WOPI-based editor workflow with named versions,
  restored editor canvas and origin, and route-level company boundary coverage.
  (`b58f24309`, `8ddbe1ae9`, `f637abcbe`, `9e8248348`, `871e977b2`)
- **Company-aware Today/Schedule/Goals URLs** — schedule and goals routes are company
  scoped. (`9dcb57ed7`)
- **Deterministic company project list ordering** — archived projects sort last, then by
  `createdAt`, then `id`; previously Postgres returned arbitrary row order (a live product
  bug that also affected pagination). (`6673cb65b`)

## Backend / infrastructure changes

- **Discord bridge authority** — new `discord-bridge/` package, Discord integration
  authority migration, lifecycle notification enqueueing, and server wiring.
  (`b934e802a`, `8bdd55e21`)
- **MinIO / NAS artifact storage** — project MinIO NAS storage folders, authorized
  storage-config updates with disabled-MinIO preservation, external-storage config hooks
  with named secret refs, and a company default artifact-storage policy for new documents,
  attachments, versions, restore reads, and WOPI reads. (`a9bf87fb3`, `fb178ec19`,
  `63daca7af`, `cd11a6680`, `d35f4b7a2`)
- Build/CI hygiene: kanban worktrees excluded from the Docker build context, hermes
  worktree roots ignored. (`8fea5a31d`, `72759916e`)
- `process` adapter remains operator-only; selectable adapters stay exactly
  `hermes_gateway` and `notebooklm_local`.

## Migrations

Five migrations shipped in this deployment (applied as part of the safe restart):

| ID    | Migration                         | Purpose                                  |
|-------|-----------------------------------|------------------------------------------|
| 0229  | `0229_striped_joseph`             | (rolled with the NLM/storage series)     |
| 0230  | `0230_heavy_marvel_zombies`       | (rolled with the NLM/storage series)     |
| 0231  | `0231_project_minio_nas_folder`   | Project MinIO/NAS storage folder         |
| 0232  | `0232_company_artifact_storage`   | Company default artifact storage policy  |
| 0233  | `0233_discord_integration_authority` | Discord integration authority table   |

Pre-release database dump created and catalog-validated before restart:
`paperclip-pre-6673cb65b-20260901T024029Z.dump` (SHA-256 sidecar).

## Test summary

Authoritative evidence is Release Gates CI run `33450743554` on the exact deployed SHA
`6673cb65b`, all green with zero `continue-on-error`:

| Gate            | Result | Details                                                        |
|-----------------|--------|----------------------------------------------------------------|
| Static          | PASS   | `install --frozen-lockfile`, recursive typecheck, `check:no-google-runtime`, `test:check-no-google-runtime`, `check:token-gates`, `git diff --check` |
| Unit            | PASS   | 1295 files / 13599 tests, 0 failed (3 files / 14 tests skipped)|
| Build + E2E     | PASS   | `pnpm build`, bundle scan, Playwright chromium, no-Google network guard, Hermes-gateway fixture contract, full non-root browser E2E |

Additional verified facts on the deployed SHA: no-Google source inventory is clean (zero
forbidden runtime paths, allowlist not broadened), and the four prior release-contract
blockers are closed (selectable-adapter policy parity, `notebooklm_local` company-import
fallback, active `k17-qa-evidence.md` with disclaimer, and the exercised
`.github/workflows/release-gates.yml`).

## Known issues / caveats

- **Independent QA sign-off not obtained.** The release-gate verification was executed by
  Claude Code at direct operator instruction (the full Vitest gate cannot complete on this
  VPS host) and the same party authored the fix commit; it is not an independent `t3-qa`
  agent GO. The operator accepted this basis for the 2026-09-01 release-gate decision.
- **PR #22 is not merged to `main`.** This deploys an unmerged branch candidate
  (`wt/qa-no-go-aba9eae0-fix-r2`); a merge to `main` is pending.
- **LLM-backed E2E not exercised.** Browser E2E ran with `PAPERCLIP_E2E_SKIP_LLM=true`, so
  LLM-backed browser paths were not covered.
- **Root-host test skip.** Embedded-Postgres test suites skip silently when run as root on
  this host; they execute under CI and non-root UID 1000.

## Upgrade notes

- Apply the five migrations (0229–0233) as part of restarting the service; they create
  independent tables/columns/policies and are safe to order sequentially.
- `process`-adapter agents are not selectable by normal users; open an agent with
  `hermes_gateway` or `notebooklm_local`.

## Rollback

If the deployed release needs to be reverted to the prior production state:

1. Set `PAPERCLIP_IMAGE=t3-paperclip:v0.1.0` (commit `7927f06fa`) in the production
   runtime environment and run `docker compose up -d`, or
2. Use `deploy-prod/scripts/k18-rollback.sh` from the production worktree.

The pre-deployment PostgreSQL dump
(`paperclip-pre-6673cb65b-20260901T024029Z.dump`, catalog-validated with SHA-256 sidecar)
is available for database-level restore if required.