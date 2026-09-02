# T3 Paperclip CI/CD Migration

This directory contains the complete CI/CD migration plan and implementation from Hermes cron to GitHub Actions, enabling robust automated deployments for staging (nightly) and production (release).

## Files in This Directory

- **PLAN.md** — The original migration plan (8 phases, everything you need to know)
- **ASSUMPTIONS-VERIFIED.md** — QA & verification (4 issues identified and fixed, full test checklist)
- **IMPLEMENTATION-SUMMARY.md** — What was done (all changes, files created/modified, next steps)
- **VERIFY-BEFORE-COMMIT.sh** — Automated verification script (run before committing)
- **ci.yml, nightly.yml, release.yml** — Draft workflows (for reference; deployed versions are in .github/workflows/)

## What's Been Done

✅ **Phase 0 Complete**
- Verified 6 assumptions against the codebase
- Identified and fixed 4 critical issues (port env vars, lint script, missing helper scripts)
- Created comprehensive QA documentation

✅ **Workflows & Helper Scripts Ready**
- **3 GitHub Actions workflows** created/fixed in `.github/workflows/`:
  - `ci.yml` — PR testing on GitHub-hosted runners
  - `nightly.yml` — Daily deploy to staging (kmv8)
  - `release.yml` — Manual approval prod deployments (kmv8)
- **3 helper scripts** created in `deploy/scripts/`:
  - `healthcheck.sh` — Verify deployed commit matches expected
  - `image-retention.sh` — Cleanup old Docker images
  - `version-drift.sh` — Report running vs. main commits

## What's Next (Phase 1 — Branch & Environment Setup)

### 1. Create Develop Branch
```bash
git checkout main && git pull --ff-only
git checkout -b develop && git push -u origin develop
```

### 2. GitHub Repository Setup
**Settings → Environments** (create two):
- `staging` — var: `NIGHTLY_PORT=33130`
- `production` — var: `PROD_PORT=33100`, requires 1 reviewer approval

**Settings → Secrets** (create one):
- `DISCORD_WEBHOOK_URL` — Incoming webhook from Discord (channel ID: 1534836487772704800)

**Settings → Branches** (add two protection rules):
- `develop` — requires PR, requires CI check, no force push
- `main` — requires PR, requires CI check, requires up-to-date, no force push/delete

### 3. Commit Workflow Changes
```bash
git checkout -b setup/cicd-migration
# Files already staged locally; run verification first:
bash CICD/VERIFY-BEFORE-COMMIT.sh   # Should show all ✅

git add .github/workflows/ deploy/scripts/ CICD/
git commit -m "setup(cicd): migrate to GitHub Actions workflows for nightly/prod deployments

- ci.yml: TypeScript/test CI for PRs (GitHub-hosted runners)
- nightly.yml: daily deploy develop → t3-nightly (:33130)
- release.yml: approval-gated prod deploy tags → t3-prod (:33100)
- Created deploy/scripts/: healthcheck, image-retention, version-drift

Fixes per ASSUMPTIONS-VERIFIED.md:
- Port env vars: use PAPERCLIP_PORT (not separate NIGHTLY_PORT/PROD_PORT)
- Lint: disabled (no pnpm lint; enable when linting configured)
- Helper scripts: created locally (assume they exist or are copied to kmv8)

See CICD/IMPLEMENTATION-SUMMARY.md for full details."

git push -u origin setup/cicd-migration
# Open PR on GitHub, merge once CI passes
```

### 4. Set Up Self-Hosted Runner on kmv8
Once workflows are merged, follow these steps on kmv8:

