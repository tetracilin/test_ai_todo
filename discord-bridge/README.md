# Paperclip Discord Bridge

Bridge owns Discord transport. Paperclip integration API owns link state, channel mappings, authorization, idempotency, issues, event outbox, leases, retries, and delivery acknowledgement state.

## Command

`/paperclip task create title:<text> [description:<text>] [priority:<low|medium|high|urgent>]`

Bridge sends immutable interaction, user, guild, and channel IDs plus typed options to:

`POST /api/integrations/discord/commands/task-create`

Bridge never selects Paperclip project or user ID. Server resolves linked actor and channel mapping. Repeated interaction returns existing issue summary with `duplicate: true`.

All command replies are ephemeral. Gateway requests only `Guilds`; no message content or privileged intents. Logs exclude command bodies, credentials, link codes, and HTTP response bodies.

After ready, same process starts durable outbox delivery worker. It polls leased records from `GET /api/integrations/discord/deliveries/pending`, sends allowlisted notification fields with mentions disabled, then acknowledges outcome. Discord 429 yields retry scheduling; terminal 403/404 stops delivery. Source-channel task-create notification is suppressed to avoid echo.

## Required server contracts

User-scoped:

- `GET /api/integrations/discord/settings`
- `PATCH /api/integrations/discord/preferences`
- `PUT /api/integrations/discord/settings/channel-mappings`
- `POST /api/integrations/discord/link-codes`
- `POST /api/integrations/discord/disconnect`

Bridge-scoped:

- `POST /api/integrations/discord/link-codes/consume`
- `POST /api/integrations/discord/commands/task-create`
- `GET /api/integrations/discord/deliveries/pending`
- `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId`

Link codes are single-use, expire after ten minutes, and server persists only SHA-256 code hashes.

## Setup

1. Copy `.env.example` to `.env`; use secret store in production.
2. Set `PAPERCLIP_API_KEY` to bridge-scoped credential valid only for `/api/integrations/discord/*`.
3. Run `npm ci`, `npm run register-commands`, then `npm start`.

## Verification

`npm test`

`npm run build`
