# Discord Integration — Security and Failure Handling Rules

Status: design rules (normative), grounded in the as-built code
Baseline commit: `8fea5a31dc48d555b2bb653a7cc96674ec290d89` (branch `integration/paperclip` lineage)
Last updated: 2026-08-30
Builds on: [domain-map.md](./domain-map.md)
Scope: permission model, replay/idempotency protection, secret handling, interaction-signature verification, and explicit failure handling for the five required scenarios.

This document specifies the security and resilience rules for the Discord integration. It is normative ("MUST"/"MUST NOT"/"SHOULD") and each rule is anchored to the as-built implementation named in the domain map. Where the as-built already enforces a rule, this document records it as the contract; where a rule is a requirement that the transport choice would change (notably HTTP-interaction signature verification), that is called out explicitly rather than described as already present.

---

## 0. Trust model and transport (must read first)

The bridge connects to Discord over the **discord.js Gateway (an outbound, TLS-authenticated WebSocket authenticated by the bot token)** with **only the `Guilds` intent** (`discord-bridge/src/index.ts`: `new Client({ intents: [GatewayIntentBits.Guilds] })`). It does **not** expose an inbound HTTP interactions endpoint, and Paperclip does not receive Discord-signed HTTP webhooks.

Consequences that drive every rule below:

- There is **no attacker-controllable HTTP request from Discord** to verify. Interactions arrive only over the authenticated Gateway session, so Discord's Ed25519 HTTP request-signing scheme is **not part of the as-built trust boundary** (see §5).
- The real trust boundary Paperclip must defend is the **bridge → Paperclip API** call (`POST /api/integrations/discord/*`). That boundary is authenticated by a shared bridge token and is where replay/idempotency, authorization, and failure handling are enforced (`server/src/routes/discord-integrations.ts`).
- The bridge is **transport-only and holds zero authority state**; the Paperclip server owns all authorization, linking, idempotency, and delivery state (domain map §6).

Two distinct secrets sit on the two hops and MUST NOT be conflated:

| Secret | Hop it authenticates | Held by |
|---|---|---|
| `DISCORD_BOT_TOKEN` | bridge ↔ Discord Gateway | bridge only |
| `PAPERCLIP_DISCORD_BRIDGE_TOKEN` (server) = `PAPERCLIP_API_KEY` (bridge, sent as `Authorization: Bearer …`) | bridge ↔ Paperclip API | bridge (sends) + server (verifies) |

---

## 1. Permission model

### 1.1 Actors

| Actor | How authenticated | Where checked |
|---|---|---|
| Board user (browser) | Better Auth session; `req.actor.type === "board"`, `req.actor.userId` | `browserUser()`, `assertCompanyAccess`, `assertInstanceAdmin` |
| Instance admin | Board user with `isInstanceAdmin` or `source === "local_implicit"` | `assertInstanceAdmin` |
| Bridge (bot) | Bearer shared token, constant-time compared | `assertBridge` / `bridgeAuthorized` (`timingSafeEqual`) |
| Discord end user | Never trusted directly; must resolve to an **active** `discord_user_links` row **and** an active company membership | task-create link + membership checks |

### 1.2 Permission matrix

"Company membership" = active `company_memberships` row for the user (non-viewer for writes). "Instance admin" = `assertInstanceAdmin`. "Bridge token" = valid `PAPERCLIP_DISCORD_BRIDGE_TOKEN`. "Linked + member" = active `discord_user_links` row whose `user_id` holds an active company membership.

