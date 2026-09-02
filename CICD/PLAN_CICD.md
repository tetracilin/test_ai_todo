# PLAN_CICD — T3 Paperclip CI/CD (hard-fork edition)

Repo: `https://github.com/tetracilin/test_ai_todo.git`
Host: VPS `kmv8` (single self-hosted runner, label `kmv8`)
Flow: `feature/* → develop (nightly/staging) → main + tag v* (production)`

**Decision recorded 2026-09-02:** this repository is a **hard fork** of `paperclipai/paperclip`. No further merges from upstream. Upstream's release engineering (npm publish, canary/beta, lockfile bot) is removed. Upstream's *tests of application behaviour* are kept and moved into our workflows.

Three workflows, all prefixed `t3-`:

| File | Trigger | Runs on | Purpose |
|---|---|---|---|
| `t3-ci.yml` | PR / push to `develop`, `main` | GitHub-hosted | Merge gate: image builds + fast unit/typecheck |
| `t3-nightly.yml` | 22:00 UTC, on demand | kmv8 | Deploy `develop` to `t3-nightly` (:33130), then e2e against it |
| `t3-release.yml` | tag `v*` on `main` | kmv8 | Deploy to `t3-prod` (:33100) behind a human approval gate |

Everything marked **ASSUMPTION** must be verified against the repo before implementing. Read the file; do not guess.

---

## 0. Status (as of 2026-09-02)

Done by the agent already:
- Phase 0 (fresh-clone patch to Hermes script) — verify tonight's cron result
- `develop` created; staging/production environments configured (§2.3)
- PR #43 retargeted to `develop`, mergeable
- Container deploy workflow exists as `release-prod.yml` → **rename to `t3-release.yml`** (§2.5)
- `ci.yml` reduced to `build-image` only → **rename to `t3-ci.yml`**, re-add fast tests salvaged from `pr.yml` (§1.2)

Open:
- `pr.yml` fails on every branch; `verify`/`e2e` are still required checks on `main` (§1.2, §2.2)
- Upstream workflows still present (§1.1)
- Repo default branch still `main` (§2.0)

---

## 1. Phase 1 — hard-fork cleanup (do first; everything else depends on it)

One PR, labelled `ci`, human-reviewed. Title: `chore: hard fork — remove upstream release engineering`.

### 1.1 Delete upstream release/bot infrastructure
```
.github/workflows/release.yml            # npm canary/beta/stable publish
.github/workflows/release-verify.yml     # if present
.github/workflows/refresh-lockfile.yml   # gh pr merge --auto bot
.github/workflows/<any canary/beta/publish workflow>
scripts/__tests__/release-verify-workflow.test.mjs
scripts/<release-only helper scripts referenced solely by the above>
doc/UPSTREAM-SYNC.md
```
Do **not** delete anything you can't trace to npm publishing or upstream sync. When unsure, leave it and list it in the PR body.

### 1.2 Salvage upstream's real tests from `pr.yml`, then delete `pr.yml`
Read `.github/workflows/pr.yml` and classify every job:

| Job tests… | Action |
|---|---|
| Code behaviour, fast (< 5 min: typecheck, lint, unit) | Move into `t3-ci.yml` job `unit` (replace the ASSUMPTION placeholder there) |
| Code behaviour, slow (sharded vitest, e2e, browser) | Move into `t3-nightly.yml` job `e2e`, running against the freshly deployed `:33130` stack |
| Release process (`policy`, `verify` aggregators, publish dry-runs, changeset checks) | Delete |

Record the classification in the PR body. Then delete `pr.yml`.

**ASSUMPTION A7:** the failing `pr.yml` jobs fail for infrastructure reasons (missing upstream secrets, runner limits), not because the todo-merge broke paperclip tests. **Verify by reading one failed run's first error.** If tests genuinely fail on the merged code, that is a code bug: open a separate `fix/*` PR; do not drop the test.

### 1.3 Record the fork
Create `doc/ORIGIN.md`:
```
Hard fork of https://github.com/paperclipai/paperclip
Forked at upstream commit: <sha>   (git merge-base HEAD <last upstream sha>)
Date of fork decision: 2026-09-02
Policy: no upstream remote, no merges from upstream. Security fixes may be
cherry-picked by a human via a fix/* PR, citing the upstream commit.
```
Remove the remote: `git remote remove upstream` (on every clone that has it, including kmv8 and agent worktrees).

