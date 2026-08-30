# Discord Integration — Architecture & API Contracts

Status: authoritative design reference for backend, frontend, and infra.
Scope: connect PaperclipAI with Discord for (1) creating tasks/issues from Discord,
(2) task/issue lifecycle notifications into Discord channels, and (3) personal DM
notifications. This document is grounded in the as-built implementation that landed
on `main` (`b934e802a` — bridge authority + APIs + schema/migration `0231`;
`8bdd55e21` — lifecycle-event fanout into the durable Discord outbox). It is the
contract the three implementation tracks build and verify against.

Relevant source of truth in this repo:

- `server/src/routes/discord-integrations.ts` — all HTTP endpoints.
- `server/src/services/activity-log.ts` — lifecycle → outbox/delivery fanout.
- `packages/db/src/schema/discord_integrations.ts` — durable schema.
- `packages/db/src/migrations/0231_discord_integration_authority.sql` — migration.
- `discord-bridge/` — the standalone Discord transport process (bot + delivery worker).

---

## 1. Architectural principle: authority split

There are exactly two runtime components, with a hard authority boundary between them.

- **Paperclip server (authority).** Owns everything that is a decision or durable
  state: account link state, channel→project mappings, authorization, idempotency,
  issue creation, the event outbox, delivery scheduling, retry/backoff, and delivery
  acknowledgement state. The server never talks to Discord's API.

- **Discord bridge (transport).** A separate Node process (`discord-bridge/`) that owns
  the Discord gateway/HTTP transport only. It receives slash-command interactions,
  forwards immutable Discord IDs to the server, and runs a delivery worker that polls
  the server for pending deliveries and sends them to Discord. The bridge makes **no
  authorization or routing decisions** and holds **no durable state**.

Rationale: a compromised or buggy bridge cannot become a generic Paperclip writer,
cannot pick which Paperclip user/project an action maps to, and cannot forge identity.
The bridge credential is scoped to `/api/integrations/discord/*` only.

```
Discord  ──interaction──►  Bridge  ──POST task-create──►  Server ──► DB (issues, outbox)
                                                              │
Discord  ◄──send message──  Bridge  ◄──GET pending deliveries─┘  (delivery worker poll)
                              Bridge  ──POST ack outcome──────►  Server ──► DB (delivery state)
```

There is **no inbound Discord Interactions webhook to the server**. Discord interactions
terminate at the bridge (gateway connection). The bridge translates them into
authenticated server API calls. "Webhook endpoints for Discord events" in this system
means the bridge's gateway subscription plus the server's bridge-scoped ingest endpoints
described in §6 — not a public HTTP callback URL that Discord posts to.

---

## 2. Discord application, bot token, and required permissions

Create one Discord application in the Discord Developer Portal. It provides:

- `DISCORD_BOT_TOKEN` — the bot token used by the bridge gateway connection.
- `DISCORD_CLIENT_ID` — the application (client) id, used for slash-command registration.
- `DISCORD_DEV_GUILD_ID` — optional; restricts command registration to one guild for
  instant propagation during development. Omit for a global deploy (~1h propagation).

**Least-privilege gateway intents.** The bridge requests only the `Guilds` intent. It
does **not** request `MessageContent` or any privileged intent, and does not read
channel message history. All command input arrives as typed slash-command options, not
free-text message scraping.

**Bot permissions (OAuth2 scopes `bot` + `applications.commands`).** Grant the minimum
needed to register commands and post notifications:

- `Send Messages` — post channel notifications.
- `Use Slash Commands` (implied by `applications.commands`).
- `View Channel` — for the specific channels mapped to projects.

DMs require no guild permission (the bot DMs a user only if that user shares a guild
with the bot and has DMs open; a failed DM is handled as a terminal delivery — see §7).

Do **not** grant: `Administrator`, `Manage Server`, `Manage Channels`, `Read Message
History`, `Mention Everyone`, or any moderation permission. Notifications always send
with mentions disabled (`allowedMentions: { parse: [] }`), so no `Mention` permission is
needed or wanted.

**Token handling.** `DISCORD_BOT_TOKEN` lives only in the bridge process's secret store
(env in dev, secret manager in prod). It never touches the Paperclip server, the
database, the frontend, logs, or git. See §8.

---

## 3. Slash commands

Commands are registered by the bridge via `discord-bridge/src/registerCommands.ts`
(`npm run register-commands`). The command tree (`src/commands/definitions.ts`):

```
/paperclip task create
    title:       string  (required, 1..200 chars)
    description: string  (optional, up to 8000 chars)
    priority:    choice  (optional: low | medium | high | urgent)
```

