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
| `.github/workflows/e2e.yml` | standalone Playwright run, superseded by `t3-nightly.yml`'s `slow-tests` job |
| `.github/workflows/ci.yml`, `nightly.yml`, `release-prod.yml` | the pre-rename originals of the three `t3-*` workflows. They shared the `t3-nightly` / `t3-prod` compose projects and the same triggers under *different* concurrency groups, so they raced the renamed workflows on every nightly and would have raced the first production tag |
| `.github/workflows/storybook-visual.yml` | half of it was already dead (`pull_request: branches: [master]`, a branch this fork does not have). Removed by owner decision, 2026-09-02 — see the note below |
| `.github/workflows/commitperclip-review.yml` + all of `.github/scripts/` (20 files) | the PR-rule bot (template / linked-issue / coverage gates) and its nine helper modules plus their tests. Removed by owner decision, 2026-09-02 — see the note below |
| `.github/workflows/discord-staging.yml` | manual `Discord staging deploy` for the K16 discord-bridge. Removed by owner decision, 2026-09-02 — see the note below |
| `scripts/ci/k15-run.mjs` | invoked only by the deleted `k15-ci.yml` |
| `scripts/__tests__/release-verify-workflow.test.mjs` | asserted the shape of the deleted `release.yml` |
| `doc/UPSTREAM-SYNC.md` | described the cherry-pick workflow; superseded by this file |

After this, `.github/workflows/` contains exactly three files: `t3-ci.yml`,
`t3-nightly.yml`, `t3-release.yml`. The pipeline they form is described in `CLAUDE.md`
("CI/CD rules for this repository") and `CICD/PLAN_CICD.md`.

### Capabilities deliberately given up

These three were **not** upstream release engineering — they were working, fork-relevant
automation. They were removed anyway, by owner decision on 2026-09-02, to hold the
"only `t3-*` workflows exist" rule. Recorded here so the loss is a decision on the record
rather than a discovery six months from now:

- **Automated PR-rule enforcement** (`commitperclip-review.yml`). `AGENTS.md` §§10–11 and
  `CLAUDE.md` still *require* a filled-in PR template, a linked issue, and test coverage.
  Nothing checks that automatically any more; it is reviewer-enforced. The deleted gates
  were `check-pr-{template,linked-issue,test-coverage,dedup-search,dependencies,lockfile,
  release-bootstrap}.mjs`.
- **Discord bridge staging deploys** (`discord-staging.yml`). `deploy-staging/` is still in
  the tree and still works, but has no automated deploy path; it is now a host-only manual
  procedure. See the superseding note at the top of `docs/rollback-discord-integration.md`.
  Any GitHub Environment secrets that existed solely for this workflow now have no consumer
  and should be reviewed for revocation.
- **Storybook visual baselines in CI** (`storybook-visual.yml`). `pnpm test:storybook-visual`
  is unchanged, but there is no longer a hosted Linux runner for pixel baselines, and
  `doc/DEVELOPING.md` notes that baselines from macOS/Windows are unreliable.

Restoring any of them means adding a fourth workflow and amending the "only `t3-*`
workflows" rule in `CLAUDE.md`.
