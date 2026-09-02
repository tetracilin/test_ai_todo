# Origin

Hard fork of https://github.com/paperclipai/paperclip

- **Forked at upstream commit:** `233c12f029de950f7f1999047395e352bcf4f9d4`
  (`feat: add kimi-local adapter for Kimi Code CLI (CLI + ACP engines) (#9967)`, 2026-08-20)
  — the last commit in this history carrying an upstream PR number. Everything after it is
  fork work.
- **Date of fork decision:** 2026-09-02

## Policy

No upstream remote. No merges or rebases from upstream. Divergence is accepted and expected.

Security fixes may be cherry-picked by a **human** via a `fix/*` PR that cites the upstream
commit in the body (`git cherry-pick -x` so the source sha is recorded in the message).
Fork behaviour wins on conflict unless the pick is precisely the point.

Preserve `LICENSE` and `NOTICE` when copying upstream code.

## What was removed at the fork

Upstream's release engineering was deleted on 2026-09-02, because this fork does not publish
to npm and does not sync from upstream:

| Removed | Why |
|---|---|
| `.github/workflows/release.yml` | npm canary/beta/stable publish pipeline |
| `.github/workflows/release-verify.yml` | `workflow_call` helper, only ever called by `release.yml` |
| `.github/workflows/release-smoke.yml` | `workflow_call` helper, only ever called by `release.yml` |
| `.github/workflows/refresh-lockfile.yml` | lockfile bot; used `gh pr merge --auto`, which the repo does not enable |
| `.github/workflows/docker.yml` | published release images; triggered on `master` (a branch this fork does not have) and `v*`/`nightly/v*`/`beta/v*` branches |
| `.github/workflows/agent-runtime-images.yml` | pushed to `ghcr.io/paperclipai` — **upstream's** registry — on `master` |
| `.github/workflows/k15-ci.yml` | triggered only on the retired `t3-paperclip-aitodo/t_b1377057*` branch pattern |
| `.github/workflows/pr.yml` | replaced by `t3-ci.yml` (fast gate) + `t3-nightly.yml` (slow suites); see `CICD/PLAN_CICD.md` §1.2 for the job-by-job classification |
| `scripts/__tests__/release-verify-workflow.test.mjs` | asserted the shape of the deleted `release.yml` |
| `doc/UPSTREAM-SYNC.md` | described the cherry-pick workflow; superseded by this file |

The pipeline that replaces them is described in `CLAUDE.md` ("CI/CD rules for this
repository") and `CICD/PLAN_CICD.md`.
