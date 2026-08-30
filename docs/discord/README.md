# Discord Integration — Implementation Notes

Status: implementation and verification index
Last updated: 2026-08-30
Baseline lineage: `8fea5a31dc48d555b2bb653a7cc96674ec290d89`

These notes define the as-built Discord integration boundary and the contract for changing or independently verifying it. Paperclip server owns authority and durable state; `discord-bridge` owns Discord transport only.

## Document set

Read in this order:

1. [Domain map](./domain-map.md) — factual inventory of tenant, identity, issue, project, workspace, notification, and Discord persistence domains; current service boundaries and event flows.
2. [API, payload, and database contracts](./contracts.md) — normative installation, linking, slash-command, notification, endpoint, schema, retry, and environment contracts.
3. [Security and failure handling](./security-and-failure.md) — normative permission, replay protection, secret handling, transport trust, and failure-classification rules.
4. [Acceptance scenarios](./acceptance-scenarios.md) — executable Given/When/Then checks, with endpoint and rule traceability.

Use the domain map to understand what exists. Use the contracts and security rules to implement behavior. Use the acceptance scenarios to verify observable API effects, Discord transport outcomes, and durable database state. When documents disagree with executable behavior, treat that as a defect to resolve rather than silently weakening a normative rule.

## System boundary at a glance

| Concern | Owner | Primary implementation |
|---|---|---|
| Company/guild and project/channel authority | Paperclip server | `server/src/routes/discord-integrations.ts` |
| User links, link codes, preferences, command authorization | Paperclip server | `server/src/routes/discord-integrations.ts` |
| Issue activity to notification event derivation | Paperclip server | `server/src/services/activity-log.ts` |
| Durable replay protection, outbox, delivery attempts | Paperclip server + database | `packages/db/src/schema/discord_integrations.ts`, migration `0231_discord_integration_authority.sql` |
| Gateway connection, slash-command registration, message send/DM | Discord bridge | `discord-bridge/src/` |
| Board-user and instance-admin authorization | Paperclip server | `server/src/routes/authz.ts` |

Paperclip “tasks” are `issues`. Discord guilds attach to companies; Discord channels attach to projects. `project_workspaces` and `execution_workspaces` are execution infrastructure and are deliberately outside Discord mapping scope.

## Core invariants

- Bridge uses the authenticated Discord Gateway with only the `Guilds` intent. Current design has no inbound HTTP interactions endpoint and therefore no as-built Ed25519 request-signature boundary.
- Bridge-to-Paperclip calls fail closed unless `PAPERCLIP_DISCORD_BRIDGE_TOKEN` matches the bridge credential by constant-time comparison.
- Discord user identity never grants Paperclip authority by itself. Task creation requires an active user link and active company membership.
- Channel mapping writes require company access plus instance-admin access. `allowTaskCreate` defaults to `false`.
- Inbound interaction, outbox event, and per-recipient delivery each have independent unique idempotency keys.
- Notification preferences default off. DM recipient resolution requires an enabled preference and active user link.
- Discord 4xx failures except 429 are terminal. Discord 429, 5xx, and network failures are retryable with server-scheduled backoff.
- Notification failure never rolls back the source issue or activity action.
- Secrets, command bodies, raw domain records, and mention expansion never reach logs or Discord messages.

Normative rule identifiers (`R-P*`, `R-R*`, `R-S*`, `R-F*`) are defined in [security-and-failure.md](./security-and-failure.md). Endpoint payloads and response codes are defined in [contracts.md](./contracts.md).

## Implementation lookup

| Change or test | Read first | Acceptance coverage |
|---|---|---|
| Guild/channel setup and permissions | Contracts §§1.2, 4.4; security rules R-P2, R-P3 | AC-DISCORD-01, AC-DISCORD-02 |
| Account linking/unlinking | Contracts §§1.4, 4.2, 4.5, 4.6; rules R-P4, R-R8 | AC-DISCORD-03, AC-DISCORD-10 |
| `/paperclip task create` | Contracts §§2, 4.7; rules R-P3, R-P4, R-R1–R-R3 | AC-DISCORD-02 through AC-DISCORD-05 |
| Outbox and recipient fan-out | Contracts §§3, 4.8, DB deltas D7–D8; rules R-R4–R-R7 | AC-DISCORD-06, AC-DISCORD-07 |
| Channel/DM delivery errors | Contracts §§3.3, 4.9; rules R-R7, R-F1–R-F4 | AC-DISCORD-07 through AC-DISCORD-09 |
| Transport or secret changes | Contracts §8; security trust model and R-S1–R-S8 | AC-DISCORD-02 |
| HTTP interactions transport (future only) | Security §5 | Add signature, freshness-window, and PING/PONG acceptance coverage before shipping |

## Verification conventions

Acceptance checks should observe all three layers where applicable:

1. HTTP result: status and stable `code`/payload.
2. Durable state: issue, inbound-request, outbox, and delivery row counts/statuses.
3. Transport result: ephemeral command reply, Discord send classification, and acknowledgement payload.

Use unique fixture snowflakes, interaction ids, company ids, and project ids per scenario. Assert state by idempotency key rather than timing or row order. Freeze time when checking link-code expiry or retry scheduling. Stub Discord REST/Gateway sends at the bridge boundary; do not require a live guild for deterministic contract tests.

## Maintenance rules

- Keep endpoint names and response codes in acceptance scenarios synchronized with `server/src/routes/discord-integrations.ts`.
- Add a new numbered migration for schema changes; never edit released migration `0231` in place.
- Add acceptance coverage for every new command, event type, delivery outcome, or permission branch.
- Preserve service ownership: bridge remains stateless transport and never chooses Paperclip company, project, or user identity.
- Keep all Discord credentials server-side. Never add real values to docs, fixtures, snapshots, or `.env.example`.