```bash
# As root:
useradd -m -s /bin/bash ghrunner
usermod -aG docker ghrunner

# Configure secrets access:
chgrp -R ghrunner /root/.hermes/secrets/t3-nightly /root/.hermes/secrets/t3-prod
chmod 750 /root/.hermes/secrets /root/.hermes/secrets/t3-*
chmod 640 /root/.hermes/secrets/t3-*/*

# As ghrunner:
su - ghrunner
mkdir actions-runner && cd actions-runner
# Get download URL + token from: Settings → Actions → Runners → New self-hosted runner
curl -o actions-runner.tar.gz -L <URL-from-GitHub>
tar xzf actions-runner.tar.gz
./config.sh --url https://github.com/tetracilin/test_ai_todo \
            --token <TOKEN> \
            --name kmv8 --labels kmv8 --unattended
exit

# Back as root:
cd /home/ghrunner/actions-runner
./svc.sh install ghrunner
./svc.sh start
./svc.sh status
```

**Verify:** Settings → Actions → Runners should show `kmv8` **Idle** with label `kmv8`.

## QA Test Sequence

See **ASSUMPTIONS-VERIFIED.md** section 3 for full test checklist. Quick version:

1. **Pre-flight** — Workflow YAML syntax, helper script bash syntax
2. **CI workflow** — Create test PR into `develop`, verify `ci / build-image` passes
3. **Nightly workflow** — Manually trigger, verify deploy to `:33130`, health check succeeds
4. **Release workflow** — Push tag `v0.1.0-test`, approve gate, verify deploy to `:33100`

After all tests pass:
- Disable Hermes cron job `8b51805f9dc5` on kmv8
- Archive or delete shared checkout `/root/projects/t3-paperclip-Aitodo`

## Key Decisions Made

| Issue | Decision | Rationale |
|---|---|---|
| No `pnpm lint` script | Disabled lint step in ci.yml | Linting not configured; add when ESLint/prettier ready |
| Port env var mismatch | Use `PAPERCLIP_PORT` in workflows, not separate `NIGHTLY_PORT`/`PROD_PORT` | compose.yaml only reads `PAPERCLIP_PORT` |
| Missing helper scripts | Created at `deploy/scripts/` instead of kmv8 | Better to version-control in repo; portable across runs |
| Replaced npm release workflow | Overwrote old release.yml (referenced dead `master` branch) | New workflow is for container deployments (tags `v*`); orthogonal to npm publishing |

## Important Links

- **Repo:** https://github.com/tetracilin/test_ai_todo
- **Discord channel (reports):** https://discord.com/channels/[guild]/1534836487772704800
- **Nightly stack:** `t3-nightly`, `127.0.0.1:33130` (host-local only)
- **Prod stack:** `t3-prod`, `100.103.41.112:33100` (tailnet-public)
- **Health endpoint:** `/api/health` (both stacks)

## Assumptions & Caveats

See **ASSUMPTIONS-VERIFIED.md** section 2 for full table.

**Unverified on kmv8:**
- A2: Secrets paths `/root/.hermes/secrets/t3-{nightly,prod}/` assumed correct
- A5: Scripts assumed to exist on kmv8 or that locally-created versions work

**Known limitations:**
- Linting disabled (no `pnpm lint` script)
- npm package releases require new `npm-release.yml` (old one deleted)
- Hermes cron job still enabled (disable after Phase 3 success)

## Definition of Done

All checked before moving to Phase 2 (runner setup):

- [ ] Verification script passes (`bash CICD/VERIFY-BEFORE-COMMIT.sh`)
- [ ] All workflows committed to `.github/workflows/`
- [ ] All helper scripts committed to `deploy/scripts/`
- [ ] `develop` branch created and protected
- [ ] GitHub Environments + Secrets created
- [ ] PR merged to `develop` (first CI test)
- [ ] All 4 identified issues documented and resolved

## Support

- See **PLAN.md** for detailed phases and context
- See **ASSUMPTIONS-VERIFIED.md** for QA checklist and test suite
- See **IMPLEMENTATION-SUMMARY.md** for what was changed and how
- Run `bash CICD/VERIFY-BEFORE-COMMIT.sh` to check readiness before committing

---

**Last updated:** 2026-09-02  
**Status:** Ready for Phase 1 (Branch Setup)  
**Author notes:** All critical issues identified and fixed; workflows tested for syntax validity.
