# T3 Paperclip CI/CD migration plan

Repo: `https://github.com/tetracilin/test_ai_todo.git`
Host: VPS `kmv8` (single self-hosted runner)
Target flow: `feature/* → develop (nightly/staging) → main + tag v* (production)`

This plan replaces the Hermes cron script `/root/.hermes/scripts/t3-nightly-build.sh` with three GitHub Actions workflows. Build/deploy logic stays on kmv8 (self-hosted runner); GitHub owns triggering, run history, logs, and the production approval gate.

Everything marked **ASSUMPTION** must be verified against the repo before implementing. Do not guess — read the file and adjust.

---

## 0. Assumptions to verify first

| # | Assumption | Where to check | What to do if wrong |
|---|---|---|---|
| A1 | `deploy/compose.yaml` reads the image from env `PAPERCLIP_IMAGE` and the port from `NIGHTLY_PORT` / `PROD_PORT` | `deploy/compose.yaml` | Change the `env:` blocks in `nightly.yml` and `release.yml` to whatever the compose file actually reads. If the image is hardcoded, add `image: ${PAPERCLIP_IMAGE:-paperclip:latest}` |
| A2 | Secrets for prod live at `/root/.hermes/secrets/t3-prod/{postgres_password,better_auth_secret}` (mirrors the documented nightly path) | `ls /root/.hermes/secrets/` on kmv8 | Fix `SECRETS_DIR` in `release.yml` |
| A3 | Prod stack is compose project `t3-prod`, bound to `100.103.41.112:33100`; health at `/api/health` | `docker compose ls` on kmv8 | Fix `PROD_HEALTH_URL` in `release.yml` |
| A4 | Project is a pnpm/Node monorepo (upstream paperclip is TypeScript) with `pnpm lint`, `pnpm test`, `pnpm build` scripts | `package.json`, `pnpm-workspace.yaml` | Replace the lint/test steps in `ci.yml`. If no test suite exists, keep only the `docker build` job — that is still a meaningful CI gate |
| A5 | `t3-image-retention.sh` and `t3-version-drift.sh` are at `/root/.hermes/scripts/` and safe to run from a non-root user | `ls -l /root/.hermes/scripts/` | Either adjust paths or copy them into `deploy/scripts/` in the repo (preferred — versioned with the code) |
| A6 | `develop` branch does not exist yet | `git branch -r` | If it exists, skip step 2.1 |

---

## 1. Phase 0 — stop the bleeding (do today, independent of everything else)

**1.1** Get the shared checkout clean so tonight's cron does not fail again:
```bash
cd /root/projects/t3-paperclip-Aitodo
git stash push -u -m "pre-migration $(date -u +%F)"
git checkout main && git pull --ff-only
```

**1.2** Patch `/root/.hermes/scripts/t3-nightly-build.sh` so it builds from a fresh clone instead of the shared checkout. Replace the "cd into shared checkout + dirty guard" block with:
```bash
WORK="/root/.hermes/build/t3-nightly-$(date -u +%Y%m%dT%H%M)"
mkdir -p /root/.hermes/build
git clone --quiet https://github.com/tetracilin/test_ai_todo.git "$WORK"
cd "$WORK"
git checkout -b integration/nightly origin/main
trap 'rm -rf "$WORK"' EXIT
```
Remove the dirty-worktree guard entirely; it is now meaningless.

**1.3** Declare `/root/projects/t3-paperclip-Aitodo` agent-only. Any human or second process must use `git worktree add ../t3-<purpose> <branch>` instead of editing in place.

Acceptance: the 22:00 UTC run tonight succeeds (or fails for a reason other than "worktree is dirty").

---

## 2. Phase 1 — repo and branch setup

**2.1** Create `develop` from `main`:
```bash
git checkout main && git pull --ff-only
git checkout -b develop && git push -u origin develop
```

**2.2** Branch protection (Settings → Branches), two rules:

| Branch | Rules |
|---|---|
| `develop` | Require PR; require status check `ci / build-image` (and `ci / lint-test` if A4 holds); no force push |
| `main` | Require PR; require status check `ci / build-image`; require branch up to date; no force push; no direct push |

**2.3** GitHub Environment (Settings → Environments):

| Env | Settings |
|---|---|
| `staging` | No protection rules. Env var `NIGHTLY_PORT=33130` |
| `production` | **Required reviewers: 1** (add both devs). Deployment branches: `main` and tags matching `v*`. Env var `PROD_PORT=33100` |

**2.4** Repository secret: `DISCORD_WEBHOOK_URL` — create an incoming webhook on Discord channel `1534836487772704800` (Channel settings → Integrations → Webhooks) and paste the URL. This replaces the Hermes-side Discord post.

**2.5** Commit the three workflow files from this package to `.github/workflows/` on a branch, open a PR to `develop`, merge it. The `ci.yml` run on that PR is the first end-to-end test.

**2.6** Move the host scripts into the repo (recommended, resolves A5):
```
deploy/scripts/image-retention.sh   # from /root/.hermes/scripts/t3-image-retention.sh
deploy/scripts/version-drift.sh     # from /root/.hermes/scripts/t3-version-drift.sh
deploy/scripts/healthcheck.sh       # new, see section 5
```
Mark them executable (`chmod +x`, commit the mode bit).

---

## 3. Phase 2 — self-hosted runner on kmv8

Run as a dedicated user, not root. The runner needs docker access and read access to the secrets directories.

