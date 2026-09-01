# Discord Secrets Audit — Repository & Git History

- Date (UTC): 2026-08-31T11:35:26Z
- Auditor: t3-security
- Task: t_bf2dc2f2 (parent t_fd05eb24 — Discord staging deploy pipeline)
- Scope commit (worktree HEAD): `8fea5a31dc48d555b2bb653a7cc96674ec290d89`
- Verdict: **PASS — zero Discord secrets found in the working tree or in committed history. Externalization confirmed.**

## Objective

Confirm that no Discord bot token, client ID, client secret, or webhook
secret has been committed to the repository or its git history, and that
all Discord credentials are externalized (env vars / Docker secrets),
following the deployment changes introduced for the Discord bridge and the
`discord-staging` GitHub Actions pipeline.

## Method

Three independent layers were used:

1. **`gitleaks` v8.18.4** — installed for this audit (not previously present).
   - Full history: `gitleaks detect --source .` → 9150 commits scanned.
   - Working tree: `gitleaks detect --source . --no-git`.
2. **Targeted `git grep` / `git log -G` pickaxe** across the working tree and
   all refs for Discord-specific credential shapes:
   - Bot-token shape `^[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}`.
   - Webhook URL `discord(app)?\.com/api/webhooks/<id>/<token>`.
   - `DISCORD_*` keys assigned a non-empty, non-placeholder literal.
   - Docker secret references `discord_bot_token`, `discord_client_id`,
     `discord_webhook_secret`, `paperclip_discord_bridge_token`.
3. **Externalization review** of every Discord-referencing file
   (`discord-bridge/`, `deploy-staging/`, `.github/workflows/`).

`pnpm-lock.yaml` and `*-lock.json` were excluded from literal scans (hash
noise, no secrets).

## Findings

### Discord secrets: NONE

- Bot-token shape: 0 matches (working tree and full history).
- Webhook URLs: 0 matches (working tree and full history).
- `DISCORD_*` literals with real values: 0. Every reference is either an
  empty key in an `.env.example`, a `process.env` read, a `${{ secrets.* }}`
  GitHub Actions reference, or a `/run/secrets/*` Docker mount.
- gitleaks Discord-tagged findings: 0 in the working tree and 0 across all
  9150 commits.

### Externalization confirmed

- `discord-bridge/src/config.ts` reads all credentials from `process.env`
  via a `required()` guard — no hardcoded fallbacks.
- `discord-bridge/.env.example` ships empty keys (`DISCORD_BOT_TOKEN=`,
  `DISCORD_CLIENT_ID=`, `DISCORD_DEV_GUILD_ID=`, `PAPERCLIP_API_KEY=`).
- `discord-bridge/.gitignore` ignores `.env`; `git check-ignore` confirms
  `discord-bridge/.env`, `deploy-staging/.env`, `deploy/.env`, and
  `deploy-staging/secrets/*` are all ignored.
- The `discord-staging` workflow sources credentials only from the GitHub
  Environment (`${{ secrets.* }}`, masked) and streams them to the host over
  SSH stdin into `/run/secrets/*` files — never argv, logs, or the repo.
- No real `.env` file and no `secrets/<credential>` value file has ever been
  committed on any ref (`--diff-filter=A` history check returned empty).

### Non-Discord gitleaks noise (out of scope, not introduced here)

gitleaks reported 222 findings across full history and 28 in the working
tree. **None are Discord**, and none are in the Discord/bridge/deploy-staging
integration surface. They are pre-existing upstream-fork artifacts:
test fixtures (`server/src/__tests__/*.test.ts` redaction/heartbeat suites),
doc logs, and example/sample keys (`generic-api-key`, `private-key`, `jwt`,
`github-pat`, `aws-access-token`, `gcp-api-key`). These are synthetic
values used by redaction/security unit tests, not live credentials, and are
unrelated to this task's Discord scope. No rotation action is required for
the Discord integration.

## Coordination with t3-infra

Not required: no Discord secret was found, so there is nothing to rotate or
remove. If a real Discord credential is ever committed, rotate it in the
Discord Developer Portal and purge it from history before it lands on a
shared branch.

## Acceptance

- [x] Scan reports zero Discord secrets in the repo and history.
- [x] Externalization confirmed (env vars + Docker secrets + GitHub Environment).
- [x] Findings documented (this report + task comment).
