# Discord Integration — API, Payload, and Database Contracts

Status: implementable contract (as-built + normative spec)
Baseline: `ed5fb2ee0` (domain map) on `integration/paperclip` lineage
Last updated: 2026-08-30
Scope: installation flow, workspace↔guild mapping, user linking, slash-command UX, notification routing, every API endpoint (method/path/auth/payload), DB schema deltas, service boundaries, and environment variables. The entity/field inventory lives in [domain-map.md](./domain-map.md); this document is the normative contract that backend workers implement against.

Every endpoint below is implemented in `server/src/routes/discord-integrations.ts` and mounted at `api.use(discordIntegrationRoutes(db))` (`server/src/app.ts:552`), i.e. all paths are prefixed `/api`. Bridge-side consumers are implemented in the standalone `discord-bridge/` package.

---

## 1. Discord app installation flow

### 1.1 Application creation and scope

1. Create the application in the Discord Developer Portal (name, e.g. "Paperclip").
2. Record the **client id** (`DISCORD_CLIENT_ID`) and issue the **bot token** (`DISCORD_BOT_TOKEN`). Both are server-side secrets (see §8). The client secret is **not used** by this design: there is no OAuth two-legged flow — authorization is a shared bridge token (§4.0), and Discord transport auth is the bot token.
3. The bot requires **no privileged intents**. The gateway client runs with only `GatewayIntentBits.Guilds`; no message-content intent, no members intent, no presence intent.
4. Invite the bot to a guild with the `bot` + `applications.commands` OAuth2 scopes (`discord-bridge/README.md` operational contract).
5. Install the bridge service and run `npm run register-commands` (see §2.5) — dev-guild scoped when `DISCORD_DEV_GUILD_ID` is set, otherwise global (up to ~1 h propagation).

### 1.2 Company ↔ guild attachment

A guild becomes a Paperclip company's Discord surface through the **channel-mapping upsert** (§4.5). Creating the first channel mapping for a `(guildId, companyId)` implicitly upserts the guild integration row (`discord_guild_integrations`, `enabled = true`). There is no separate "install guild" endpoint; installing = mapping at least one channel. Disabling a guild integration without deleting mappings is not modeled; remove or disable each mapping, or delete the guild integration row directly (cascade does not apply to channel mappings — they reference `guild_id` by text, not FK).

### 1.3 Workspace ↔ guild mapping (deliberate scope)

Paperclip's `project_workspaces` / `execution_workspaces` are execution infrastructure, not collaboration containers (see domain-map §3.2). Mapping therefore attaches at **company → guild** (`discord_guild_integrations`) and **channel → project** (`discord_project_channel_mappings`). A workspace-level channel mapping (channel ⇄ one `project_workspaces` row) is a **non-goal** of this design; issues created from Discord are always placed at project scope.

### 1.4 Discord user ↔ Paperclip user linking (and unlink)

Linking is the bridge **consume-link-code** flow executed by the bot operator flow; the browser issues the code, the bridge redeems it:

1. **Browser (authenticated board user):** `POST /api/integrations/discord/link-codes` with `{ companyId }` → server generates a single-use code (24 random bytes, base64url; only the SHA-256 hash is persisted) with a **10-minute** TTL. Response `201 { code, expiresAt }` (ISO 8601 UTC).
2. **Bridge (bot):** `POST /api/integrations/discord/link-codes/consume` with `{ code, discordUserId, guildId? }` → server, in one transaction:
   - resolves the hash, rejects with `invalid_link_code` (400) / `link_code_used` (400) / `expired_link_code` (400);
   - if the Discord account is already actively linked to a **different** Paperclip user in the same company → `discord_account_already_linked` (409);
   - atomically marks the code consumed (`consumedAt`, guarded by `IS NULL`, so double-submission is a no-op with `link_code_used`);
   - creates/activates the link (`discord_user_links`: `active = true`, `primary = true`, `unlinkedAt = null`), upserting on `(company_id, discord_user_id)`.
   - Response `200 { status: "linked" }`.
