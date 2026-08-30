# Release Note — 2026-08-30

## Summary

Development refs were fetched and synchronized. A canonical Paperclip candidate was assembled from the latest completed feature lines, but the full repository test gate failed. No production deployment was performed. PaperclipAI remains healthy on port 3100 at commit `9dcb57ed7`.

## Release commits

| Role | Commit | Status |
|------|--------|--------|
| Integration baseline | `cd11a668067720292eab20f992d33f44cbc6644c` | Tasks/artifacts, MinIO project storage, and company artifact-storage policy integrated |
| Task cancellation | `5edb99af8` | Board users can stop active queued, running, and scheduled-retry task agents |
| Production | `9dcb57ed7af8f254309d3232d3646634bb1e111b` | Healthy and unchanged; no candidate commit deployed |

Release branch: `t3-paperclip-aitodo/t_4220e88c-update-all-new-development-and-git-branc`.

## Integrated development

- Tasks/artifact workflow through `9e8248348`: subtask progress, comment-only task delivery, versioned artifacts, MinIO open-file, and WOPI editing.
- Project MinIO/NAS storage through `63daca7af`: authorized NAS-folder configuration with disabled-MinIO preservation.
- Company default artifact storage at `cd11a6680`: new documents, attachments, versions, restore reads, and WOPI reads honor company policy.
- Task-agent cancellation at `5edb99af8`: issue-scoped cancellation for queued, running, and scheduled-retry work.
- Git sync fetched `origin` and `upstream` with pruning, matched all 14 origin-tracking local branches, and corrected one stale local ref.

## Test evidence

| Check | Result | Details |
|-------|--------|---------|
| Focused integrated suite | Pass | 102 passed, 9 skipped |
| Shared typecheck | Pass | `tsc --noEmit` |
| Server typecheck | Pass | `tsc --noEmit` |
| UI typecheck | Pass | `tsc -b` |
| DB typecheck and migration safety | Pass | Migration numbering and safety checks passed |
| Full repository suite | **Fail** | 5 files failed, 283 passed, 103 skipped; 19 tests failed, 2,736 passed, 1,804 skipped |

Full-suite blockers include a missing `@paperclipai/adapter-gemini-local/server` package/export, stale storage mocks missing `createExternalStorageServiceFromConfig`, worktree-provisioning fixture/config failures, and a setup-token route expectation failure. Deployment gate remains closed until these failures are fixed and the full suite passes.

## PaperclipAI port 3100 validation

- Container: `paperclip`
- Image: `paperclip:k20-9dcb57ed7`
- Image digest: `sha256:7e53bceed0a85a09fad8e723e4f13f9567b0e908f64ace800c9833d2545cb92d`
- Container health: `healthy`; restart count `0`
- `http://127.0.0.1:3100/api/health`: HTTP 200, status `ok`
- Reported production commit: `9dcb57ed7af8f254309d3232d3646634bb1e111b`
- Database backup health: enabled and `ok`

## Known issues

- `origin/main` at `9650b7dbd` is a legacy SPA tree, not the deployable Paperclip lineage. It lacks `Dockerfile`, `server/`, `ui/`, `deploy/`, and `pnpm-workspace.yaml`; it must not replace production.
- The canonical candidate is deployable in shape, but its full test suite is not green. Production cutover is blocked.

## Rollback

No rollback was needed because production was not changed. Existing rollback remains available by setting `PAPERCLIP_IMAGE=paperclip:k15-7927f06fa` in the production runtime environment and running `docker compose up -d`, or by using `deploy-prod/scripts/k18-rollback.sh` from the production worktree.