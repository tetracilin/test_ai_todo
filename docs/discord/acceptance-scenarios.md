# Discord Integration — Acceptance Scenarios

Status: normative acceptance suite
Last updated: 2026-08-30

These scenarios verify public API behavior, durable state, and bridge outcomes. Each scenario names its contract endpoint and security/failure rule so backend, bridge, and QA workers can test independently.

## Traceability matrix

| ID | Required risk | Endpoint or mechanism | Contract | Rules |
|---|---|---|---|---|
| AC-DISCORD-01 | Unauthorized user attempts routing action | `PUT /api/integrations/discord/settings/channel-mappings` | [Contracts §4.4](./contracts.md#44-put-apiintegrationsdiscordsettingschannel-mappings-alias-put-apiintegrationsdiscordchannel-mappings) | [R-P2](./security-and-failure.md#12-permission-matrix) |
| AC-DISCORD-02 | Unauthorized bridge attempts action | `POST /api/integrations/discord/commands/task-create` | [Contracts §§4.0, 4.7](./contracts.md#40-authentication-model) | [R-S2, R-S3](./security-and-failure.md#3-secret-handling) |
| AC-DISCORD-03 | Unlinked user invokes slash command | `POST /api/integrations/discord/commands/task-create` | [Contracts §§2.4, 4.7](./contracts.md#24-error-responses-user-facing-by-error-code) | [R-P4](./security-and-failure.md#12-permission-matrix), [failure §4.5](./security-and-failure.md#45-unlinked-users) |
| AC-DISCORD-04 | Duplicate successful Discord interaction | `POST /api/integrations/discord/commands/task-create` | [Contracts §4.7](./contracts.md#47-post-apiintegrationsdiscordcommandstask-create) | [R-R1–R-R3](./security-and-failure.md#21-inbound-command-idempotency-discord--paperclip) |
| AC-DISCORD-05 | Duplicate in-flight/failed interaction | `POST /api/integrations/discord/commands/task-create` | [Contracts §4.7](./contracts.md#47-post-apiintegrationsdiscordcommandstask-create) | [R-R1](./security-and-failure.md#21-inbound-command-idempotency-discord--paperclip) |
| AC-DISCORD-06 | Duplicate outbound event/fan-out | outbox enqueue + delivery acknowledgement | [Contracts §§3.2–3.3, 4.9](./contracts.md#32-recipient-resolution-server-side-at-enqueue-time) | [R-R4–R-R6](./security-and-failure.md#22-outbound-delivery-idempotency-paperclip--discord) |
| AC-DISCORD-07 | Deleted channel during routing | pending poll + `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId` | [Contracts §§3.3, 4.8–4.9](./contracts.md#33-delivery-and-retry-contract) | [failure §4.3, R-F1–R-F3](./security-and-failure.md#43-deleted-or-unreachable-channels) |
| AC-DISCORD-08 | Failed DM, permanent | `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId` | [Contracts §§3.3, 4.9](./contracts.md#49-post-apiintegrationsdiscordeventseventiddeliveriesdeliveryid) | [failure §4.4, R-F2, R-F3](./security-and-failure.md#44-failed-dms) |
| AC-DISCORD-09 | Failed DM, retryable | `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId` | [Contracts §§3.3, 4.9](./contracts.md#49-post-apiintegrationsdiscordeventseventiddeliveriesdeliveryid) | [R-R7, failure §4.4](./security-and-failure.md#44-failed-dms) |
| AC-DISCORD-10 | Unlink disables future DM routing | `POST /api/integrations/discord/unlink` | [Contracts §§1.4, 4.6](./contracts.md#14-discord-user--paperclip-user-linking-and-unlink) | [failure §4.5, R-P6](./security-and-failure.md#45-unlinked-users) |

## Shared fixtures and observation points

Unless a scenario overrides them:

- Company `C1` has project `P1`.
- Guild `G1` channel `CH1` has an enabled mapping to `P1`, with `allowTaskCreate: true` and relevant notification events enabled.
- Paperclip user `U1` has active company membership in `C1`; Discord user `D1` has an active link to `U1`.
- Bridge requests carry a valid Bearer credential matching `PAPERCLIP_DISCORD_BRIDGE_TOKEN`.
- Database assertions cover `issues`, `discord_inbound_requests`, `integration_event_outbox`, `discord_delivery_attempts`, mappings, links, and preferences as named.
- “No write” means compared with a snapshot taken immediately before the When step.

## AC-DISCORD-01 — Non-admin cannot create or change channel routing

References: endpoint `PUT /api/integrations/discord/settings/channel-mappings`; contract §4.4; security rule R-P2.

Given:

- Board user `U2` has an authenticated session and active membership in `C1`.
- `U2` is not an instance admin.
- Request body names `C1`, `G1`, `CH1`, and `P1` and requests an enabled mapping.

When:

- `U2` calls `PUT /api/integrations/discord/settings/channel-mappings`.

Then:

- Response is `403` with error `Instance admin access required`.
- No `discord_project_channel_mappings` row is inserted or changed.
- No `discord_guild_integrations` row is inserted or changed.
- No project, link, preference, inbound-request, issue, outbox, or delivery state changes.

## AC-DISCORD-02 — Invalid or unconfigured bridge credential fails closed

References: endpoints protected by `assertBridge`, exercised through `POST /api/integrations/discord/commands/task-create`; contract §§4.0 and 4.7; security rules R-S2 and R-S3.

Given:

- A valid task-create payload names a new interaction id and otherwise satisfies mapping, link, and membership requirements.

When:

- Request is sent without `Authorization`, with a non-matching Bearer token, or while server `PAPERCLIP_DISCORD_BRIDGE_TOKEN` is blank.

Then:

- Missing/invalid credential returns `401` with `Discord bridge authentication required`.
- Blank server configuration returns `401` with `Discord bridge is not configured`.
- No inbound-request, issue, outbox, or delivery row is created.
- Logs and response bodies contain neither configured nor presented credential.

## AC-DISCORD-03 — Unlinked user invoking `/paperclip task create` is denied

References: endpoint `POST /api/integrations/discord/commands/task-create`; contract §§2.4 and 4.7; security rule R-P4 and failure rule §4.5.

Given:

- `G1`/`CH1` is enabled, mapped to `P1`, and allows task creation.
- Discord user `D2` has no active `discord_user_links` row in `C1`.
- Bridge sends a valid task-create request for interaction `I-UNLINKED-1` as `D2`.

When:

- Server handles the task-create request.

Then:

- Response is `403` with code `not_linked`.
- Bridge edits the deferred ephemeral reply to `Link your Paperclip account before creating tasks.`
- No issue, successful inbound-request, outbox event, or delivery attempt is created.
- Response reveals no company member, project-private, or existing-link details.

## AC-DISCORD-04 — Replayed successful interaction returns original issue

References: endpoint `POST /api/integrations/discord/commands/task-create`; contract §4.7; security rules R-R1, R-R2, and R-R3.

Given:

- First valid request with Discord interaction id `I-DUPE-1` succeeded.
- It created exactly one issue `ISSUE-1`, one succeeded inbound row keyed `I-DUPE-1`, and one Discord-origin `issue.created` outbox event keyed `discord:issue.created:ISSUE-1`.
- Snapshot row counts and issue fields after the first request.

When:

- Bridge repeats the same request with the same immutable Discord interaction id `I-DUPE-1`.

Then:

- Response is `200` with `duplicate: true`.
- Response issue id, identifier, title, and URL equal the first response.
- Bridge user-facing reply starts `Already created` and references the original issue.
- Issue count, inbound row count, outbox row count, and per-recipient delivery row counts remain unchanged from the snapshot.
- No issue-create idempotency key other than `discord:I-DUPE-1` is used.

## AC-DISCORD-05 — Replayed incomplete interaction conflicts instead of racing

References: endpoint `POST /api/integrations/discord/commands/task-create`; contract §4.7; security rule R-R1.

Given:

- `discord_inbound_requests` already contains interaction id `I-INFLIGHT-1` with no `issueId` and status `processing` or `failed`.
- No issue exists for that interaction.

When:

- Bridge submits a task-create request with `discordInteractionId: I-INFLIGHT-1`.

Then:

- Response is `409` with code `interaction_conflict`.
- No issue is created.
- Existing inbound row is not duplicated or replaced.
- No outbox or delivery row is created.

## AC-DISCORD-06 — Duplicate outbound enqueue and acknowledgement are idempotent

References: outbox enqueue, recipient fan-out, and `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId`; contract §§3.2–3.3 and 4.9; security rules R-R4, R-R5, and R-R6.

Given:

- Activity `A1` maps to event type `issue.completed`.
- Recipient resolution yields channel `CH1` and DM recipient `D1`.

When:

- Enqueue/fan-out runs twice for the same activity and event type.
- A delivered acknowledgement is then submitted twice for the same event/delivery pair.

Then:

- Exactly one outbox row exists with idempotency key `discord:activity:A1:issue.completed`.
- Exactly one delivery row exists for each unique recipient key `<eventId>:channel:CH1` and `<eventId>:dm:D1`.
- Repeated acknowledgement returns existing `delivered` state without incrementing `attempts`, changing message id, or resetting status.
- No duplicate Discord send is scheduled from terminal state.

## AC-DISCORD-07 — Deleted channel becomes terminal without blocking source action

References: `GET /api/integrations/discord/deliveries/pending` and `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId`; contract §§3.3, 4.8, and 4.9; failure rule §4.3 and R-F1–R-F3.

Given:

- A source issue action has committed successfully and produced a pending channel delivery for `CH-DELETED`.
- Discord channel fetch/send reports missing or non-sendable channel as HTTP `404`.

When:

- Bridge polls the pending delivery and attempts to send it.

Then:

- Bridge submits acknowledgement outcome `terminal_failure`, not `retryable_failure`.
- Server persists delivery status `terminal_failure`, increments `attempts` once for the state-changing acknowledgement, and records a bounded error code without message body.
- Later pending polls do not return that delivery.
- Source issue and activity remain committed and unchanged.
- Another delivery in the same poll batch is still attempted.

## AC-DISCORD-08 — Permanently failed DM is terminal and isolated

References: endpoint `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId`; contract §§3.3 and 4.9; failure rule §4.4 and R-F2–R-F3.

Given:

- One outbox event has independent pending deliveries to DM user `D-BLOCKED` and channel `CH1`.
- Discord returns `403` or another non-429 4xx from `user.send` for `D-BLOCKED`.

When:

- Bridge processes both deliveries.

Then:

- DM acknowledgement outcome is `terminal_failure`.
- DM delivery persists as `terminal_failure` and is absent from later pending polls.
- Channel delivery is still attempted and may reach `delivered` independently.
- No DM message body, raw event payload, or user token appears in logs.

## AC-DISCORD-09 — Rate-limited or transient DM is rescheduled

References: endpoint `POST /api/integrations/discord/events/:eventId/deliveries/:deliveryId`; contract §§3.3 and 4.9; security rule R-R7 and failure rule §4.4.

Given:

- A pending DM delivery has `attempts = n`.
- Freeze server time at `T0`.
- Discord returns `429` with `retryAfterSeconds = r`, or returns a network/5xx error without retry guidance.

When:

- Bridge acknowledges `retryable_failure`.

Then:

- Delivery status remains `pending` and `attempts` becomes `n + 1`.
- With retry guidance, `nextAttemptAt = T0 + max(1, r)` seconds.
- Without retry guidance, `nextAttemptAt = T0 + max(1, min(3600, 2^min(n+1, 10)))` seconds, using the server contract’s pre-increment `attempts` value.
- Pending poll excludes the delivery before `nextAttemptAt` and includes it at or after `nextAttemptAt`.
- Source issue, activity, and sibling deliveries remain unaffected.

## AC-DISCORD-10 — Unlink disables preferences and future DM fan-out

References: endpoint `POST /api/integrations/discord/unlink`; contract §§1.4 and 4.6; security rule R-P6 and failure rule §4.5.

Given:

- `D1` has an active link to `U1` in `C1`.
- `U1` has one or more enabled Discord notification preferences.

When:

- Bridge calls `POST /api/integrations/discord/unlink` with `discordUserId: D1` twice.

Then:

- Both calls return `200 { "status": "unlinked" }`.
- Link is inactive and has `unlinkedAt` set.
- All Discord notification preferences for `U1` in `C1` are disabled.
- Recipient resolution for later events creates no DM delivery for `D1`.
- A later task-create request from `D1` satisfies AC-DISCORD-03 and returns `403 not_linked` until relinked.

## Exit criteria

Acceptance passes only when:

- Every scenario asserts HTTP/bridge behavior and named durable-state invariants.
- Required risks are covered: unauthorized action, duplicate Discord interaction/event, deleted channel, failed DM, and unlinked slash-command user.
- Tests use endpoint paths and rule identifiers from the traceability matrix.
- No scenario relies on a live Discord tenant, unstable row order, or sleep-based retry timing.
- Test output contains no secret, raw command body, or unredacted domain record.