3. **Unlink:** `POST /api/integrations/discord/unlink` with `{ discordUserId }` (bridge-scoped). Sets the active link `active = false`, `unlinkedAt = now`, and disables **all** notification preferences for that Paperclip user in the linked company. Response `200 { status: "unlinked" }`.

Constraints that hold at all times:
- At most **one active link** per `(company_id, discord_user_id)` (unique index + active checks).
- A Paperclip user may hold multiple active links across different Discord accounts (one per company), but each Discord account maps to exactly one Paperclip user per company.
- The link row stores the Paperclip **auth `user.id`** (text) — there is no FK, consistent with all user fields (domain-map §1.2).
- Only an **active** link authorizes task creation; only active links receive DM deliveries.

---

## 2. Slash-command UX — task creation

### 2.1 Command shape

One top-level command with a subcommand group (`discord-bridge/src/commands/definitions.ts`):

```
/paperclip task create <title> [description] [priority]
```

| Option | Type | Required | Constraint | Server mapping |
|---|---|---|---|---|
| `title` | string | yes | 1–200 chars (trimmed) | issue title |
| `description` | string | no | ≤ 8,000 chars when provided | issue description |
| `priority` | string choice | no | `low` \| `medium` \| `high` \| `urgent` | `urgent` → `high`; default `medium` |

Bridge-side validation (`validateTaskCreateInput`) rejects empty/over-length title and over-length description with a user-facing message **before** any API call.

### 2.2 Interaction handling contract

