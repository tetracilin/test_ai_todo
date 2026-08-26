# K19 — Final acceptance evidence report (t_76eb5a4a)

Date: 2026-08-26 UTC. Branch `t3-paperclip-aitodo/t_76eb5a4a-k19-final-acceptance-and-operator-runboo`.
Acceptance target: NEW production stack per K18 handoff —
`http://127.0.0.1:3100` + tailnet `http://100.103.41.112:3100`,
commit `7927f06fa2ff091ce518e3ea29c51efa8bf971c0`, image
`paperclip:k15-7927f06fa`, standalone PostgreSQL 17.9 (`t3-prod-db-1`, internal-only),
migrations **227**.

## Acceptance checklist

| # | item | result | evidence |
|---|---|---|---|
| 1 | Repo URL / default branch / release commit ancestry | PASS with caveat (see notes) | repo `github.com/tetracilin/test_ai_todo`; default branch `origin/main` @ `9650b7dbd`. Release commit `7927f06fa` is NOT a git descendant of origin/main — the two histories are unrelated (fork re-import), so ancestry is proven via CI + tag instead |
| 2 | Release lineage proof | PASS | full K15 CI run report at `report/k15-ci/run-2026-08-25T17-40-47-213Z.md`: all 11 gates GREEN, Published YES, CI run https://github.com/tetracilin/test_ai_todo/actions/runs/32879271463, commit pinned in the run header = production commit; tag `legacy-gemini-spa-9650b7d` → `9650b7dbd112…` preserves the pre-fork legacy SPA tip |
| 3 | Legacy SPA tag | PASS | tag `legacy-gemini-spa-9650b7d` resolves to `9650b7dbd` (= current main tip); nightly deploy script untouched and targets port 4173 only |
| 4 | CI run + image digest | PASS | g9-image-build GREEN: image `paperclip:k15-7927f06fa2ff091ce518e3ea29c51efa8bf971c0`, digest `sha256:d94b89855c91…` recorded in the same CI report; production container runs exactly this tag |
| 5 | Production health | PASS | `/api/health` → `{"status":"ok","commit":"7927f06fa…","bootstrapStatus":"ready","databaseBackup":{"status":"ok"}}`; container healthy, restarts=0 since start 2026-08-26T04:05:20Z |
| 6 | Tailnet access | PASS | HTTP GET `http://100.103.41.112:3100/` from host → 200 (k19-tailnet-check.py) |
| 7 | PostgreSQL version & exposure | PASS | `select version()` → PostgreSQL 17.9 (Alpine) inside `t3-prod-db-1`; `docker port t3-prod-db-1` empty; `t3-prod_database` network internal=true; migration count = **227** (`drizzle.__drizzle_migrations`) |
| 8 | Backup status | PASS | `/api/health.databaseBackup` ok/enabled; checksummed dumps on disk: `embedded-final-20260826T035847Z.dump` (74,793,769 B) + `.sha256`, plus 10.9 GB data tarball + `.sha256` (K18 rollback artifacts) |
| 9 | Scheduling E2E (live stack) | PASS | k19-e2e.sh: board-key auth OK → routine create (201) → get → patch(status=paused) → issue scheduling PUT/GET → DELETE both `{"deleted":true}`. Routine id `75b9cb…`, issue id `efd20591…` |
| 10 | Attachment upload (S3 write path) | PASS | POST multipart → 201, provider `s3`, objectKey `ca743e8c…/issues/<id>/2026/08/26/…-k19-attachment.bin`; GET content → 200, sha256 round-trip identical (`37bfc76572cc…`) |
| 11 | Paperclip-triggered Hermes run | PASS | temp agent `K19 Hermes acceptance` (hermes_gateway clone) assigned a fresh issue → heartbeat_runs row `succeeded` 2026-08-26T08:35:10→08:35:51Z; agent replied **K19-HERMES-RUN-OK** as an issue comment; relay path container→172.21.0.1:8642→Hermes exercised end-to-end |
| 12 | No-Google scans | PASS (carried) | K15 gate g2-no-google-blocking GREEN at the release commit ("source gate clean; checker + scanner self-tests pass") — blocking mode armed by K12 |
| 13 | Browser network trace | PASS (carried) | K15 gate g8-playwright-e2e GREEN at the release commit: "browser network trace shows 0 legacy provider requests" |
| 14 | Rollback instructions & last tested restore | PASS | staging drill 59s backup→restore→healthy with identical counts (K18 evidence §Rollback drill); scripted rollback `deploy-prod/scripts/k18-rollback.sh`; checksummed dump + tarball retained |
| 15 | Zero uncommitted production source patches | PASS | `git status --porcelain` on prod worktree clean apart from gitignored runtime files; all host-side deltas are documented in K18 evidence §"Production changes outside the repo" |
| 16 | Operator runbook + new-user README | DONE | `docs/deploy/k19-operator-runbook.md` (Part A = new-user onboarding, Parts B–E = operations, Hermes gateway, guard rails, known gaps) |

## Notes & deviations

- **Ancestry**: plan asks for "release commit and upstream-ancestry proof".
  The fork's history was rewritten during canonical-lineage work (K3), so
  `7927f06fa` is not a git ancestor of `origin/main`. Lineage is instead proven
  by (a) the published CI run bound to the exact commit SHA, (b) the image tag
  embedding that SHA running in production, and (c) the legacy SPA tag. This is
  documented here for the reviewer.
- **Temp test data**: all K19 test issues, comments, attachments, the temp
  hermes_gateway agent, its secret binding/version, and temp board API keys were
  deleted or terminated after acceptance. Production entity counts return to
  their K18 baselines (activity_log rows for the test runs remain, as expected).
- **Relay durability**: socat relays are still background processes; systemd
  install remains an operator follow-up (runbook Part E).

## Residual risk

- Host-reboot behaviour unverified (carried from K17/K18).
- Circuit-breaker cron still not installed (script verified manually, exit 0).
- If the Hermes `.env` API_SERVER_KEY rotates, every hermes_gateway agent's
  stored secret must be rotated too (runbook Part C table).