| Capability | Endpoint / mechanism | Required permission | As-built enforcement |
|---|---|---|---|
| Install / register the Discord app (bot token, slash-command deploy) | `discord-bridge/src/registerCommands.ts`, deployment env | Instance operator with server/host access (out-of-band; not an API route) | Ops-level: whoever holds `DISCORD_BOT_TOKEN` + `DISCORD_CLIENT_ID`. MUST be an instance operator, not an end user. |
| Enable a guild ↔ company integration | side-effect of channel-mapping upsert (`discordGuildIntegrations` upsert in `updateChannelMapping`) | Company membership **and** instance admin | `assertCompanyAccess` + `assertInstanceAdmin` |
| Create / edit a channel ↔ project mapping and its routing (`enabled`, `allowTaskCreate`, `notificationEvents`) | `PUT /integrations/discord/(settings/)channel-mappings` | Company membership **and** instance admin | `assertCompanyAccess` + `assertInstanceAdmin`; project MUST belong to the company (`project_access_denied` otherwise) |
| Read own Discord settings/link status | `GET /integrations/discord/settings` | Company membership (self) | `browserUser` + `assertCompanyAccess` |
| Issue a link code (start account linking) | `POST /integrations/discord/link-codes` | Company membership (self) | `browserUser` + `assertCompanyAccess`; code is single-use, 10-min TTL, stored only as SHA-256 hash |
| Consume a link code (finish linking a Discord account) | `POST /integrations/discord/link(-codes/consume)` | Bridge token + valid unexpired unused code | `assertBridge` + transactional consume |
| Set own notification preferences | `PATCH /integrations/discord/preferences`, `PUT …/notification-preferences` | Company membership (self); channel-mode requires an enabled mapped channel | `browserUser` + `assertCompanyAccess`; `notification_channel_not_mapped` if channel not enabled-mapped |
| Create a task via `/paperclip task create` | `POST /integrations/discord/commands/task-create` | Bridge token + channel mapped & enabled + `allowTaskCreate` true + Discord user linked + linked user is active company member | `assertBridge` + mapping/guild/`allowTaskCreate`/link/membership checks |
| Unlink a Discord account | `POST /integrations/discord/unlink` | Bridge token | `assertBridge`; also disables that user's notification preferences |
| Poll pending deliveries / acknowledge delivery | `GET …/deliveries/pending`, `POST …/events/:eventId/deliveries/:deliveryId` | Bridge token | `assertBridge` |

Rules that follow from the matrix:

- **R-P1 (least intent):** the bridge MUST request only the `Guilds` gateway intent. It MUST NOT request `MessageContent`, `GuildMembers`, or any privileged intent. Reading arbitrary user messages is out of scope.
- **R-P2 (admin gate on routing):** all channel-mapping and guild-enable writes MUST require instance admin **in addition to** company membership. A plain member MUST NOT be able to route a channel to a project or toggle `allowTaskCreate`.
- **R-P3 (opt-in task creation):** task creation from a channel MUST be denied unless that specific channel mapping has `allowTaskCreate === true` (default `false`). Enabling a mapping for notifications MUST NOT implicitly enable task creation.
- **R-P4 (linked-and-member):** an inbound Discord command MUST resolve the Discord user id to an **active** link **and** verify the linked Paperclip user holds an **active** `company_memberships` row of `principalType: "user"`. Being linked is necessary but not sufficient.
- **R-P5 (self-scope):** link-code issuance and preference writes act only on the authenticated board user's own id (`browserUser` returns `req.actor.userId`); a user MUST NOT set another user's link or preferences.
- **R-P6 (opt-in notifications):** per-event notification preferences default to `enabled: false`. Delivery to a user MUST require an explicit enabled preference joined to an active link (domain map §5.3).

---

## 2. Replay protection and idempotency

Discord may deliver the same interaction or the bridge may retry the same API call; the integration MUST be safe under at-least-once delivery on every hop. Three independent idempotency keys enforce this.

### 2.1 Inbound command idempotency (Discord → Paperclip)

- **R-R1 (interaction dedupe):** every inbound command is keyed by the Discord `interactionId`, persisted as `discord_inbound_requests.discord_interaction_id` (**unique**). On task-create:
  - if a prior row exists **with an `issueId`**, the server MUST return the existing issue with `{ duplicate: true }` and MUST NOT create a second issue;
  - if a prior row exists **without an `issueId`** (in-flight/failed), the server MUST reject with `409 interaction_conflict` rather than racing a duplicate.
