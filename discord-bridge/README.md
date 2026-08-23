# Paperclip Discord Bridge

Standalone chat bridge for Paperclip (issue T-10, design doc on T-8): lets a human see their
Paperclip work, read status, comment, and resolve pending confirmations from Discord, and pushes
issue notifications back into Discord — without visiting the dashboard.

This service is **additive**. It talks only to Paperclip's public HTTP API (`PAPERCLIP_API_URL`)
and stores no state in Paperclip's own database — its only local state is a small JSON file mapping
Discord users to Paperclip users, which is bridge-owned, not a Paperclip schema change.

## Architecture decision: standalone service

The design doc's open question 2 asked whether this should live inside the Paperclip fork's
monorepo or as a standalone service. This repo (`test_ai_todo`) does not currently contain a
Paperclip fork — it contains the reference-only T3 Task Manager app. Since there is no
monorepo to live inside, and the design doc already leaned toward standalone ("matches the 'thin
adapter' framing and avoids coupling to Paperclip's internal build"), the bridge is built as an
independent Node/TypeScript project under `discord-bridge/`, deployable on its own, with zero
dependency on the rest of this repo.

## How linking works (and its limits)

Paperclip's agent-facing API has no self-serve OAuth/token-exchange flow for a board user to prove
"I am user X" to an external service. So for this MVP, linking is a lightweight shared-secret
model: a human runs `/link <paperclip-user-id>` in Discord, supplying their own Paperclip user id
(visible in their Paperclip profile/URL). The bridge verifies the id resolves (a bad id 404s/403s
on `GET /api/agents/me/inbox/mine`) and stores the mapping locally.

**This is intentionally not strong authentication** — anyone who knows another user's id could link
as them. It's acceptable for an internal-team MVP proving the collaboration model, but real
follow-up work should replace it with a proper linking flow (e.g. a one-time code the dashboard
shows the user, which they paste into Discord). Flagged as follow-up, not solved here.

## A real platform constraint discovered while building this

The ticket's spec assumed replies would be "attributed via `onBehalfOfUserId`" on the comment. That
does not work for an agent-authenticated caller: confirmed live against the running Paperclip API,
`POST /api/issues/:id/comments` with a client-supplied `onBehalfOfUserId` returns `422
issue_write_attribution_spoof_rejected` — *"onBehalfOfUserId is derived from the authenticated
actor, never from the request body — an agent cannot pick the human whose authority it rides."*
This is correct, deliberate anti-spoofing behavior, not a bug.

Consequence: comments posted through this bridge are attributed to the bridge's own Paperclip agent
identity (`authorAgentId`), not literally to the linked human. To keep provenance visible, the
bridge folds the human's identity into the comment body itself (see
`src/lib/handlers.ts#handleReply`): *"Via Discord, on behalf of \<discord name\> (Paperclip user
`<id>`): \<message\>"*. Real `authorUserId`/`onBehalfOfUserId` attribution would require either a
genuine per-user auth flow for the bridge to act with the user's own authority, or a Paperclip API
change for trusted service accounts — out of scope for this MVP (the ticket explicitly excludes
core schema/API changes). Flagged as a follow-up for whoever owns Paperclip's core API next.

## Approving/rejecting confirmations from chat

`POST /api/issues/:id/interactions/:id/accept|reject` is **board/user-only by default**
(`resolverPolicy: "board_only"`), and even a `board_or_agents` policy explicitly excludes the
*creator* agent from resolving its own card. Since this bridge is a different agent identity than
whichever agent creates a `request_confirmation`, the working pattern is: **the agent that creates
a confirmation intended to be resolvable from Discord should set
`resolverPolicy: "board_or_agents"`** when creating it. The bridge then resolves it via the normal
accept/reject routes, authenticated as its own agent identity. If a confirmation was created without
that policy, `/approve` and `/reject` surface a clear, actionable error instead of failing silently
(see the 403 branch in `resolveConfirmation` in `src/lib/handlers.ts`).

## Commands

