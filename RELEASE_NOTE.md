# Release Note — 2026-08-30

## Summary

Branch sync and QA completed for commit `9650b7dbd` on `origin/main`. Deployment to PaperclipAI production was **blocked** because the QA-verified commit is a legacy SPA tree incompatible with the Paperclip production environment. Production remains unchanged and healthy at commit `9dcb57ed7`.

## Deployed commit SHA

| Role       | Commit                                                         | Branch       | Status     |
|------------|----------------------------------------------------------------|--------------|------------|
| QA-verified| `9650b7dbd112d6c92ae56b81df391d5422ff0bd3`                     | `origin/main`| Deploy blocked |
| Production | `9dcb57ed7af8f254309d3232d3646634bb1e111b`                     | Paperclip k20| Healthy, unchanged |

## Branch sync (t_d2d8a7a3)

- Fetched `origin` and `upstream` with `--prune`.
- 14 origin-matching local branches verified in sync with origin.
- One stale ref (`t3-paperclip-aitodo/t_d0cf78a9-*`) updated from `9650b7dbd` to `d64eb4174` to match origin.
- No merge conflicts, no uncommitted work touched.
- Evidence: `/root/projects/SW-pc17-26/sync-evidence-t_d2d8a7a3.md`

## Test evidence (t_c925f2c1) — QA PASS

Tested commit: `9650b7dbd112d6c92ae56b81df391d5422ff0bd3` (`origin/main`)

| Check                    | Result     | Details                |
|--------------------------|------------|------------------------|
| Typecheck                | Pass       |                        |
| Unit tests               | Pass       | 23 passed              |
| Integration tests        | Pass       | 6 passed               |
| Test guard               | Pass       | No changed files       |
| Frontend build           | Pass       | Vite bundle advisory (non-gating) |
| Discord bridge build+test| Pass       | 39 passed              |
| Playwright E2E           | Pass       | 7 passed               |
| Local health smoke       | Pass       | `server.cjs` on :4174, `/api/health` and `/` return 200 |

Non-gating warnings: npm audit reports 5 root + 5 bridge vulnerabilities; frontend bundle exceeds Vite 500 kB advisory.

## PaperclipAI port 3100 validation (t_e6f6ce28)

- **Container:** `paperclip`, image `paperclip:k20-9dcb57ed7`
- **Digest:** `sha256:7e53bceed0a85a09fad8e723e4f13f9567b0e908f64ace800c9833d2545cb92d`
- **Health:** `healthy`, restarts `0`
- **Port 3100:** reachable, `:3100/api/health` returns HTTP 200
- **Production commit:** `9dcb57ed7af8f254309d3232d3646634bb1e111b`
- **Database:** healthy
- **Logs:** 47,597 lines, no error/fatal/startup-failure matches

## Known issues

**Tree incompatibility — deployment blocked.** The QA-verified commit `9650b7dbd` is a **legacy SPA tree** that lacks `Dockerfile`, `server/`, `ui/`, `deploy/`, and `pnpm-workspace.yaml`. A diff against production commit `9dcb57ed7` shows 5,003 files changed with 2,989,769 deletions. Replacing the current production image with this tree would be an untested, destructive live cutover. A human cutover decision is required before any production deployment proceeds.

## Rollback

If a production deployment is attempted and needs reversal, the existing K20 rollback path remains available:

1. Set `PAPERCLIP_IMAGE=paperclip:k15-7927f06fa` in the production runtime environment and run `docker compose up -d`, or
2. Use `deploy-prod/scripts/k18-rollback.sh`

Current production image `paperclip:k20-9dcb57ed7` is snapshotted and recoverable.