- **R-R2 (issue-create idempotency):** issue creation MUST pass `idempotencyKey: discord:<interactionId>` (and `originKind: "discord"`, `originId`, `originFingerprint = interactionId`) to `issueService.create`, so even a retry that slips past R-R1 collapses to one issue at the issue layer (`issue_create_idempotency_keys`, domain map §2.1).
- **R-R3 (interaction id is server-assigned):** `interactionId` originates from Discord and is delivered over the authenticated Gateway; the bridge MUST forward it verbatim and MUST NOT synthesize or reuse ids across interactions.

### 2.2 Outbound delivery idempotency (Paperclip → Discord)

- **R-R4 (outbox key):** each domain event is written once to `integration_event_outbox` with a unique `idempotency_key` — `discord:activity:<activityId>:<eventType>` for activity-derived events and `discord:issue.created:<issueId>` for Discord-origin task-creates. A duplicate enqueue MUST be a no-op via the unique constraint.
- **R-R5 (per-recipient key):** each recipient fan-out row in `discord_delivery_attempts` is keyed `<eventId>:<recipientType>:<recipientId>` (**unique**) and inserted with `onConflictDoNothing`, so re-running fan-out cannot create duplicate sends.
- **R-R6 (terminal-state ack):** the acknowledgement endpoint MUST be idempotent: if a delivery is already `delivered`, `suppressed`, or `terminal_failure`, a repeated ack MUST return that state unchanged and MUST NOT resend or reset it.
- **R-R7 (bounded retry backoff):** on `retryable_failure` the server reschedules `next_attempt_at = now + max(1, retryAfterSeconds ?? min(3600, 2^min(attempts+1,10)))` seconds and increments `attempts`. Backoff is server-scheduled; the bridge MUST NOT choose its own retry cadence beyond honoring `nextAttemptAt` via polling.

### 2.3 Timestamp / freshness window

- **R-R8 (link-code TTL):** link codes MUST expire 10 minutes after issuance (`expiresAt`) and MUST be single-use (`consumedAt` set atomically inside the consume transaction). An expired code MUST return `expired_link_code`; an already-consumed code MUST return `link_code_used`.
- **R-R9 (interaction freshness):** because interactions arrive only over the authenticated Gateway (not replayable HTTP), the primary freshness control is the interaction-id uniqueness of R-R1. If an HTTP interactions transport is ever adopted, a signed-timestamp freshness window MUST additionally be enforced per §5.

---

## 3. Secret handling

- **R-S1 (server-side secrets):** `PAPERCLIP_DISCORD_BRIDGE_TOKEN` (server verifier) and `DISCORD_BOT_TOKEN` (Gateway auth) MUST live only in server/bridge process environment. They MUST NOT be sent to browsers, embedded in the UI bundle, logged, or returned by any API response.
- **R-S2 (constant-time compare):** bridge-token verification MUST use a length check plus `timingSafeEqual` (as in `bridgeAuthorized`); string `===` comparison is prohibited to avoid timing oracles.
- **R-S3 (unconfigured = closed):** if `PAPERCLIP_DISCORD_BRIDGE_TOKEN` is unset/blank, every bridge endpoint MUST fail closed with `401 "Discord bridge is not configured"` (`assertBridge`). The integration MUST NOT default to open.
- **R-S4 (hash at rest):** link codes MUST be stored only as SHA-256 (`code_hash`), never in plaintext; the plaintext is shown to the user once and passed once to the consume call.
- **R-S5 (no body logging):** the bridge MUST NOT log command options, response bodies, credentials, or PII. Only the interaction id and command name are safe correlation fields (`router.ts` catch block). Server-side `activity_log.details` MUST remain redacted (`sanitizeRecord` + username censor, domain map §4).
- **R-S6 (allowlisted payloads):** outbox payloads and Discord messages MUST carry only the allowlisted fields (`issueIdentifier`, `title`, `issueUrl`, `actor`, `before`, `after`, `commentExcerpt`); the notifier formats from these alone (`formatDiscordNotification`). Raw domain records MUST NOT be forwarded to Discord.
- **R-S7 (no mentions injection):** all Discord sends MUST set `allowedMentions: { parse: [] }` so attacker-supplied titles/descriptions cannot trigger @everyone/role pings.
- **R-S8 (bridge key least privilege):** the bridge's `PAPERCLIP_API_KEY` MUST be authorized only for `/api/integrations/discord/*` and MUST equal the server's `PAPERCLIP_DISCORD_BRIDGE_TOKEN`. It MUST NOT be a general-purpose company or agent key.