### 1.4 Own dependency management
- `.github/dependabot.yml`: set `target-branch: develop`, group updates, monthly `schedule`. Or delete the file if nobody will review the PRs.
- Leave `allow_auto_merge` **off** — nothing needs it now.

### 1.5 Prevent accidental publish
- `package.json`: set `"private": true` at the root (and in any workspace package that upstream published to npm), or rename the package scope. **ASSUMPTION A8:** check whether any workspace package is published; `pnpm -r exec npm pkg get name` lists them.

Acceptance: `.github/workflows/` contains only `t3-ci.yml`, `t3-nightly.yml`, `t3-release.yml`; `git remote -v` shows only `origin`; `doc/ORIGIN.md` exists; `t3-ci` green on the PR.

---

## 2. Phase 2 — repo settings

### 2.0 Default branch → `develop`
Settings → General → Default branch → `develop`. PRs and `gh pr create` now default to `develop`; agents stop targeting `main` accidentally.

### 2.1 Branch protection

| Branch | Rules |
|---|---|
| `develop` | Require PR; required checks `t3-ci / build-image`, `t3-ci / unit`; no force push |
| `main` | Require PR; required checks `t3-ci / build-image`, `t3-ci / unit`; require branch up to date; no force push; no direct push |

**Remove** `policy`, `verify`, `e2e` from `main`'s required checks. They no longer exist after Phase 1; leaving them makes every `develop → main` PR unmergeable.

### 2.2 Environments (already done — verify)

| Env | Settings |
|---|---|
| `staging` | No protection. Var `NIGHTLY_PORT=33130` |
| `production` | Required reviewer: `tetracilin` (+ second dev). Deployment branches: `main` and `v*`. Var `PROD_PORT=33100` |

### 2.3 Secrets and variables
- Repo secret `DISCORD_WEBHOOK_URL` (incoming webhook for channel `1534836487772704800`)
- Settings → Actions → General → Fork PR workflows: **require approval for all outside collaborators**

### 2.4 Rename workflows
`release-prod.yml → t3-release.yml`, `ci.yml → t3-ci.yml`, `nightly.yml → t3-nightly.yml`. Contents from this package. Update required-check names in §2.1 to match the new `name:` fields.

### 2.5 Move host scripts into the repo (resolves A5)
```
deploy/scripts/image-retention.sh   # from /root/.hermes/scripts/t3-image-retention.sh
deploy/scripts/version-drift.sh     # from /root/.hermes/scripts/t3-version-drift.sh
deploy/scripts/healthcheck.sh       # new — §5
```
`chmod +x`, commit the mode bit.

---

## 3. Phase 3 — self-hosted runner on kmv8

Dedicated user, no sudo, docker group, read access to secrets.

```bash
# as root on kmv8
useradd -m -s /bin/bash ghrunner
usermod -aG docker ghrunner

# secrets: move out of /root so the runner can read them without ACL tricks
mkdir -p /etc/t3/secrets
cp -a /root/.hermes/secrets/t3-nightly /etc/t3/secrets/nightly
cp -a /root/.hermes/secrets/t3-prod    /etc/t3/secrets/prod      # ASSUMPTION A2: verify source path
chown -R root:ghrunner /etc/t3/secrets && chmod 750 /etc/t3/secrets /etc/t3/secrets/* && chmod 640 /etc/t3/secrets/*/*

# runner — get URL + token from repo Settings → Actions → Runners → New self-hosted runner
su - ghrunner -c '
  mkdir -p actions-runner && cd actions-runner &&
  curl -o r.tar.gz -L <URL-from-github-ui> && tar xzf r.tar.gz &&
  ./config.sh --url https://github.com/tetracilin/test_ai_todo --token <TOKEN> --name kmv8 --labels kmv8 --unattended'
cd /home/ghrunner/actions-runner && ./svc.sh install ghrunner && ./svc.sh start
```
`SECRETS_DIR` in both deploy workflows already points at `/etc/t3/secrets/{nightly,prod}`. Update the Hermes script too if it's still the fallback during cutover.

Acceptance: runner **Idle** with label `kmv8`.

---

## 4. Phase 4 — cut over, retire the cron