- Replies are **ephemeral**: `interaction.deferReply({ ephemeral: true })` then `interaction.editReply(...)`. Command bodies never appear in the channel.
- The bridge sends to the server the **immutable Discord ids** plus typed options: `discordInteractionId` (= `interaction.id`), `discordUserId`, `guildId` (nullable), `channelId`, `parentChannelId` (non-null only when invoked inside a thread; equals the thread's parent channel), `commandName: "paperclip task create"`.
- The bridge **never** selects the Paperclip project or the Paperclip user; the server resolves both from the mapping and the active link.
- Logging: only `interactionId` and `command` reach logs; command option values, response bodies, and credentials are never logged.

### 2.3 Success response payloads (user-facing)

- Created: `Created **PAP-123**: <title> — <url>` (identifier, title, dashboard URL from `PAPERCLIP_DASHBOARD_URL`).
- Duplicate (replayed interaction): `Already created **PAP-123**: <title> — <url>`.

### 2.4 Error responses (user-facing, by error code)

| API code (HTTP) | User message |
|---|---|
| `not_linked` (403) | "Link your Paperclip account before creating tasks." |
| `channel_not_mapped` (403) | "This channel is not connected to a Paperclip project." |
| `task_creation_disabled` (403) | "Task creation is disabled for this channel." |
| `project_access_denied` (403) | "Your Paperclip account cannot create tasks in this project." |
| `assignee_invalid` / `validation_failed` (400) | Field-length guidance message |
| `interaction_conflict` (409) | "This Discord interaction conflicts with an existing request. Start a new command." |
| anything else | "Paperclip could not create this task. Try again in a moment." |

### 2.5 Command registration

`npm run register-commands` PUTs `commandDefinitions` (1 command, 1 subcommand group, 1 subcommand + 3 options) to Discord REST. Route: `Routes.applicationGuildCommands(clientId, devGuildId)` when `DISCORD_DEV_GUILD_ID` is set, else `Routes.applicationCommands(clientId)` (global, ~1 h propagation). Registration is idempotent (PUT with full body replaces).

---

## 3. Notifications: event types, routing, and preferences

### 3.1 Event types (closed enum `DISCORD_NOTIFICATION_EVENTS`)

| Event | Produced when (activity action + details) |
|---|---|
| `issue.created` | action `issue.created` |
| `issue.status_changed` | `issue.updated` with `status` changed (and not blocked/done/unblock) |
| `issue.assignee_changed` | `issue.updated` with `assigneeAgentId` or `assigneeUserId` in details |
| `issue.priority_changed` | `issue.updated` with `priority` in details |
| `issue.comment_created` | actions `issue.comment.created` / `issue_comment_added` / `issue_comment_created` |
| `issue.blocked` | `issue.updated` with new status `blocked` |
| `issue.unblocked` | `issue.updated` whose previous status (`details._previous.status`) was `blocked` |
| `issue.completed` | `issue.updated` with new status `done` |

Derivation lives in `discordEventTypesForActivity()` (`server/src/services/activity-log.ts`); only `entityType === "issue"` activities produce events. One activity may produce **multiple** events (e.g. a status+assignee+priority update produces up to three). Enqueue happens **in the same request** as `persistActivity`; failure only logs a warning and never blocks the source action.

### 3.2 Recipient resolution (server-side, at enqueue time)

For each event type, recipients = union of two sources, deduplicated by `channel:<channelId>` / `dm:<discordUserId>`:

1. **Channel routing** — enabled channel mappings for the issue's project whose `notificationEvents` array includes the event type → `{ recipientType: "channel", recipientId: channelId }`.
2. **Personal DM preferences** — enabled preferences (`enabled = true`) for that event type, joined to **active** user links → if `deliveryMode === "dm"`, recipient is the linked `discordUserId`; if `deliveryMode === "channel"`, recipient is the preference's `channelId` (which must be an enabled mapping — enforced at write, §4.3).

Outbox events carry `origin: "paperclip"` (server-side activity) or `origin: "discord"` (bridge task-create) plus `originDiscordChannelId` for echo suppression (§3.4).

### 3.3 Delivery and retry contract

- Deliveries are **poll-based** (bridge polls `GET /api/integrations/discord/deliveries/pending`), not push/webhook. Server schedules `nextAttemptAt`; the bridge never decides timing.
- Terminal states: `delivered` (with `discordMessageId`), `suppressed`, `terminal_failure` (permanent Discord 4xx except 429).
- Retryable: `retryable_failure` (429 or network error) → status stays `pending`, server sets `nextAttemptAt = now + max(1, retryAfterSeconds ?? min(3600, 2^min(attempts+1, 10)))` seconds; `attempts` increments on each state-changing ack (already-terminal deliveries are acknowledged idempotently with no counter change).
- Message shape: allowlisted fields only — `issueIdentifier`, `title`/`after.title`/`before.title`, event-specific detail line (`Status:`/`Assignee:`/`Priority:`/`Comment excerpt`/block/unblock/completed/created), `By <actor> · <occurredAt>`, and `issueUrl`. **Mentions disabled** (`allowedMentions: { parse: [] }`). Payloads and credentials never reach Discord.

### 3.4 Echo suppression

`shouldSuppress()`: an `issue.created` event with `origin === "discord"` whose channel recipient equals `originDiscordChannelId` is acknowledged `suppressed` (not sent) — a task created via Discord is not announced back into the same channel. Other channels of the same project opted into `issue.created` still receive it.

---

## 4. API endpoints

### 4.0 Authentication model

| Auth class | Enforcement | Identifier |
|---|---|---|
| **Browser (board user)** | `req.actor.type === "board"` + `assertCompanyAccess` (active company membership); channel-mapping writes additionally `assertInstanceAdmin` | session cookie / actor from auth middleware |
| **Bridge (bot)** | `assertBridge`: `PAPERCLIP_DISCORD_BRIDGE_TOKEN` must be set and match the `Authorization: Bearer <token>` header via constant-time compare; unset token ⇒ 401 `"Discord bridge is not configured"` | shared server-side token |

Error body shape (all endpoints): `HttpError` → `{ error: <message>, code?: <string>, details?: <object> }`; zod validation failure → `400 { error: "Validation error", details: <zod issues> }` (see `server/src/middleware/error-handler.ts`).

---

### 4.1 GET /api/integrations/discord/settings

- **Auth:** board user + `assertCompanyAccess`.
- **Query:** `companyId` (uuid, required).
- **Response 200:**

```json
{
  "link": { "status": "linked|unlinked", "discordUserId": "<snowflake>|null" },
  "preferences": [
    { "eventType": "issue.created", "enabled": false, "deliveryMode": "dm|channel", "channelId": "<snowflake>|null" }
  ]
}
```

`preferences` always contains **all 8** event types (missing rows default `enabled: false, deliveryMode: "dm", channelId: null`).

---

### 4.2 POST /api/integrations/discord/link-codes

- **Auth:** board user + `assertCompanyAccess`.
- **Body:** `{ "companyId": "<uuid>" }`
- **Response 201:** `{ "code": "<base64url 24 random bytes>", "expiresAt": "<ISO 8601 UTC, now+10min>" }`
- Notes: only `SHA-256(codeHash)` is stored; the raw code is returned exactly once. See §1.4.

---

### 4.3 PATCH /api/integrations/discord/preferences  *(legacy alias: PUT /api/integrations/discord/notification-preferences)*

- **Auth:** board user + `assertCompanyAccess`.
- **Body:**

```json
{
  "companyId": "<uuid>",
  "preferences": [
    { "eventType": "issue.created", "enabled": true, "deliveryMode": "dm|channel", "channelId": "<snowflake>|null" }
  ]
}
```

Max 8 entries (`DISCORD_NOTIFICATION_EVENTS.length`); each entry validated against the closed enum. When any enabled channel-mode preference has a `channelId`, that channel **must** be an enabled channel mapping of the company, else `403 notification_channel_not_mapped`. Upsert key: `(companyId, userId, eventType)`.

- **Response 200:** same shape as §4.1 (full settings after write).

---

### 4.4 PUT /api/integrations/discord/settings/channel-mappings *(alias: PUT /api/integrations/discord/channel-mappings)*

- **Auth:** board user + `assertCompanyAccess` + **`assertInstanceAdmin`**.
- **Body:**

```json
{
  "companyId": "<uuid>",
  "guildId": "<snowflake>",
  "channelId": "<snowflake>",
  "projectId": "<uuid>",
  "enabled": true,
  "allowTaskCreate": false,
  "notificationEvents": ["issue.created", "issue.completed"]
}
```

`enabled`/`allowTaskCreate`/`notificationEvents` are optional (defaults `true`/`false`/`[]`); `notificationEvents` entries must be from the closed enum. The project must belong to `companyId`, else `403 project_access_denied`.

- **Semantics:** upsert on unique `(guildId, channelId)` for the mapping; **also** upserts `discord_guild_integrations` on `(companyId, guildId)` with `enabled: true` (this is the guild-install step, §1.2).
- **Response 201:** `{ "ok": true }`

---

### 4.5 POST /api/integrations/discord/link-codes/consume *(alias: POST /api/integrations/discord/link)*

- **Auth:** bridge (`assertBridge`).
- **Body:** `{ "code": "<string>", "discordUserId": "<snowflake>", "guildId": "<snowflake>|null (optional)" }`
- **Errors:** `400 invalid_link_code`, `400 link_code_used`, `400 expired_link_code`, `409 discord_account_already_linked`.
- **Response 200:** `{ "status": "linked" }`. Full transactional semantics in §1.4.

---

### 4.6 POST /api/integrations/discord/unlink

- **Auth:** bridge (`assertBridge`).
- **Body:** `{ "discordUserId": "<snowflake>" }`
- **Semantics:** deactivate the active link for that Discord account (any company) + disable all preferences of the linked user in that company.
- **Response 200:** `{ "status": "unlinked" }`. Idempotent (no active link ⇒ still `unlinked`).

---

### 4.7 POST /api/integrations/discord/commands/task-create

- **Auth:** bridge (`assertBridge`).
- **Body** (`.strict()` — unknown keys rejected):

```json
{
  "discordInteractionId": "<interaction.id>",
  "discordUserId": "<snowflake>",
  "guildId": "<snowflake>|null",
  "channelId": "<snowflake>",
  "parentChannelId": "<snowflake>|null",
  "commandName": "paperclip task create",
  "title": "1–200 chars",
  "description": "≤8000 chars (optional)",
  "priority": "low|medium|high|urgent (optional)"
}
```

- **Server pipeline:** idempotency check → mapping+guild+authz → inbound request audit row → issue create → outbox event → delivery attempts for other channels → success.
  1. **Idempotency / replay protection:** `discord_inbound_requests.discordInteractionId` unique. Previous success ⇒ `200 { duplicate: true, issue: {...} }` and **no new issue**. Any other existing row ⇒ `409 interaction_conflict`.
  2. **Authorization (all required):** channel (or its thread-parent) has an enabled mapping for `guildId` (guild integration enabled) → else `403 channel_not_mapped`; mapping `allowTaskCreate` → else `403 task_creation_disabled`; Discord user has an **active** link in the company → else `403 not_linked`; linked Paperclip user has an **active** `company_memberships` row (`principalType: "user"`) → else `403 project_access_denied`.
  3. **Issue creation:** `issueService.create` with `idempotencyKey: "discord:<interactionId>"`, `allowDuplicate: true`, `originKind: "discord"`, `originId: interactionId`, `originFingerprint: interactionId`, `createdByUserId: <linked paperclip user id>`, `projectId` from mapping, priority mapped (§2.1). Creation failure marks the inbound row `failed` (`errorCode: "create_failed"`).
  4. **Audit row:** `discord_inbound_requests` (`status: processing` → `succeeded` with `issueId`, or `failed`).
  5. **Outbox:** event `issue.created`, `origin: "discord"`, `originDiscordChannelId: channelId`, payload `{ issueIdentifier, title, issueUrl }`, idempotency `discord:issue.created:<issueId>`.
  6. **Fan-out:** delivery attempts for **enabled** channel mappings of the same project that opted into `issue.created`, **excluding** the origin channel (echo suppression), idempotency `event.id:channel:<channelId>`. No DM fan-out here (task-create origin is the channel).
- **Response 201 (created):**

```json
{ "duplicate": false, "issue": { "id": "<uuid>", "identifier": "PAP-123", "title": "<title>", "url": "https://<dashboard>/issues/PAP-123" } }
```

- **Response 200 (replayed):** same shape with `"duplicate": true`.

---

### 4.8 GET /api/integrations/discord/deliveries/pending

- **Auth:** bridge (`assertBridge`).
- **Query:** none. Server selects `status = 'pending' AND next_attempt_at <= now`, **limit 100**, joined to the outbox event.
- **Response 200:**

```json
[
  {
    "id": "<delivery uuid>",
    "recipient": { "type": "channel|dm", "id": "<snowflake>" },
    "event": {
      "id": "<event uuid>",
      "idempotencyKey": "discord:activity:<activityId>:<eventType>",
      "occurredAt": "<ISO 8601 UTC>",
      "eventType": "issue.created",
      "origin": "paperclip|discord",
      "originDiscordChannelId": "<snowflake>|null",
      "issueIdentifier": "PAP-123",
      "title": "<title>",
      "issueUrl": "<url>",
      "actor": "<actor id>",
      "before": { "status": "in_progress" },
      "after": { "status": "blocked" }
    }
  }
]
```

The `event` object is exactly the outbox row's `id`, `idempotencyKey`, `occurredAt`, `eventType`, `origin`, `originDiscordChannelId` **plus the recorded payload spread** (allowlisted fields only: `issueIdentifier`, `title`, `issueUrl`, `actor`, and — for paperclip-origin events — `before` from `details._previous` and `after` = redacted details; discord-origin events carry only `issueIdentifier`, `title`, `issueUrl`). No other outbox columns (e.g. `projectId`, `issueId`) are on the wire. Polling is safe to repeat: deliveries stay `pending` until acknowledged.

---

### 4.9 POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId

- **Auth:** bridge (`assertBridge`).
- **Path params:** `eventId`, `deliveryId` (uuids; must match one `discord_delivery_attempts` row, else `400 delivery_not_found`).
- **Body:**

```json
{
  "outcome": "delivered|suppressed|retryable_failure|terminal_failure",
  "discordMessageId": "<snowflake> (delivered only, optional)",
  "errorCode": "<string ≤80> (optional)",
  "retryAfterSeconds": "<number 0–86400> (retryable_failure only, optional)"
}
```

- **Semantics:** already-terminal delivery → `200 { status: <current> }` (idempotent no-op). Otherwise: `delivered`/`suppressed`/`terminal_failure` set status and `nextAttemptAt = now`; `retryable_failure` keeps status `pending` and schedules `nextAttemptAt` per §3.3 backoff. `attempts` increments; `discordMessageId`/`errorCode` persisted.
- **Response 200:** `{ "status": "delivered|suppressed|pending|terminal_failure" }`

---

## 5. Database schema deltas (migration-ready)

The full Discord surface ships as **migration `0231_discord_integration_authority.sql`** (`packages/db/src/migrations/`) with Drizzle definitions in `packages/db/src/schema/discord_integrations.ts`. Deltas below are the normative contract; each maps 1:1 to a `pgTable`/unique index in the schema file. All ids are `uuid PK DEFAULT gen_random_uuid()` unless noted; all timestamps are `timestamptz` with `DEFAULT now()`.

**Delta D1 — `discord_guild_integrations`** (company ↔ guild enablement)

| Column | Type | Constraints |
|---|---|---|
| `company_id` | uuid FK → companies | `ON DELETE CASCADE`, not null |
| `guild_id` | text | not null |
| `enabled` | boolean | default `true`, not null |
| `created_by_user_id` | text | nullable |
| `created_at` / `updated_at` | timestamptz | not null |

Unique index `(company_id, guild_id)`.

**Delta D2 — `discord_project_channel_mappings`** (channel ↔ project binding + routing policy)

| Column | Type | Constraints |
|---|---|---|
| `company_id` | uuid FK → companies | cascade, not null |
| `guild_id` | text | not null |
| `channel_id` | text | not null |
| `project_id` | uuid FK → projects | cascade, not null |
| `enabled` | boolean | default `true`, not null |
| `allow_task_create` | boolean | default `false`, not null |
| `notification_events` | jsonb `string[]` | default `'[]'`, not null; subset of the 8-event enum |
| `created_by_user_id` | text | nullable |
| `created_at` / `updated_at` | timestamptz | not null |

Unique index `(guild_id, channel_id)`; secondary index `(company_id, project_id)`.

**Delta D3 — `discord_user_links`** (Discord user ↔ Paperclip `user.id`)

| Column | Type | Constraints |
|---|---|---|
| `company_id` | uuid FK → companies | cascade, not null |
| `user_id` | text (auth `user.id`) | not null, **no FK** |
| `discord_user_id` | text | not null |
| `is_primary` | boolean | default `true`, not null |
| `active` | boolean | default `true`, not null |
| `linked_at` | timestamptz | default now, not null |
| `unlinked_at` | timestamptz | nullable (relink clears) |
| `created_at` / `updated_at` | timestamptz | not null |

Unique index `(company_id, discord_user_id)`; index `(company_id, user_id)`.

**Delta D4 — `discord_link_codes`** (single-use, SHA-256 only)

| Column | Type | Constraints |
|---|---|---|
| `company_id` | uuid FK → companies | cascade, not null |
| `user_id` | text | not null |
| `code_hash` | text (sha256 hex) | not null |
| `expires_at` | timestamptz | not null (issued at +10 min) |
| `consumed_at` | timestamptz | nullable; set atomically under `IS NULL` guard |
| `created_at` | timestamptz | not null |

Unique index `(code_hash)`; index `(company_id, user_id)`.

**Delta D5 — `discord_notification_preferences`** (per-user per-event opt-in)

| Column | Type | Constraints |
|---|---|---|
| `company_id` | uuid FK → companies | cascade, not null |
| `user_id` | text | not null |
| `event_type` | text | not null, closed enum |
| `enabled` | boolean | default `false` (**opt-in**) |
| `delivery_mode` | text | default `'dm'` (`dm`\|`channel`) |
| `channel_id` | text | nullable; required when mode = channel, must be enabled mapping (write-time check) |
| `updated_at` | timestamptz | not null |

Unique index `(company_id, user_id, event_type)`.

**Delta D6 — `discord_inbound_requests`** (replay protection + audit)

| Column | Type | Constraints |
|---|---|---|
| `discord_interaction_id` | text | not null, **unique** |
| `discord_user_id` | text | not null |
| `guild_id` | text | nullable |
| `channel_id` | text | not null |
| `command_name` | text | not null (extends for future commands) |
| `company_id` | uuid | nullable until resolved |
| `issue_id` | uuid FK → issues | `ON DELETE SET NULL` |
| `status` | text | default `'processing'` (`processing`\|`succeeded`\|`failed`) |
| `error_code` | text | nullable |
| `created_at` / `updated_at` | timestamptz | not null |

**Delta D7 — `integration_event_outbox`** (cross-system event log, idempotent)

| Column | Type | Constraints |
|---|---|---|
| `idempotency_key` | text | not null, **unique** (`discord:activity:<activityId>:<eventType>` or `discord:issue.created:<issueId>`) |
| `company_id` | uuid FK → companies | cascade, not null |
| `project_id` | uuid FK → projects | `ON DELETE SET NULL` |
| `issue_id` | uuid FK → issues | `ON DELETE SET NULL` |
| `event_type` | text | not null (closed enum) |
| `origin` | text | not null (`paperclip`\|`discord`) |
| `origin_discord_channel_id` | text | nullable (echo suppression) |
| `payload` | jsonb | not null; allowlisted redacted fields only |
| `occurred_at` / `created_at` | timestamptz | not null |

**Delta D8 — `discord_delivery_attempts`** (one row per recipient per event)

| Column | Type | Constraints |
|---|---|---|
| `event_id` | uuid FK → outbox | `ON DELETE CASCADE`, not null |
| `recipient_type` | text | not null (`channel`\|`dm`) |
| `recipient_id` | text | not null (Discord channel/user snowflake) |
| `idempotency_key` | text | not null, unique (`event.id:recipientType:recipientId`) |
| `status` | text | default `'pending'` (`pending`\|`delivered`\|`suppressed`\|`terminal_failure`) |
| `attempts` | integer | default 0 |
| `next_attempt_at` | timestamptz | default now; poll predicate |
| `discord_message_id` | text | nullable |
| `error_code` | text | nullable |
| `created_at` / `updated_at` | timestamptz | not null |

Unique index `(event_id, recipient_type, recipient_id)`; index `(status, next_attempt_at)` for the pending poll.

**Future-delta rule:** any subsequent schema change (e.g. a new command's columns, workspace-level mapping FK) must be issued as a new numbered migration (`0232_...sql`) + Drizzle schema update generated via drizzle-kit; never edit `0231` in place after release.

---

## 6. Service boundaries

| Service | Owns | Never does |
|---|---|---|
| **Paperclip server** (`server/src/routes/discord-integrations.ts`, `services/activity-log.ts`) | All authority and state: link state, link codes, channel mappings, guild integrations, preferences, authz, idempotency/replay protection, issue creation, outbox events, delivery attempts, retry scheduling, acknowledgement handling | Never touches the Discord API; never stores bot/client secrets beyond env; never exposes secrets or command bodies to clients |
| **discord-bridge** (`discord-bridge/`) | Discord transport only: slash-command registration, interaction handling, gateway client (`Guilds` intent), message formatting (allowlisted fields, mentions disabled), send/DM, ack delivery outcome | Holds **zero** durable state; never selects project/user identity; never logs command bodies, link codes, credentials, or response bodies; no privileged intents; no message-content reads |
| **@paperclipai/db** | Drizzle schema + migration `0231` | — |
| **authz** (`server/src/routes/authz.ts`) | `assertCompanyAccess`, `assertInstanceAdmin`; bridge check is inline in the Discord routes (`assertBridge`) | — |

The division is load-bearing: a deployed bridge credential (`PAPERCLIP_API_KEY`/bridge token) is authorized **only** for `/api/integrations/discord/*` and cannot become a generic issue writer or submit caller-controlled Paperclip identity.

---

## 7. Flow summaries

### 7.1 Outbound (domain → Discord)

`logActivity` → `activity_log` row (redacted details) → `enqueueDiscordNotifications`: derive event types → upsert outbox (idempotent) → resolve recipients (channel mappings + active-link DM preferences) → insert delivery attempts (idempotent) → bridge polls `deliveries/pending` → echo-suppress if applicable → send (channel/DM, mentions off) → ack (`delivered`/`suppressed`/`retryable_failure`/`terminal_failure`) → server updates state; retries server-scheduled.

### 7.2 Inbound (Discord → domain)

`/paperclip task create` → bridge router (ephemeral) → `POST commands/task-create` (immutable ids) → server: replay check → mapping/guild/link/membership authz → inbound request row → issue create (`discord:` idempotency, origin `discord`) → outbox `issue.created` + other-channel fan-out → bridge formats `Created **PAP-123** …` → server acks/leaves delivery pending for other channels.

### 7.3 Failure handling summary

| Failure | Behavior |
|---|---|
| Duplicate interaction (replay) | `200 duplicate: true`, same issue returned; no second issue |
| Discord user unlinked / never linked | `403 not_linked`; user-facing link prompt; no issue created |
| Channel unmapped / task-create disabled | `403`; no issue created |
| Deleted/unsendable channel at delivery time | bridge gets 404 → `terminal_failure`; server stops retrying |
| DM blocked by user | Discord 403 → `terminal_failure`; no retry |
| Rate limit / network error | `retryable_failure` + `retryAfterSeconds`; server exponential backoff capped 3600 s |
| Enqueue failure (server crash mid-write) | warning logged; source action unaffected; no partial delivery state |
| Ack failure | bridge logs (correlation fields only) and moves on; delivery stays `pending` and is re-polled |

---

## 8. Environment variables (secrets are server-side only)

**Server (`@paperclipai` API).** Never exposed to browser clients; read from the server process environment.

| Variable | Required | Purpose | Secret? |
|---|---|---|---|
| `PAPERCLIP_DISCORD_BRIDGE_TOKEN` | yes (for bridge endpoints) | Bearer token authenticating the bot; constant-time compare; unset ⇒ all bridge endpoints 401 "Discord bridge is not configured" | **Yes — server-side only** |
| `PAPERCLIP_DASHBOARD_URL` | no | Base URL for issue links in notifications and task-create responses; no trailing slash required | No (public dashboard origin; server-side config) |

**Discord secrets (bot token, client secret, signing/public key) are kept server-side at all times:** the bot token (`DISCORD_BOT_TOKEN`) lives in the bridge service's environment (a server-side deployment), never in the browser bundle or a client response; the **client secret is unused** by this design (no OAuth); interaction **signing/public key** is not used because the design is gateway (websocket) transport, not webhook — if a webhook/`POST /interactions` receiver is ever added, its public key must also live server-side only.

**discord-bridge service.** Read from the bridge process environment (`.env`, or a secret store in production).

| Variable | Required | Purpose | Secret? |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | yes (bridge fails fast) | Discord bot token | **Yes — server-side only** |
| `DISCORD_CLIENT_ID` | yes | Application client id (command registration) | No (public id, but server-side config) |
| `DISCORD_DEV_GUILD_ID` | no | Scopes command registration to one guild for instant propagation during dev; omit for global (~1 h) | No |
| `PAPERCLIP_API_URL` | yes | Paperclip API base (`http://localhost:3100`); trailing `/api` stripped | No |
| `PAPERCLIP_API_KEY` | yes | Bridge-scoped credential, authorized **only** for `/api/integrations/discord/*` | **Yes — server-side only** |
| `POLL_INTERVAL_SECONDS` | no | Outbox poll interval (default `30`, floor `1`) | No |

Never write any of these to client-side bundles, responses, logs, or commit them to the repository (`.env.example` carries empty placeholders only).