---

## 4. Failure handling (the five required scenarios)

Each scenario states the trigger, the required behavior, and the exact error code / fallback in the as-built.

### 4.1 Unauthorized user

- **Trigger:** a Discord command from a user who is not linked, or is linked but not an active company member, or a bridge/board call without valid credentials.
- **Rule:** deny; never partially act. Specific responses:
  - missing/invalid bridge token → `401` (`Discord bridge authentication required`, or `Discord bridge is not configured` when unset);
  - board call without a session/user → `401 Board authentication required`;
  - Discord user not linked → `403 not_linked`;
  - linked user without active membership → `403 project_access_denied`;
  - board member lacking instance admin on a mapping write → `403 Instance admin access required`.
- **Fallback / UX:** the bridge replies ephemerally ("Paperclip could not process this command…") and MUST NOT reveal why authorization failed (no enumeration of companies, links, or mappings). The server MUST record nothing that leaks another tenant's state.

### 4.2 Duplicate Discord events

- **Trigger:** Discord redelivers an interaction, or the bridge retries a task-create or a notification send.
- **Rule:** collapse to one effect via §2. Inbound duplicates return `{ duplicate: true }` with the original issue (R-R1) or `409 interaction_conflict` while in-flight; outbound duplicates are absorbed by the unique outbox key (R-R4) and per-recipient delivery key with `onConflictDoNothing` (R-R5); repeated acks are no-ops on terminal states (R-R6).
- **Fallback:** a duplicate MUST NOT create a second issue, a second outbox event, a second delivery row, or a state regression. The user-visible reply for a duplicate task-create is the original task, not an error.

### 4.3 Deleted (or unreachable) channels

- **Trigger:** a mapped channel referenced by a delivery no longer exists / bot lacks access, or a routing target was removed.
- **Rule:** the notifier's `sendDelivery` fetches the channel; a missing/non-sendable channel raises a synthetic `404`, which `failureAcknowledgement` classifies as **`terminal_failure`** (4xx, non-429). The delivery is acked terminal and MUST NOT be retried indefinitely.
- **Fallback:** the source domain action is unaffected (notification enqueue failures only warn; domain map §7.1 step 5). Operators SHOULD remove or repoint the stale `discord_project_channel_mappings` row; until then further events to that channel also terminate quickly rather than blocking the queue. Echo suppression still applies (an `issue.created` of Discord origin to its own source channel is acked `suppressed`, not sent).

### 4.4 Failed DMs

- **Trigger:** a user has DMs closed, blocked the bot, or shares no mutual guild, so `user.send` fails.
- **Rule:** classify by HTTP status via `failureAcknowledgement`:
  - `403`/`404`/other non-429 4xx (DMs disabled, cannot DM this user) → **`terminal_failure`**, no further retries for that delivery;
  - `429` or network/5xx → **`retryable_failure`** with server-scheduled backoff (R-R7).
- **Fallback:** a failed DM MUST NOT block channel deliveries of the same event (each `discord_delivery_attempts` row is independent). The failure is logged with `eventId`/`deliveryId`/`errorCode` only (no message body). Users who want reliable delivery SHOULD set `deliveryMode: "channel"` on a mapped channel.

### 4.5 Unlinked users

- **Trigger:** a Discord command from a user with no active link, or a user whose link was removed (`POST …/unlink`).
- **Rule:** inbound commands from an unlinked Discord user → `403 not_linked` (§4.1). On unlink, the server sets the link `active=false` + `unlinkedAt`, and MUST also disable that user's notification preferences so no further DMs are attempted for them.
- **Fallback:** the ephemeral reply SHOULD guide the user to link (issue a link code from Account Settings, then run the link flow). Because notification recipient resolution joins to **active** links only, an unlinked user is automatically excluded from future DM fan-out without any queue cleanup.