1. Actions → t3-nightly → Run workflow. Confirm image `paperclip:nightly-<sha>`, `curl 127.0.0.1:33130/api/health` shows that sha, e2e job green, Discord message received.
2. Disable Hermes cron `8b51805f9dc5`. Keep the script one week.
3. First release: PR `develop → main` (merge commit), `git tag -a v0.1.0 -m "First release via Actions" && git push origin v0.1.0`, approve `production` gate, confirm `100.103.41.112:33100/api/health`.
4. After one clean week: delete the cron job and script; hand `/root/projects/t3-paperclip-Aitodo` to the agent team exclusively or archive it.

---

## 5. `deploy/scripts/healthcheck.sh`
```bash
#!/usr/bin/env bash
# usage: healthcheck.sh <url> <expected-commit-sha> [attempts=30] [sleep=5]
set -euo pipefail
url="$1"; want="$2"; n="${3:-30}"; s="${4:-5}"
for i in $(seq 1 "$n"); do
  if body=$(curl -fsS --max-time 5 "$url" 2>/dev/null); then
    got=$(printf '%s' "$body" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')
    if [[ -n "$got" && ( "$got" == "$want"* || "$want" == "$got"* ) ]]; then
      echo "healthy: $url reports commit $got"; exit 0
    fi
    echo "attempt $i/$n: up but commit=$got (want $want)"
  else
    echo "attempt $i/$n: not responding"
  fi
  sleep "$s"
done
echo "FAILED: $url did not become healthy with commit $want" >&2; exit 1
```

---

## 6. Rollback
- Nightly: next run overwrites.
- Production: Actions → t3-release → older tag's run → Re-run all jobs → approve. Code only; schema is not rolled back (see CLAUDE.md migration rule).

---

## 7. Assumptions register

| # | Assumption | Check | If wrong |
|---|---|---|---|
| A1 | `deploy/compose.yaml` reads `PAPERCLIP_IMAGE`, `NIGHTLY_PORT`/`PROD_PORT` | read the file | fix `env:` blocks in both deploy workflows |
| A2 | Prod secrets currently at `/root/.hermes/secrets/t3-prod/` | `ls` on kmv8 | fix the `cp` in §3 |
| A3 | Prod = project `t3-prod`, `100.103.41.112:33100`, health `/api/health` | `docker compose ls` | fix `HEALTH_URL` in `t3-release.yml` |
| A4 | pnpm monorepo; fast test commands discoverable from `pr.yml` | read `pr.yml`, `package.json` | fill `unit` job in `t3-ci.yml` |
| A5 | Retention/drift scripts at `/root/.hermes/scripts/` | `ls` | adjust §2.5 source paths |
| A6 | e2e from `pr.yml` can be pointed at a base URL via env | read the e2e config | if it spins up its own stack, run it in `t3-nightly` *before* deploy instead of against `:33130` |
| A7 | `pr.yml` failures are infra, not real test failures | read one failed run | open `fix/*` PR for the code |
| A8 | Root `package.json` is publishable / needs `"private": true` | `npm pkg get name private` | set it |

---

## 8. Definition of done
- [ ] Phase 1 PR merged: upstream workflows gone, tests salvaged, `doc/ORIGIN.md`, remote removed, `private: true`
- [ ] Default branch `develop`; protections on `develop` and `main` use only `t3-ci` checks
- [ ] Environments verified; `DISCORD_WEBHOOK_URL` set; fork-PR approval on
- [ ] Runner `kmv8` idle as `ghrunner`, secrets under `/etc/t3/secrets`
- [ ] `t3-ci` green on a test PR
- [ ] `t3-nightly` manual run: deploy + health + e2e green
- [ ] `t3-release` deployed `v0.1.0` after approval
- [ ] Hermes cron disabled
- [ ] A1–A8 confirmed or corrected in the PR description

---

## 9. Lessons learned — 2026-09-02 CI stabilization session

An agent spent a `/loop` session pushing CI from red to green before Phase 1
of this plan had landed. Read this before repeating that work; it will save
you from re-diagnosing bugs that are already fixed somewhere, just not where
you're looking.

### 9.1 The root cause of most "mystery" CI failures: `main` and `develop` had silently diverged