Behavior:

- All replies are **ephemeral** (visible only to the invoking user).
- The bridge captures immutable Discord IDs from the interaction (interaction id, user
  id, guild id, channel id, and parent channel id for threads) and the typed options,
  then calls the server. The bridge never selects a Paperclip project or user id.
- The server resolves the acting Paperclip user (from the account link) and the target
  project (from the channel→project mapping), authorizes, and creates the issue.
- Success reply: the issue identifier, title, and a deep link to the issue.
- Re-delivery of the same interaction id returns the already-created issue with
  `duplicate: true` (idempotent; see §6.3).

**Issue vs. task naming.** In PaperclipAI the durable entity is the *issue*
(`issues` table). "Create a task from Discord" maps to issue creation with
`originKind: "discord"`. A distinct `/issue report` command is **not** implemented in
the current release; if product wants a separate issue-report flow it is an additive
subcommand (`/paperclip issue report`) reusing the same task-create endpoint with a
different default project/label policy — call it out as future scope, not a v1 contract.

**Priority mapping.** The endpoint accepts `low|medium|high|urgent`; the server maps
`urgent → high` because the `issues` priority domain currently tops out at `high`. Keep
`urgent` in the Discord UX for user intent, but expect it stored as `high`.

---

## 4. Data model

All tables live in migration `0231_discord_integration_authority.sql`
(schema `packages/db/src/schema/discord_integrations.ts`). All are company-scoped
(multi-tenant) and cascade on company delete.

### 4.1 `discord_guild_integrations`
One row per (company, guild). Marks a Discord server as connected to a company.
- unique `(company_id, guild_id)`; `enabled` flag; `created_by_user_id`.

### 4.2 `discord_project_channel_mappings`
Binds a Discord channel to a Paperclip project and sets its policy.
- `(company_id, guild_id, channel_id, project_id)`.
- `enabled` — mapping active.
- `allow_task_create` — whether `/paperclip task create` is permitted in this channel
  (default **false**; opt-in per channel).
- `notification_events jsonb string[]` — which lifecycle events fan out to this channel.
- unique `(guild_id, channel_id)`; index `(company_id, project_id)`.

### 4.3 `discord_user_links`
Links a Discord user to a Paperclip user within a company.
- `(company_id, user_id, discord_user_id)`, `is_primary`, `active`, `linked_at`,
  `unlinked_at`.
- unique `(company_id, discord_user_id)` — one Discord account maps to at most one
  active Paperclip user per company; index `(company_id, user_id)`.

### 4.4 `discord_link_codes`
One-time codes for account linking.
- `(company_id, user_id, code_hash, expires_at, consumed_at)`.
- Server stores only the **SHA-256 hash** of the code, never the plaintext.
- Codes are single-use and expire after **10 minutes**. unique on `code_hash`.

### 4.5 `discord_notification_preferences`
Per-user, per-event personal notification settings.
- `(company_id, user_id, event_type, enabled, delivery_mode, channel_id)`.
- `delivery_mode`: `dm` or `channel`. `enabled` defaults **false** (opt-in).
- unique `(company_id, user_id, event_type)`.

### 4.6 `discord_inbound_requests`
Idempotency + audit ledger for inbound task-create interactions.
- unique `discord_interaction_id`; `status` (`processing|succeeded|failed`),
  `issue_id`, `error_code`.

### 4.7 `integration_event_outbox`
Durable, transactional record of a lifecycle event that should notify Discord.
- `idempotency_key` (unique), `company_id`, `project_id`, `issue_id`, `event_type`,
  `origin` (`paperclip|discord|dashboard|api|automation`), `origin_discord_channel_id`,
  `payload jsonb`, `occurred_at`.
- Written **in the same transaction** as the issue mutation so notifications can never
  be lost or double-produced.

### 4.8 `discord_delivery_attempts`
One row per (event, recipient) — the unit the bridge delivers and acknowledges.
- `event_id`, `recipient_type` (`channel|dm`), `recipient_id`, `idempotency_key`,
  `status` (`pending|delivered|suppressed|retryable_failure→pending|terminal_failure`),
  `attempts`, `next_attempt_at`, `discord_message_id`, `error_code`.
- unique `(event_id, recipient_type, recipient_id)`; index `(status, next_attempt_at)`
  for the delivery worker's lease query.

**Identity resolution never trusts the bridge.** The Discord user id and channel id are
the only inputs; the server joins `discord_user_links` (who) and
`discord_project_channel_mappings` (where) to derive the Paperclip actor and project,
then verifies `company_memberships` (active membership) before acting.

