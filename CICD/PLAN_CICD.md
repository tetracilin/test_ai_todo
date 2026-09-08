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

## 0. Status (as of 2026-09-08)

Phase 1 is landed. Every item that was open on 2026-09-02 is now closed:
- `develop` created; staging/production environments configured (§2.3)
- Upstream workflows removed; only `t3-ci.yml`, `t3-nightly.yml`, `t3-release.yml` remain (§1.1)
- `pr.yml` deleted, its fast jobs salvaged into `t3-ci` (§1.2)
- Repo default branch is `develop` (§2.0)
- Root `package.json` is `"private": true`; no upstream remote (A8, §1.1)

Open:
- **`develop` has no branch protection at all.** `main` requires `unit` / `build` /
  `build-image`; `GET /repos/tetracilin/test_ai_todo/branches/develop/protection` returns
  404 "Branch not protected". The "never push directly to `develop`" rule is convention
  only, not enforced (§2.1).
- **`t3-nightly` has never produced a fully green run** — nine runs to date. Its two jobs are
  independent and fail for unrelated reasons, so read the job, not the run: as of 2026-09-08
  the deploy half is fixed and `slow-tests` is not, which means every run still reads red while
  staging is current:
  - The deploy job was blocked from the 2026-09-04 nightly until 2026-09-08 —
    `/etc/t3/secrets/nightly/paperclip_artifacts_access_key` and `..._secret_key` were made
    mandatory by PR #78 but never created on kmv8. **Resolved 2026-09-08:** the operator
    created both files and the 01:24 dispatch (run `34176567198`) deployed successfully;
    staging now runs `41c64c62`, verified by the workflow's own health check. Staging was
    pinned at `c3c03e81` for five days.
  - `slow-tests` has never been green, and its cause changed mid-window. On 2026-09-02 and
    2026-09-03 it failed on `cli-invocation-safety.test.ts` alone. From 2026-09-04 two real
    regressions took over: a `@paperclipai/db` mock missing `externalObjects` (**PR #80** —
    #80 moved the `externalObjects` deref to module scope in
    `evidence-provider-minio.ts:131`, where it throws at import; under #79 every reference
    was still inside a function body) and a `status-cards` assertion invalidated by the
    dossier intake hook (PR #81). Two further files rotate run to run and look like
    contention flakes.
  - **e2e has never run at all.** `Install Chromium` and `E2E` are later steps in the same
    job as the vitest step and carry no `if: always()`, so the job aborts before them every
    time. There is zero e2e signal, not merely a red one.
- **`t3-release` has never run.** Tag `v0.1.0` exists on `main`, but no production deploy has
  gone through the pipeline. Note `t3-release.yml:102` carries the *same* fail-early gate
  against `/etc/t3/secrets/prod`; PR #78's message asserts prod already has both artifact
  keys, but that has not been checked on the host, so the first release may stop there too.
- **No failure reaches Discord.** `DISCORD_WEBHOOK_URL` is unset. The deploy job logs
  `DISCORD_WEBHOOK_URL not set; skipping`; the `slow-tests` report step exits silently
  (`[[ -n "$WEBHOOK" ]] || exit 0`). Fix this first: it is the reason the items above went
  unnoticed for five days rather than one night. It must be a **repo**-level secret —
  `slow-tests` declares no `environment:`, so an environment-scoped secret is invisible to it
  and the alert that actually mattered would still never fire.

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
| `develop` | Require PR; required checks `unit`, `build`, `build-image`; no force push |
| `main` | Require PR; required checks `unit`, `build`, `build-image`; require branch up to date; no force push; no direct push |

> **Use the bare job names — `unit`, `build`, `build-image` — not `t3-ci / unit`.**
> For GitHub Actions the status-check context is the **job** name, not
> `<workflow> / <job>`. Confirmed against the API rather than assumed:
> `gh api repos/tetracilin/test_ai_todo/commits/<sha>/check-runs --jq '.check_runs[].name'`
> returns `unit`, `build`, `build-image`. (The stale `verify` and `e2e` contexts still on
> `main` are bare job names from `pr.yml` too — same rule.) A prefixed name matches no
> check, so branch protection waits forever for a context that never reports and the
> branch becomes unmergeable. In the settings UI, pick from the search suggestions —
> it only lists contexts GitHub has actually observed, which sidesteps this entirely.

`build` is in the required set because it carries `pnpm scan:client-bundle` and
`pnpm test:e2e:no-google-network` — security gates that must block a merge, not merely report.

**Remove** `policy`, `verify`, `e2e` from `main`'s required checks. They no longer exist after Phase 1; leaving them makes every `develop → main` PR unmergeable.

> **Re-verified 2026-09-07 via `gh api`, not inferred.** Partly fixed since the 2026-09-02
> reading, partly not:
> - `main`'s required contexts are now `["unit", "build", "build-image"]` — the stale
>   `verify` / `e2e` contexts from the deleted `pr.yml` are gone. **Closed.**
> - `develop` still returns HTTP 404 "Branch not protected": no protection at all. CLAUDE.md's
>   "Never push directly to develop or main" is convention, not enforcement. **Still open.**
> - `main` still has `allow_force_pushes: true` (contradicts the CLAUDE.md force-push rule)
>   and `required_linear_history: true` (contradicts the release step's "merge commit, not
>   squash"). **Still open**, but do not assume linear history is a hard blocker: `main`'s tip
>   `2b696cad` *is* a two-parent merge commit landed 2026-09-03, after this setting was first
>   recorded. `enforce_admins` is `false`, so the required reviewer — who is an admin —
>   bypasses it. It is a contradiction to resolve, not a wall. It will bite the first person
>   who releases without admin rights.
>
> These are repo-settings changes a human must make; no PR can make them.

### 2.2 Environments (partly done — re-verified 2026-09-07)

> `gh variable list --env staging` returns only `NIGHTLY_PORT`; `--env production` only
> `PROD_PORT`. **Neither environment defines `SELECTABLE_ADAPTER_TYPES`**, so both stacks run
> on the compose/workflow fallback. The row below describes the intended configuration, not
> the current one.

| Env | Settings |
|---|---|
| `staging` | No protection. Var `NIGHTLY_PORT=33130`. Optional var `SELECTABLE_ADAPTER_TYPES` — comma-separated adapter types selectable when hiring an agent. **Two different defaults, do not conflate them:** unset, the deploy path falls back to `hermes_gateway,claude_local` (`deploy/compose.yaml:53`, `t3-nightly.yml:126`), while the application's own fallback is `hermes_gateway` only (`server/src/adapters/registry.ts:715`). |
| `production` | Required reviewer: `tetracilin` (+ second dev). Deployment branches: `main` and `v*`. Var `PROD_PORT=33100`. Var `SELECTABLE_ADAPTER_TYPES` (same as `staging`) |

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
**Each directory must contain four non-empty files**, not just the two the Hermes copy
carried: `postgres_password`, `better_auth_secret`, `paperclip_artifacts_access_key`,
`paperclip_artifacts_secret_key`. Both deploy workflows fail early and by name if any is
missing (`t3-nightly.yml:88-91`, `t3-release.yml:99-102`), and `deploy/compose.yaml` mounts
all four. The two artifact keys were added by PR #78 on 2026-09-04 and **never created under
`nightly/`** — that is the open P1 in §0. Staging must carry its own credentials; never copy
prod's.

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

Marks verified against the repo and the Actions API on 2026-09-07.

- [x] Phase 1 PR merged: upstream workflows gone, tests salvaged, `doc/ORIGIN.md`, remote removed, `private: true`
- [ ] Default branch `develop`; protections on `develop` and `main` use only `t3-ci` checks
  — **half done.** Default branch is `develop`. `main` requires `unit` / `build` / `build-image`.
  `develop` has no protection record at all.
- [ ] Environments verified; `DISCORD_WEBHOOK_URL` set; fork-PR approval on
  — **`DISCORD_WEBHOOK_URL` is not set.** Every nightly run logs
  `DISCORD_WEBHOOK_URL not set; skipping` and passes an empty `WEBHOOK` to the report step,
  so no failure has ever been announced. This is why seven consecutive red nightlies went
  unnoticed for five days.
- [ ] Runner `kmv8` idle as `ghrunner`, secrets under `/etc/t3/secrets`
  — **half done.** The runner is serving jobs. `nightly/` is missing two of the four required
  secret files, and `prod/` has not been checked (see §0 Open and §3).
- [x] `t3-ci` green on a test PR
- [ ] `t3-nightly` manual run: deploy + health + e2e green
  — **no manual run has ever had a green deploy.** Both 2026-09-02 `workflow_dispatch` runs
  failed in `build-and-deploy-nightly`. Deploy + health were green only in the 2026-09-02 and
  2026-09-03 *scheduled* runs. e2e has never executed at all (see §0).
- [ ] `t3-release` deployed `v0.1.0` after approval — the workflow has never run.
- [ ] Hermes cron disabled — not verifiable from the repo; check on kmv8.
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

- **`review` / Dependency Review fails on every single PR, unconditionally.**
  Cause: GitHub's Dependency Graph is disabled in repo Settings → Security &
  analysis. The job reports `Dependency review is not supported on this
  repository`. It is not a required check. If you see this failing, it is not
  your PR's fault — don't spend time on it. *(The `commitperclip PR Review`
  half of this note is obsolete: `commitperclip-review.yml` and all of
  `.github/scripts/` were deleted in Phase 1 by owner decision, 2026-09-02.
  Automated PR-rule enforcement — filled template, linked issue, coverage —
  no longer exists; those AGENTS.md §§10–11 requirements are now reviewer-
  enforced only.)*
- ~~**`.github/workflows/pr.yml` only triggers on `main`.**~~ **Closed in
  Phase 1.** `pr.yml` is deleted; `t3-ci.yml` triggers on PRs to *both*
  `develop` and `main`, so a develop-targeted PR now gets the full fast gate
  (`unit`, `build`, `build-image`). The slow suites (full vitest, e2e) moved
  to `t3-nightly` and are **no longer merge-blocking** on any branch — that is
  the deliberate trade in §1.2, not an oversight. A green PR means the fast
  gate passed; it does not mean e2e passed.

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