| Command | Effect |
|---|---|
| `/link <paperclip_user_id>` | Link this Discord account to a Paperclip user |
| `/unlink` | Remove the link |
| `/plate` | List issues assigned to/owned by the linked user (their Mine inbox) |
| `/status <issue>` | Show an issue's status, priority, and latest comments |
| `/reply <issue> <message>` | Post a comment (see attribution note above) |
| `/approve <issue>` | Accept the latest pending `request_confirmation` |
| `/reject <issue> [reason]` | Reject the latest pending `request_confirmation` |
| `/create <title> [description]` | Create a new issue, assigned to the linked user |

## Inbound notifications

Paperclip has no outbound webhook a standalone service can subscribe to for issue events, so the
bridge polls (`POLL_INTERVAL_SECONDS`, default 30s). For each linked user it fetches their Mine
inbox and diffs against locally-stored watch state to detect status changes, new comments (from any
author), and newly-opened pending interactions, then posts into the Discord channel the user last
interacted in. The first poll after a link only establishes a baseline — it does not dump the
user's whole history into Discord.

**Known limitation:** because it polls the Mine inbox, an issue that leaves that list between polls
(e.g. archived) won't produce a final notification unless the change was caught on an earlier tick
while still listed. Acceptable for MVP; a real webhook/event source would remove this gap.

## Worked end-to-end example (scope item 4)

Verified against the live Paperclip API in `src/smokeTest.ts` (see "Testing" below): create an
issue as a linked user, `/plate` lists it, `/status` reads it, `/reply` comments on it, `/approve`
correctly reports nothing pending, then the issue is closed — all through the bridge's own command
handlers hitting the real API. What's **not** exercised by that script is the live Discord surface
itself (sending/receiving real Discord messages), because that requires a real Discord bot token
and a human clicking around a real Discord server — see "Setup" and "What's not verified" below.

## Setup

1. **Discord application** (needs a human — Discord requires interactive signup, an agent can't do
   this): create an app at the Discord Developer Portal, add a bot, copy the bot token and
   application (client) id, invite the bot to a server with the `applications.commands` and `bot`
   scopes (Send Messages, Read Message History).
2. **Paperclip credentials**: mint a long-lived API key for whichever Paperclip agent identity will
   own the bridge's calls: `POST /api/agents/:agentId/keys`. Never paste the returned key into a
   comment, document, or committed file — put it directly into `.env` (gitignored) or your
   deployment's secret store.
3. Copy `.env.example` to `.env` and fill in `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`,
   `PAPERCLIP_API_URL`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_KEY`.
4. `npm install && npm run register-commands && npm run dev`.

## Testing

- `npm test` — unit tests (Vitest) for every command handler against a mocked `PaperclipClient` and
  an in-memory link store. Covers linking, unlinking, all six chat commands, the not-linked path,
  the "nothing pending" path, and the board-only-403 explanation path. 19 tests, all passing.
- `npm run smoke-test` — live integration check against a real Paperclip API (no Discord token
  needed): creates a throwaway issue, links a test user, and drives `/plate`, `/status`, `/reply`,
  `/approve` through the real handlers, asserting on real API responses. Requires
  `PAPERCLIP_API_URL`/`PAPERCLIP_API_KEY`/`PAPERCLIP_COMPANY_ID`/`SMOKE_TEST_USER_ID` in the
  environment. Cleans up (`status: done`) after itself.

### What's not verified

Sending/receiving actual Discord messages — that needs a real bot token and a human present in a
Discord server, neither of which an agent can produce (Discord signup is interactive-human-only,
and there's no way to fabricate a second human to click "approve" in Discord). The command routing,
Discord.js wiring, and slash-command definitions are implemented and type-checked
(`src/commands/router.ts`, `src/commands/definitions.ts`, `src/index.ts`) but only exercised
indirectly (through the same handler functions the smoke test drives). Whoever supplies a bot token
should run `npm run register-commands && npm run dev` and walk the commands once in a real server
before calling this "done" end-to-end.