---

## 5. Notification routing

Supported event types (`DISCORD_NOTIFICATION_EVENTS`):

```
issue.created           issue.status_changed    issue.assignee_changed
issue.priority_changed  issue.comment_created   issue.blocked
issue.unblocked         issue.completed
```

Flow (`server/src/services/activity-log.ts`):

1. An issue mutation writes an activity-log entry. `discordEventTypesForActivity`
   translates the activity action into zero or more Discord event types.
2. For each event type, the server inserts an `integration_event_outbox` row
   (idempotency key `discord:activity:{activityId}:{eventType}`, `onConflictDoNothing`).
3. Recipients are resolved into a deduped set:
   - **Channel recipients** — every enabled `discord_project_channel_mappings` for the
     issue's project whose `notification_events` includes the event type.
   - **Personal recipients** — every active-linked user with an enabled
     `discord_notification_preferences` row for that event type; delivered to their DM
     (`delivery_mode=dm` → `discord_user_id`) or to a mapped channel
     (`delivery_mode=channel` → `channel_id`).
4. One `discord_delivery_attempts` row is inserted per recipient
   (`onConflictDoNothing` on the unique key), all in the issue's transaction.

**Echo suppression.** When an issue is created *from* Discord, the originating channel
must not be notified about its own create. The bridge's delivery worker suppresses a
delivery when `eventType=issue.created`, `origin=discord`, `recipient.type=channel`, and
`recipient.id === originDiscordChannelId`, acknowledging it as `suppressed` (see §7).

**Content policy.** Only allowlisted fields reach Discord: issue identifier, title, a
short changed-field summary, actor display, timestamp, and the issue URL. Raw event
bodies, credentials, and HTTP response bodies never leave the server. All messages send
with mentions disabled.

---

## 6. API contracts

Base path: `/api/integrations/discord`. Two authorization classes.

**Browser/user-scoped** (authenticated Paperclip board session, `req.actor.type ===
"board"`; every call requires `companyId` and passes `assertCompanyAccess`):

| Method | Path | Purpose |
|---|---|---|
| GET  | `/settings?companyId=` | Current user's link status + per-event preferences |
| POST | `/link-codes` | Issue a one-time 10-min link code (returns `{code, expiresAt}`) |
| PATCH| `/preferences` | Upsert this user's notification preferences |
| PUT  | `/notification-preferences` | Legacy alias of PATCH `/preferences` |
| PUT  | `/settings/channel-mappings` | Admin: upsert channel→project mapping |
| PUT  | `/channel-mappings` | Alias of the above |

