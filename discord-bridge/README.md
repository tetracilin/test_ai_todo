# Paperclip Discord Bridge

Bridge owns Discord transport. Paperclip integration API owns link state, channel mappings, authorization, idempotency, issues, event outbox, leases, retries, and delivery acknowledgement state.

## Command

`/paperclip task create title:<text> [description:<text>] [priority:<low|medium|high|urgent>]`

Bridge sends immutable interaction, user, guild, and channel IDs plus typed options to:

`POST /api/integrations/discord/commands/task-create`

Bridge never selects Paperclip project or user ID. Server resolves linked actor and channel mapping. Repeated interaction returns existing issue summary with `duplicate: true`.

All command replies are ephemeral. Logs exclude command bodies, message content, attachment names, credentials, link codes, and HTTP response bodies.

## Direct messages (WP-0 pilot, F-DM-2)

Gateway requests `Guilds`, `DirectMessages`, and the privileged `MessageContent` intent. Turn on **Message Content Intent** under Bot → Privileged Gateway Intents in the Discord Developer Portal. A bot in fewer than 100 servers needs no review for it. Without it, DMs arrive with empty content.

Only DMs are processed. A guild message is dropped before anything is read or forwarded, so the intent does not widen what the bridge sees in servers.

For each DM from a human, the bridge sends the user, message, and channel IDs, the text, and attachment **metadata** (id, filename, content type, size) to:

`POST /api/integrations/discord/dm/inbound`

The server decides everything:

- Is the sender linked to exactly one company as an active non-viewer member? If not, the response is `{ linked: false }` and the bridge stays silent, so a stranger cannot probe which accounts exist.
- Which attachments pass the content-type and size allowlist? No attachment bytes are fetched at this stage.
- What reply to send, in Vietnamese, from the WP-0 phrase table in `@paperclipai/shared`.

The bridge posts that reply with mentions disabled.

## Replay after downtime (F-DM-3)

Discord's DM history is the durable copy of every DM, so the bridge keeps no local state and needs no volume. The server keeps a ledger keyed on the Discord message id (`discord_dm_inbound_messages`, no message content). It answers each id once. A failed attempt releases the id, so the next replay processes it instead of dropping it as a duplicate. An id that fails five times is left alone, so one bad message cannot stall the replay.

A sweep runs at startup, after the gateway reconnects with a fresh session (a resumed session replays events itself), and every five minutes while Paperclip is unreachable. A sweep does three things:

1. It reads `GET /api/integrations/discord/dm/replay-cursors`: one cursor per linked engineer, plus the two status messages rendered from the WP-0 phrase table.
2. It re-reads each engineer's DMs after the cursor, oldest first, and resubmits them with `replay: true`. Replays are not rate limited, and messages already answered come back as `duplicate` and get no reply.
3. It tells each engineer who had messages replayed (`agent_recovered`, with the count), and reports the window to `POST /api/integrations/discord/dm/downtime`. The server logs that window as a `discord.dm_downtime` activity in each pilot company, so the band call can discount it.

While Paperclip is down for more than 15 minutes, each engineer who sent a DM gets one `agent_downtime` notice. The bridge caches that text from the last successful sweep, because it cannot ask the server that is down. Replay reaches back at most 24 hours, and never before the account was linked.

After ready, same process starts durable outbox delivery worker. It polls leased records from `GET /api/integrations/discord/deliveries/pending`, sends allowlisted notification fields with mentions disabled, then acknowledges outcome. Discord 429 yields retry scheduling; terminal 403/404 stops delivery. Source-channel task-create notification is suppressed to avoid echo.

## Required server contracts

User-scoped:

- `GET /api/integrations/discord/settings`
- `PATCH /api/integrations/discord/preferences`
- `PUT /api/integrations/discord/settings/channel-mappings`
- `POST /api/integrations/discord/link-codes`

Bridge-scoped:

- `POST /api/integrations/discord/link-codes/consume`
- `POST /api/integrations/discord/commands/task-create`
- `POST /api/integrations/discord/dm/inbound`
- `GET /api/integrations/discord/dm/replay-cursors`
- `POST /api/integrations/discord/dm/downtime`
- `GET /api/integrations/discord/deliveries/pending`
- `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId`

Link codes are single-use, expire after ten minutes, and server persists only SHA-256 code hashes.

## Setup

1. Copy `.env.example` to `.env` for local development. Set `DISCORD_BOT_TOKEN`,
   `DISCORD_CLIENT_ID`, `DISCORD_WEBHOOK_SECRET`, and `PAPERCLIP_API_KEY` there only
   for local development.
2. In staging and production, provision each value outside git and set its `*_FILE`
   variable to a mounted secret file. Docker Compose uses `deploy-staging/.env.example`
   as the non-secret reference. Direct values take precedence only for local development.
3. Set `PAPERCLIP_API_KEY` to bridge-scoped credential valid only for `/api/integrations/discord/*`.
4. Run `npm ci`, `npm run register-commands`, then `npm start`.

`DISCORD_WEBHOOK_SECRET` is reserved for a bridge-owned signed webhook endpoint. The
current integration receives commands through the Discord gateway, not a public server
webhook. It is still required at startup so every deployment has a secret-manager-backed
value ready before that endpoint is enabled.

## Verification

`npm test`

`npm run build`