Before this fork's flow was `feature → develop → main` (§2.0/§2.1), a long
run of PRs merged **directly into `main`**, bypassing `develop` (see the PR
history — dozens of `base: main` PRs, e.g. #23, #24, #32–#40). Some of those
PRs contained real bug fixes (a database-restore ordering bug, a missing test
mock export, five e2e specs still using a since-locked-out adapter type).
`develop` never got them. The symptom looked exactly like fresh CI breakage
on `develop`, and cost real time to "diagnose" from first principles before
the actual cause (branches drifted apart) was found.

**Before spending more than a few minutes root-causing any test failure on
`develop`, run this first:**
```bash
git fetch origin develop main
git diff origin/develop origin/main -- <the failing file>
```
If `main`'s version already looks correct, the fix already exists — port it
(cherry-pick the commit, or copy the file content) instead of re-deriving it.
`git log origin/develop..origin/main --oneline` shows everything `main` has
that `develop` doesn't; skim it before assuming a failure is new.

This is exactly ASSUMPTION A7 in §7, and it cut both ways this session: some
`pr.yml`/CI failures *were* infra noise (see §9.2), but several others were
real bugs already fixed on `main`. Don't resolve A7 by picking one answer for
the whole repo — check per failure.

**Once Phase 1/2 of this plan land** (single default branch flow, `main` only
advances via `develop` PRs), this class of bug becomes structurally
impossible — that is the actual point of this migration, not just workflow
renames. Until then, assume `main` and `develop` can disagree on any given
file and check.

### 9.2 Known non-bugs — don't re-diagnose these

- **`review` / `commitperclip PR Review` / Dependency Review fails on every
  single PR, unconditionally.** Cause: GitHub's Dependency Graph is disabled
  in repo Settings → Security & analysis (not a required check; PR #31 made
  the step `continue-on-error`, merged 2026-09-02). If you see this failing,
  it is not your PR's fault — don't spend time on it.
- **`.github/workflows/pr.yml` only triggers `on: pull_request: branches:
  [main]`.** A PR opened against `develop` currently gets *only* `review`
  (advisory) and `build-image` — none of the real unit/verify/e2e suite runs.
  Don't read a green develop-targeted PR as "fully tested"; it isn't, yet.
  Full coverage only happens once the branch flows into a `main`-targeted PR.
  This gap closes when `t3-ci.yml` (triggers on both `develop` and `main`,
  §Status table) replaces `pr.yml` in Phase 1.

### 9.3 Working-tree hygiene for agents fixing CI on this repo

- **Never `git checkout -b <new-branch>` in the main checkout while it has
  *any* uncommitted/staged changes**, even ones unrelated to what you're
  about to do. Uncommitted content is working-tree/index state, not
  branch-scoped — it silently rides along onto the new branch and can get
  swept into an unrelated commit (nearly happened this session with another
  in-flight CICD migration's staged files). Always
  `git worktree add ../t3-<purpose> -b <branch> origin/develop` instead, and
  check `git worktree list` first — this repo already accumulates worktrees
  from prior sessions (e.g. `t3-evidence-substrate`, `t3-ssot`); don't touch
  ones you didn't create.
- `git worktree remove` can fail on Windows with "Filename too long" (deep
  `node_modules` paths under MAX_PATH). The worktree still untracks from `git
  worktree list`; the leftover directory is harmless disk clutter, not a git
  problem — don't fight it.

### 9.4 Windows dev-sandbox false negatives (skip if running on Linux/CI)

If you're iterating from a Windows checkout rather than the `kmv8` runner:
- `scripts/run-vitest-stable.mjs` calls `spawnSync("pnpm", ...)` without
  `shell: true` — fails with `ENOENT` on Windows. You cannot reproduce the
  exact CI shard grouping locally this way; test files individually or in
  hand-picked groups instead, and don't conclude "CI-shard-only flakiness"
  from a failed reproduction attempt without first diffing against `main`
  (§9.1) — a "shard mystery" this session turned out to just be a missing
  line in `develop`'s copy of a file.
- `psql` is not spawnable via bare `spawn()` in this sandbox — any
  `packages/db/src/backup-lib.test.ts` test that shells out to `psql` for
  restore will fail locally with `spawn psql ENOENT` regardless of whether
  your fix is correct. Treat that specific failure as environment noise, not
  a verdict; verify DDL-ordering logic by reading it against the other
  restore tests that *do* complete first.
- `pnpm install` in a fresh worktree fails its `postinstall` symlink step
  (`link-plugin-dev-sdk.mjs`, `EPERM` on `packages/plugins/*` symlinks) —
  Windows needs elevation/dev-mode for symlinks. Dependencies still install
  fine before that point; the failure is safe to ignore for test-running
  purposes.
