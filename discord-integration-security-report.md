---
title: Discord Integration — Security Review
created: 2026-08-31T12:05:00Z
updated: 2026-08-31T12:05:00Z
author: t3-security
status: final
tags: [security, discord, paperclip, review]
---

# Discord Integration — Security Review

Task: `t_e044c3b2` (parents `t_238b08ca`, `t_a78d4cce`; root feature `t_0afe583e`)
Baseline reviewed: `main @ 8fea5a31d` (Discord core = `b934e802a` + `8bdd55e21`), worktree branch `wt/t_e044c3b2`.
Scope: secret handling, input validation & rate limiting, authorization (linked-user gating), log leakage, dependency vulnerabilities.

## Verdict

CONDITIONAL PASS with fixes required. The integration's core design is sound —
least-privilege gateway intents, strict Zod validation, hashed single-use link
codes, constant-time bridge auth, durable idempotent outbox, mentions disabled,
no secrets in git. Two findings should block release (**S1 rate limiting**,
**S2 cross-tenant unlink**), and two more (**S3 link-code log leak**, **S4
bridge-credential privilege scope**) should be fixed or explicitly accepted by
the project lead before go-live.

Evidence run this review: 26/26 bridge vitest pass; `npm audit --omit=dev` =
0 vulnerabilities (bridge); source trace of server routes, actor middleware,
activity-log fanout, and log redaction.

---

## What is verified secure

- **Least-privilege Discord app.** Gateway client requests only
  `GatewayIntentBits.Guilds`; no message-content or privileged member intents
  (`discord-bridge/src/index.ts:14`, comment lines 12-13). Bot ignores other
  bots and non-chat-input interactions (`index.ts:22`).
- **Bot token / API key never logged, never in git.** `config.ts` reads all
  secrets from env; `.env` is gitignored (`discord-bridge/.gitignore`); the
  command error path logs only `interactionId` + `commandName`, never option
  values, bodies, or credentials (`commands/router.ts:14-19`). Prior audit
  `t_bf2dc2f2` confirmed 0 Discord secrets across 9150 commits.
- **Strict input validation.** Every server route parses with `.strict()` Zod
  schemas and bounded lengths (`routes/discord-integrations.ts:35-67`); unknown
  keys are rejected, so caller-controlled identity fields (companyId spoofing,
  arbitrary Paperclip userId) cannot be injected via the bridge.
- **Bridge cannot pick project or Paperclip user.** The server resolves the
  linked actor and channel→project mapping from durable state; the bridge only
  forwards immutable Discord IDs (`README.md:13`, route lines 233-250).
- **Link codes.** 24 random bytes (192-bit) base64url, SHA-256 hashed at rest,
  single-use (transactional `consumedAt` guard), 10-minute TTL
  (`routes/...:131-134`, `191-209`). Not brute-forceable.
- **Constant-time bridge auth.** `bridgeAuthorized` uses `timingSafeEqual` with
  a length pre-check and fails closed when the token env is unset
  (`routes/...:72-83`).
- **Notification recipients are gated to linked, opted-in users.** The
  activity-log fanout inner-joins `discordUserLinks` on `active = true` and
  filters `discordNotificationPreferences.enabled = true`
  (`services/activity-log.ts:116-123`); DMs route only to the linked
  `discordUserId`, channel deliveries only to mapped enabled channels.
- **Idempotency + echo suppression.** Interaction-id uniqueness, outbox/delivery
  unique idempotency keys with `onConflictDoNothing`, and source-channel
  create-echo suppression (`notifier.ts:90-98`).
- **Mentions disabled on every outbound message** (`notifier.ts:9,101`), so
  notification content cannot `@here`/`@everyone` or ping-bomb.
- **Delivery failures are isolated** from source issue writes; the outbox
  enqueue is wrapped and only logs safe correlation fields on error
  (`activity-log.ts:299-305`). Retry cap backs off and terminalizes 4xx≠429
  (`notifier.ts:77-88`, route ack `272-286`).
- **Dependencies (production).** Bridge prod deps (`discord.js`, `dotenv`) —
  `npm audit --omit=dev` = 0 vulnerabilities.

---

## Findings

### S1 — No rate limiting on any integration endpoint (HIGH, release-blocking)

The repo has no rate-limit middleware anywhere (no `express-rate-limit` /
`slow-down` dependency; grep across `server/` returns none), and the Discord
routes add none. Concretely unthrottled:

- `POST /integrations/discord/link-codes` — an authenticated board user can mint
  unbounded link codes (row-flooding / DB pressure).
- `POST /integrations/discord/commands/task-create` — the bridge credential can
  create issues with no server-side ceiling; a compromised or buggy bridge
  becomes an issue-spam / DB-exhaustion vector.
- `POST /integrations/discord/link-codes/consume` and the delivery ack endpoints
  — no throttle.

Acceptance criterion "input validation **and rate limiting** on
commands/webhooks" is only half met (validation is strong; rate limiting is
absent).

Fix: add per-actor rate limiting to the Discord router — e.g. cap link-code
minting per user per window and cap bridge task-create per guild/interaction
window. If Discord's own per-app interaction limits are treated as the ceiling,
that must be an explicit, documented lead decision, not a silent gap.