### 4.6 Cross-cutting failure invariants

- **R-F1 (never block the source):** notification enqueue/delivery failures MUST NOT fail or roll back the originating domain action; they only log (`enqueueDiscordNotifications` warns; domain map §7.1).
- **R-F2 (poll isolation):** a single delivery's failure MUST NOT abort the poll batch; the worker continues to the next delivery (`deliverPendingOnce` per-item try/catch).
- **R-F3 (terminal vs retryable):** the 4xx-except-429 → terminal, 429/network → retryable classification MUST be applied uniformly to channel and DM sends (`failureAcknowledgement`).
- **R-F4 (ack-failure safety):** if acknowledging an outcome to Paperclip itself fails, the worker logs and moves on; the delivery stays `pending` and is retried on a later poll (no double-send, because delivery only happens after a successful Discord send returns a message id, and terminal states are ack-idempotent per R-R6).

---

## 5. Interaction-signature (Ed25519) verification

**As-built:** Discord interactions reach Paperclip via the Gateway bot session, not via HTTP webhooks, so **there is no inbound Discord HTTP request for Paperclip to sign-verify today.** The bot-token-authenticated, TLS-encrypted Gateway session is the integrity/authenticity control for the Discord→bridge hop, and the bridge→server hop is protected by the bridge token (§3) plus interaction-id idempotency (§2.1).

**Conditional requirement (MUST, if the transport ever changes):** should the integration adopt Discord's **HTTP Interactions Endpoint** (Discord POSTing interaction payloads to a public URL), the receiving endpoint MUST, before any processing:

1. Read the `X-Signature-Ed25519` (hex signature) and `X-Signature-Timestamp` headers and the **raw, unparsed** request body.
2. Verify the Ed25519 signature over `timestamp + rawBody` using the application's **public key** from the Discord Developer Portal (`DISCORD_PUBLIC_KEY`, held server-side per §3). Verification MUST use a vetted library (e.g. `discord-interactions` `verifyKey`, or `tweetnacl` `sign.detached.verify`) — never a hand-rolled check.
3. On signature mismatch, missing headers, or a body already consumed by JSON middleware, respond **`401`** and process nothing.
4. Enforce a **timestamp freshness window** (recommended ±5 minutes) to bound replay of a captured-but-valid signed request (this is R-R9's signed-transport form), in addition to interaction-id idempotency.
5. Respond to Discord `PING` (`type: 1`) with `PONG` (`type: 1`) as required for endpoint validation.

The public key is used only to **verify**; Paperclip never signs. The bot token and bridge token are unrelated to signature verification and MUST NOT be repurposed for it.

---

## 6. Summary of enforcement anchors

| Rule area | Primary anchor |
|---|---|
| Bridge auth (constant-time, fail-closed) | `assertBridge` / `bridgeAuthorized`, `server/src/routes/discord-integrations.ts` |
| Board/admin authz | `assertCompanyAccess`, `assertInstanceAdmin`, `browserUser`, `server/src/routes/authz.ts` |
| Task-create permission chain | `POST …/commands/task-create` (mapping → guild-enabled → `allowTaskCreate` → link → membership) |
| Inbound idempotency | `discord_inbound_requests.discord_interaction_id` (unique) + `issueService.create` idempotency key |
| Outbound idempotency | `integration_event_outbox.idempotency_key` + `discord_delivery_attempts.idempotency_key` (unique, `onConflictDoNothing`) |
| Retry/backoff + terminal-state ack | `POST …/events/:eventId/deliveries/:deliveryId` |
| Delivery failure classification | `failureAcknowledgement`, `discord-bridge/src/lib/notifier.ts` |
| Least-intent / echo suppression / mention safety | `discord-bridge/src/index.ts` (`Guilds` only), `shouldSuppress`, `allowedMentions: { parse: [] }` |
| Secret handling | `PAPERCLIP_DISCORD_BRIDGE_TOKEN`, `DISCORD_BOT_TOKEN`, `code_hash` (SHA-256), redacted logs |