**Bridge-scoped** (bearer token `PAPERCLIP_DISCORD_BRIDGE_TOKEN`, constant-time compared;
`assertBridge`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/link-codes/consume` (alias `/link`) | Consume a link code for a Discord user |
| POST | `/unlink` | Deactivate a Discord user's link |
| POST | `/commands/task-create` | Create an issue from a slash command |
| GET  | `/deliveries/pending` | Lease up to 100 due deliveries |
| POST | `/events/:eventId/deliveries/:deliveryId` | Acknowledge a delivery outcome |

### 6.1 GET `/settings`
Returns:
```json
{
  "link": { "status": "linked|unlinked", "discordUserId": "..." | null },
  "preferences": [
    { "eventType": "issue.created", "enabled": false,
      "deliveryMode": "dm", "channelId": null }
    // one entry per supported event type, defaults synthesized when absent
  ]
}
```

### 6.2 Account linking
1. Frontend calls POST `/link-codes` → `{ code, expiresAt }` (code shown once to user).
2. User runs a link action in Discord; the bridge calls POST `/link-codes/consume`
   with `{ code, discordUserId, guildId? }`.
3. Server validates: code exists, unconsumed, unexpired; the Discord account is not
   already actively linked to a *different* Paperclip user (else `409
   discord_account_already_linked`). It consumes the code (single-use, transactional)
   and upserts an active `discord_user_links` row. Returns `{ status: "linked" }`.
4. POST `/unlink` `{ discordUserId }` deactivates the link and disables that user's
   notification preferences.

Error codes: `invalid_link_code`, `link_code_used`, `expired_link_code` (400),
`discord_account_already_linked` (409).

### 6.3 POST `/commands/task-create`
Request (strict schema, unknown fields rejected):
```json
{
  "discordInteractionId": "…",
  "discordUserId": "…",
  "guildId": "…" | null,
  "channelId": "…",
  "parentChannelId": "…" | null,   // thread's parent, optional
  "commandName": "paperclip task create",
  "title": "…",                    // 1..200
  "description": "…",              // optional, ≤8000
  "priority": "low|medium|high|urgent"   // optional
}
```
Server logic:
1. **Idempotency.** If `discordInteractionId` already produced an issue → return
   `{ duplicate: true, issue }`. If it exists but has no issue → `409
   interaction_conflict`.
2. **Channel authorization.** Resolve an enabled mapping matching `guildId` and
   (`channelId` or `parentChannelId`) with an enabled guild integration; else `403
   channel_not_mapped`. If `allow_task_create` is false → `403 task_creation_disabled`.
3. **User authorization.** Resolve active `discord_user_links` for that company +
   Discord user; else `403 not_linked`. Verify active `company_memberships`; else
   `403 project_access_denied`.
4. **Create.** Insert `discord_inbound_requests` (status `processing`), create the issue
   via `issueService` with `idempotencyKey: discord:{interactionId}`,
   `originKind:"discord"`, project + actor from resolution, mapping `urgent→high`.
5. **Fan out.** Insert an `integration_event_outbox` `issue.created` row and delivery
   attempts for other project channels subscribed to `issue.created` (the source channel
   is excluded here and echo-suppressed at delivery). Mark inbound request `succeeded`.
6. Response `201`: `{ duplicate: false, issue: { id, identifier, title, url } }`.
   On failure mark inbound `failed` with `error_code` and surface the error.

### 6.4 GET `/deliveries/pending`
Returns up to 100 `pending` deliveries whose `next_attempt_at <= now`, each flattened as:
```json
{
  "id": "<deliveryId>",
  "recipient": { "type": "channel|dm", "id": "…" },
  "event": {
    "id": "<eventId>", "idempotencyKey": "…", "occurredAt": "ISO",
    "eventType": "issue.status_changed", "origin": "paperclip|discord",
    "originDiscordChannelId": "…" | null,
    "issueIdentifier": "…", "title": "…", "issueUrl": "…",
    "actor": "…", "before": {…}|null, "after": {…}|null
  }
}
```

### 6.5 POST `/events/:eventId/deliveries/:deliveryId`
Bridge acknowledges the outcome:
```json
{
  "outcome": "delivered|suppressed|retryable_failure|terminal_failure",
  "discordMessageId": "…",        // optional
  "errorCode": "…",               // optional
  "retryAfterSeconds": 0          // optional, 0..86400
}
```
- Terminal states (`delivered|suppressed|terminal_failure`) are idempotent no-ops if
  already set.
- `retryable_failure` re-queues to `pending` and schedules `next_attempt_at` using
  `retryAfterSeconds` when provided, else exponential backoff
  `min(3600, 2^min(attempts+1, 10))` seconds. `attempts` is incremented.

### 6.6 PATCH `/preferences`
Body `{ companyId, preferences: [{ eventType, enabled, deliveryMode, channelId }] }`.
If any enabled `deliveryMode=channel` preference names a channel that is not an enabled
mapped channel for the company → `403 notification_channel_not_mapped`. Otherwise upserts
each preference and returns the refreshed `/settings` payload.

### 6.7 PUT `/settings/channel-mappings` (admin)
Body `{ companyId, guildId, channelId, projectId, enabled?, allowTaskCreate?,
notificationEvents? }`. Requires `assertInstanceAdmin`. Verifies the project belongs to
the company (`403 project_access_denied`), upserts the mapping, and ensures an enabled
`discord_guild_integrations` row. Returns `201 { ok: true }`.

### 6.8 Frontend responsibilities
The dashboard implements two surfaces against the above:
- **Account Settings → Discord**: shows link status via GET `/settings`, issues a link
  code via POST `/link-codes` (display once, show the 10-min expiry), and edits per-event
  personal notification preferences via PATCH `/preferences`. Every event defaults
  disabled; surface a warning when a chosen channel isn't mapped
  (`notification_channel_not_mapped`).
- **Admin → Integrations → Discord (instance admin)**: manage channel→project mappings
  and per-channel `allowTaskCreate` / `notificationEvents` via PUT
  `/settings/channel-mappings`.
All calls send `companyId`; handle the documented 4xx `code` values for inline errors.

---

## 7. Bridge runtime (transport)

`discord-bridge/` is a standalone Node service.

- **Config** (`src/config.ts`, `.env.example`): `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`,
  optional `DISCORD_DEV_GUILD_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`
  (bridge-scoped, authorized only for `/api/integrations/discord/*`),
  `POLL_INTERVAL_SECONDS` (default 30).
- **Command handling** (`src/commands/router.ts`): parses the slash interaction, replies
  ephemerally, and calls `DiscordIntegrationClient.createTask`. The client exposes only
  integration endpoints — it cannot become a generic issue writer.
- **Delivery worker** (`src/lib/notifier.ts`, `startDeliveryWorker`): every
  `POLL_INTERVAL_SECONDS`, non-overlapping, it calls GET `/deliveries/pending`, and for
  each delivery: suppresses source-channel echoes → `suppressed`; otherwise sends the
  formatted message (mentions disabled) to the DM or channel and acknowledges
  `delivered` with the Discord message id. On Discord error it maps status to an
  outcome: 4xx (except 429) → `terminal_failure`; 429/5xx/network → `retryable_failure`
  with `retryAfterSeconds` from the rate-limit header. Acknowledgement failures are
  logged and never thrown back into issue actions.
- **Formatting** (`formatDiscordNotification`): emits only allowlisted fields; truncates;
  never includes credentials or raw bodies.

The server never calls Discord; the bridge never decides authorization or routing.

---

## 8. Security constraints

- **Secret handling.** `DISCORD_BOT_TOKEN` and `PAPERCLIP_DISCORD_BRIDGE_TOKEN` /
  `PAPERCLIP_API_KEY` live only in their process secret stores. None are stored in the
  DB, returned by any API, sent to the frontend, or committed. Link codes are stored only
  as SHA-256 hashes; the plaintext is returned exactly once at issuance.
- **Bridge authentication.** Bridge endpoints require a bearer token compared in
  constant time (`timingSafeEqual`, length-checked). If `PAPERCLIP_DISCORD_BRIDGE_TOKEN`
  is unset the bridge surface is disabled (`401 Discord bridge is not configured`). The
  bridge credential is authorized only for `/api/integrations/discord/*`.
- **Least privilege at Discord.** `Guilds` intent only; no message-content/privileged
  intents; minimal bot permissions (§2); mentions always disabled.
- **Input validation.** Every endpoint validates with strict Zod schemas (unknown keys
  rejected, length/enum bounds enforced). Command name is a literal; priority, event
  type, delivery mode, and outcome are enums; ids are bounded strings/uuids.
- **Authorization defense in depth.** Identity and target are derived server-side from
  link + mapping + active membership; the bridge's supplied `discordUserId`/`channelId`
  are inputs, never trusted assertions of a Paperclip identity. `allow_task_create` and
  per-channel `notification_events` gate what a mapped channel may do. Admin-only
  mapping changes require `assertInstanceAdmin`.
- **Idempotency & durability.** Inbound interactions are deduped by
  `discord_interaction_id`; outbox rows and delivery attempts have unique idempotency
  keys and are written in the issue transaction, so notifications are neither lost nor
  duplicated. Delivery acknowledgement is idempotent on terminal states.
- **Rate limiting / backoff.** The delivery worker honors Discord 429 `retry_after`;
  retryable failures use capped exponential backoff (`min(3600, 2^min(attempts+1,10))`
  s). Link codes expire in 10 minutes and are single-use. Poll leasing caps at 100
  deliveries per tick with non-overlapping ticks.
- **PII / logging.** Logs exclude command bodies, credentials, link codes, and HTTP
  response bodies. Only allowlisted fields are formatted into Discord messages.

---

## 9. Implementation tracks (independent build)

- **Backend (`t3-backend`)** — server endpoints (§6), schema/migration `0231` (§4),
  lifecycle→outbox fanout (§5), and unit tests for command handling, notification
  routing, and identity/link resolution.
- **Frontend (`t3-frontend`)** — Account Settings Discord panel and admin channel-mapping
  UI against the browser-scoped contracts (§6.1, §6.2, §6.6, §6.7), with default-off
  events and permission warnings.
- **Infra (`t3-infra`)** — provision the Discord application/bot, deploy the bridge
  process with secret-managed `DISCORD_BOT_TOKEN` and bridge-scoped `PAPERCLIP_API_KEY`,
  set `PAPERCLIP_DISCORD_BRIDGE_TOKEN` on the server, register slash commands, and wire
  `PAPERCLIP_DASHBOARD_URL` for issue deep links. Live Discord staging requires the
  separately provisioned bot credentials and OAuth invite with the §2 permissions.

## 10. Out of scope / future

- Separate `/paperclip issue report` command (additive; §3).
- Priority fidelity for `urgent` (currently collapsed to `high`; §3).
- Editing/closing issues from Discord (only create is implemented).
- Public inbound Discord Interactions HTTP webhook (interactions terminate at the bridge
  gateway; §1).