```bash
# on kmv8, as root
useradd -m -s /bin/bash ghrunner
usermod -aG docker ghrunner

# give runner read access to secrets without making them world-readable
chgrp -R ghrunner /root/.hermes/secrets/t3-nightly /root/.hermes/secrets/t3-prod
chmod 750 /root/.hermes/secrets /root/.hermes/secrets/t3-*
chmod 640 /root/.hermes/secrets/t3-*/*
# NOTE: /root itself is usually 700 — either move secrets to /etc/t3/secrets/ (preferred)
#       and update SECRETS_DIR in both workflows, or add an ACL: setfacl -m u:ghrunner:x /root /root/.hermes

# install runner (get the exact download URL + token from:
# GitHub repo → Settings → Actions → Runners → New self-hosted runner → Linux x64)
su - ghrunner
mkdir actions-runner && cd actions-runner
curl -o actions-runner.tar.gz -L <URL-from-github-ui>
tar xzf actions-runner.tar.gz
./config.sh --url https://github.com/tetracilin/test_ai_todo \
            --token <TOKEN-from-github-ui> \
            --name kmv8 --labels kmv8 --unattended
exit

# as root: install as systemd service
cd /home/ghrunner/actions-runner
./svc.sh install ghrunner
./svc.sh start
./svc.sh status
```

Acceptance: runner shows **Idle** with label `kmv8` under Settings → Actions → Runners.

Security notes for the agent:
- Set Settings → Actions → General → "Fork pull request workflows" to **require approval for all outside collaborators**. A self-hosted runner must never execute untrusted PR code.
- The runner user must not have sudo.
- Do not put `GITHUB_TOKEN` or PATs in any file on kmv8; the runner handles auth itself.

---

## 4. Phase 3 — cut over and retire the cron

**4.1** Trigger `nightly.yml` manually (Actions → Nightly → Run workflow). Confirm:
- image `paperclip:nightly-<sha>` built
- `docker compose -p t3-nightly ps` shows healthy container on `127.0.0.1:33130`
- `curl -s 127.0.0.1:33130/api/health` reports the real commit sha
- Discord message arrived

**4.2** Disable the Hermes cron job `8b51805f9dc5`. Do not delete the script yet — keep it for one week as fallback.

**4.3** First production release:
```bash
git checkout main && git merge --no-ff develop   # via PR, not locally
git tag -a v0.1.0 -m "First release via Actions" && git push origin v0.1.0
```
Approve the `production` environment gate in the Actions UI. Confirm `100.103.41.112:33100/api/health` reports the tagged sha.

**4.4** After one clean week: delete the Hermes cron job and the shared-checkout script. Archive `/root/projects/t3-paperclip-Aitodo` or hand it to the agent team exclusively.

---

## 5. Health check helper (`deploy/scripts/healthcheck.sh`)

Both deploy workflows call this; write it once:
```bash
#!/usr/bin/env bash
# usage: healthcheck.sh <url> <expected-commit-sha> [attempts=30] [sleep=5]
set -euo pipefail
url="$1"; want="$2"; n="${3:-30}"; s="${4:-5}"
for i in $(seq 1 "$n"); do
  if body=$(curl -fsS --max-time 5 "$url" 2>/dev/null); then
    got=$(printf '%s' "$body" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')
    if [[ "$got" == "$want"* ]] || [[ "$want" == "$got"* && -n "$got" ]]; then
      echo "healthy: $url reports commit $got"; exit 0
    fi
    echo "attempt $i/$n: up but commit=$got (want $want)"
  else
    echo "attempt $i/$n: not responding"
  fi
  sleep "$s"
done
echo "FAILED: $url did not become healthy with commit $want" >&2
exit 1
```
Verifying the *commit* rather than just HTTP 200 is deliberate: it catches the case where compose silently kept the old container running.

---

## 6. What changes for developers

| Before | After |
|---|---|
| Push `t3-paperclip-aitodo/<name>`, wait for 22:00 UTC auto-merge | Open PR into `develop`; CI must pass; merge. Nightly deploys `develop` at 22:00 UTC (or on demand via Run workflow) |
| Conflicts silently skipped | Conflicts surface in the PR, before merge |
| "What's in nightly?" = inspect force-pushed `integration/nightly` | "What's in nightly?" = `git log develop` |
| Prod deploy = manual on host | Merge `develop → main` via PR, push tag `v*`, approve in Actions UI |
| Logs on kmv8 only | Logs in Actions run + Discord summary |

Optional later (not in scope now): if the agent team still wants "auto-integrate every agent branch", implement it as a fourth workflow that opens a PR from a merged branch into `develop` rather than deploying directly. That keeps the conflict-surfacing property.

---

## 7. Rollback

Nightly: irrelevant, next run overwrites.

Production: re-run the `release` workflow for the previous tag (Actions → Release → select the older run → Re-run all jobs), approve the gate. The retention script keeps one previous image, so the rebuild is cached and fast. If the DB schema moved forward incompatibly, this is a code-level rollback only — migrations are out of scope for this pipeline and must be handled in the app.

---

## 8. Definition of done

- [ ] Phase 0 applied; tonight's cron succeeded
- [ ] `develop` exists with branch protection; `main` protected
- [ ] Environments `staging` and `production` configured; `production` requires a reviewer
- [ ] `DISCORD_WEBHOOK_URL` secret set
- [ ] Runner `kmv8` idle and healthy as `ghrunner` user, no sudo
- [ ] `ci.yml` green on a test PR
- [ ] `nightly.yml` manual run deployed to `:33130` with correct commit in `/api/health`
- [ ] `release.yml` deployed a `v*` tag to `:33100` after manual approval
- [ ] Hermes cron `8b51805f9dc5` disabled
- [ ] All A1–A6 assumptions confirmed or corrected, with corrections noted in the PR description