### S2 — `unlink` is cross-tenant and can nuke a user's links in every company (HIGH, release-blocking)

`POST /integrations/discord/unlink` matches on `discordUserId` alone with no
`companyId` scope:

```
.where(and(eq(discordUserLinks.discordUserId, input.discordUserId),
           eq(discordUserLinks.active, true)))   // routes/...:219
```

It deactivates **all** active links for that Discord user across every tenant,
then disables notification preferences for only the first matched company
(`linked[0].companyId`, line 220). A user (or bridge action) unlinking in one
company silently severs their linkage in unrelated companies — a cross-tenant
integrity / denial-of-service defect. (Also filed as QA F4 in `t_35c8a882`.)

Fix: scope the unlink to a single `companyId` (bridge must pass it, or resolve
it), update only that tenant's link + preferences, and iterate all affected
companies consistently.

### S3 — Failed link-code consume logs the plaintext link code (MEDIUM)

On any 4xx from `consumeLinkCode` (e.g. `expired_link_code`, `link_code_used`,
`invalid_link_code` → 400), the HTTP logger's `customProps` copies `req.body`
into the warn line via `redactSensitive` (`middleware/logger.ts:53-63`). The
request body is `{ code, discordUserId, guildId }`, and `code` is **not** in the
`SENSITIVE_KEYS` set (`middleware/redact-sensitive.ts:14-52`). The plaintext
link code (a short-lived bearer credential) therefore lands on disk for the most
common failure paths.

Impact is bounded (codes are single-use and expire in 10 min, and a failure
usually means the code is already spent/expired), but a live code can be logged
if consume fails for another reason (e.g. `discord_account_already_linked` is
409 → still logged). Credentials should never reach logs.

Fix: add `"code"` (and `"codehash"`) to `SENSITIVE_KEYS`, or omit the body for
the Discord consume route. One-line change in `redact-sensitive.ts`.

### S4 — Bridge credential is not path-scoped to `/api/integrations/discord/*` (MEDIUM — verify or accept)

The bridge's setup doc and `.env.example` state `PAPERCLIP_API_KEY` "must be
authorized only for `/api/integrations/discord/*`" (`README.md:40`,
`.env.example`). But there is **no mechanism in the codebase that enforces a
path scope on an agent API key**: `agentApiKeyScopeSchema` supports only
`standard | task_bridge | skill_test` (`packages/shared/src/validators/agent.ts:174-178`),
none of which restricts a key to Discord routes. The route's `assertBridge`
checks the header against a separate `PAPERCLIP_DISCORD_BRIDGE_TOKEN` env, while
`actorMiddleware` authenticates the same bearer as a full agent/board actor
*before* the route runs.

Consequences to confirm with the implementer of parent `t_238b08ca` (whose
handoff claims "valid bridge credentials now reach only bridge-scoped
integration endpoints" — I could not find code enforcing that on
`main`/`wt/t_238b08ca`; the branch shows no diff vs `main`):

1. If `PAPERCLIP_DISCORD_BRIDGE_TOKEN` is set to a **standard agent API key** so
   it passes `actorMiddleware`, that key is over-privileged: it can call any
   agent-accessible API (create/modify issues directly, etc.), not just Discord
   paths. The "least-privilege bridge" property then depends on operator
   discipline, not enforcement.
2. If the bridge token is a value that is **not** a registered agent/board key,
   `actorMiddleware` rejects it with 401 before the route (`middleware/auth.ts:312-317`),
   so bridge routes would be unreachable — meaning the working deployment must
   be using case (1).

Fix / action: either (a) introduce a real `discord_bridge` key scope that the
authorization service restricts to the Discord integration routes, or (b) route
bridge auth exclusively through `assertBridge` and have `actorMiddleware` skip
auth for `/api/integrations/discord/*` bridge paths (so the env token is the
sole credential and carries no ambient agent authority). Absent either,
explicitly document and have the lead accept that the bridge key is a full
company-scoped agent credential.

### S5 — Dev-only dependency advisories in the bridge (LOW / informational)

`npm audit` (incl. dev) reports 5 advisories (esbuild/vite/vitest chain), all
**devDependencies only** — not shipped in the running bridge (`npm audit
--omit=dev` = 0). Track and bump vitest when convenient; not release-blocking.

---

## Recommendations (priority order)

1. **S1** Add rate limiting to the Discord router (link-code mint, bridge
   task-create). Release-blocking.
2. **S2** Scope `unlink` to a single tenant. Release-blocking.
3. **S3** Add `code`/`codeHash` to log redaction. One-line, do now.
4. **S4** Confirm/enforce bridge-credential scoping with the `t_238b08ca`
   implementer and the project lead; either enforce a path scope or accept the
   full-agent-key risk explicitly.
5. **S5** Bump bridge dev deps opportunistically.

## Notes for the lead

Acceptance requires "critical issues fixed or explicitly accepted by project
lead." S1 and S2 are the two I recommend treating as must-fix. S3 is trivial. S4
is a design clarification that materially affects the least-privilege claim and
should get an explicit accept/fix decision. This report is the deliverable; the
fixes themselves belong to the backend implementer (a follow-up task is filed).
