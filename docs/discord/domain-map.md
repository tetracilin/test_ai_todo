# Discord Integration — Domain Map

Status: factual baseline (as-built, not design intent)
Baseline commit: `8fea5a31dc48d555b2bb653a7cc96674ec290d89` (branch `integration/paperclip` lineage)
Last updated: 2026-08-30
Scope: task/issue, project, user, auth, workspace, and notification domains; where Discord linking/mapping state attaches; existing notification event types and service boundaries.

This document records the current Paperclip data model and service boundaries that a Discord integration builds on. The Discord integration itself is already implemented: durable schema lives in migration `0231_discord_integration_authority.sql` (package `@paperclipai/db`), server authority lives in `server/src/routes/discord-integrations.ts` and `server/src/services/activity-log.ts`, and transport lives in the standalone `discord-bridge/` package.

---

## 1. Tenant and identity domains

### 1.1 Company (tenant container)

Table `companies` (`packages/db/src/schema/companies.ts`):

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | tenant boundary for every domain below |
| `name`, `description` | text | |
| `status` | text | `active`, … |
| `pauseReason`, `pausedAt` | text/timestamp | |
| `issuePrefix` | text | e.g. `PAP`; **unique** |
| `issueCounter` | integer | per-company issue numbering |
| `budgetMonthlyCents`, `spentMonthlyCents` | integer | |
| `attachmentMaxBytes` | integer | default 10 MiB |
| `defaultResponsibleUserId` | text | fallback responsible user for activity attribution |
| `interactionResolverGovernance` | jsonb | |
| feedback sharing fields | boolean/timestamps/text | consent state |

The company is the multi-tenant root object. Every Discord mapping, link, preference, outbox event, and delivery record is scoped by `company_id`.

### 1.2 Users and auth

Tables in `packages/db/src/schema/auth.ts` — Better Auth standard shape:

- `user` (`authUsers`): `id` (**text** PK), `name`, `email`, `emailVerified`, `image`, timestamps.
- `session`: `id`, `expiresAt`, `token`, `ipAddress`, `userAgent`, `userId` → `user.id` (cascade).
- `account`: OAuth/provider accounts (`providerId`, `accountId`, tokens, `password` for credentials).
- `verification`: one-time verification records.

Key fact: **Paperclip user identity is the text `user.id` from the auth `user` table.** Issue fields such as `assigneeUserId`, `createdByUserId`, `responsibleUserId`, and the Discord link table's `user_id` all store this text id. There is no separate users table; the auth `user` table is the user domain.

### 1.3 Membership and roles

- `company_memberships` (`company_memberships.ts`): `companyId` + `principalType` (`user`|`agent`) + `principalId` (text) + `status` (`pending`|`active`|`suspended`|`archived`) + `membershipRole`. Unique `(companyId, principalType, principalId)`.
- `project_memberships` (`project_memberships.ts`): `companyId`, `projectId` → projects, `userId` (text), `state` (`joined`), `starredAt`. Unique `(companyId, userId, projectId)`.
- `instance_user_roles` (`instance_user_roles.ts`): `userId` + `role` (default `instance_admin`). Unique `(userId, role)`.
- `invites`, `join_requests`, `instance_settings`: onboarding/joining state.

Authz helpers used by the Discord routes: `assertCompanyAccess` (membership check) and `assertInstanceAdmin` (channel-mapping writes require an instance admin); the bridge itself authenticates with a shared token (`PAPERCLIP_DISCORD_BRIDGE_TOKEN`, Bearer, constant-time compare).

## 2. Task/issue domain

### 2.1 `issues` (`packages/db/src/schema/issues.ts`)

The task domain is the **issue** domain (Paperclip models tasks as issues; there is no separate `tasks` table).

Identity and placement:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `companyId` | uuid → companies | required |
| `projectId` | uuid → projects | nullable (must be set for Discord mapping delivery) |
| `projectWorkspaceId` | uuid → project_workspaces | on delete set null |
| `goalId`, `parentId` | uuid | parent is self-FK (sub-tasks) |
| `issueNumber` | integer, `identifier` | text; unique index; Dashboard URL uses `identifier` |
| `title` (not null), `description` | text | |
| `status` | text, default `backlog` | lifecycle: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled` (blocked/done drive Discord block/unblock/completed events) |
| `workMode`, `harnessKind`, `priority` | text | priority: `critical`|`high`|`medium`|`low` (`ISSUE_PRIORITIES`) |
| `reviewPolicy` | text (IssueReviewPolicy) | |
| `assigneeAgentId` | uuid → agents | agent assignee |
| `assigneeUserId` | text | **human assignee = auth user id** |
| `responsibleUserId` | text | human responsible for activity attribution |
| `createdByAgentId` / `createdByUserId` | uuid / text | |

Execution/monitoring: `checkoutRunId`, `executionRunId`, `executionAgentNameKey`, `executionLockedAt`, `monitorNextCheckAt`, `monitorWakeRequestedAt`, `monitorAttemptCount`, `monitorNotes`, `executionWorkspaceId`/`Preference`/`Settings`, `blockedTransitionAt`, `blockedOwnerNotifiedAt`.

Origin tracking (used by Discord idempotency): `originKind` (default `manual`; `discord`, `routine_execution`, `task_watchdog`, `issue_productivity_review`, `stranded_issue_recovery`, `harness_liveness_escalation`, `onboarding_first_task`, …), `originId`, `originRunId`, `originFingerprint` (`not null default 'default'`), `requestDepth`.

Timing: `startedAt`, `completedAt`, `cancelledAt`, `hiddenAt`, `createdAt`, `updatedAt`. Progress: `progress` (0–100 manual for leaves; parents aggregate), `sortOrder`.

Satellite issue tables referenced by activity / notifications: `issue_comments`, `issue_documents`, `issue_relations`, `issue_labels`, `issue_attachments`, `issue_approvals`, `issue_watchdogs`, `issue_recovery_actions`, `issue_read_states`, `issue_inbox_archives`, `issue_scheduling`, `issue_thread_interactions`, `issue_plan_decompositions`, `issue_execution_decisions`, `issue_reference_mentions`, `issue_create_idempotency_keys` (the last is the source of the `discord:<interactionId>` idempotency pattern used by task-create).

## 3. Project and workspace domains

### 3.1 `projects` (`projects.ts`)

`id` uuid PK, `companyId`, `goalId`, `name` (not null), `description`, `status` (default `backlog`), `leadAgentId`, `targetDate`, `color`, `icon`, `env` jsonb, `pauseReason`/`pausedAt`, `executionWorkspacePolicy` jsonb, `archivedAt`, timestamps. Unique `(companyId, id)`.

The **project is the collaboration/subscription unit that the Discord integration maps channels to** (see `discord_project_channel_mappings.project_id`).

### 3.2 Workspace modeling — and where a workspace↔guild mapping would attach

Paperclip has two workspace layers, both **execution infrastructure, not collaboration containers**:

- `project_workspaces` (`project_workspaces.ts`) — durable *definitions*: `companyId`, `projectId` (cascade), `name`, `sourceType` (`local_path` default), `cwd`, `repoUrl`, `repoRef`, `defaultRef`, `visibility`, `setupCommand`/`cleanupCommand`, `remoteProvider`/`remoteWorkspaceRef`, `sharedWorkspaceKey`, `metadata`, `isPrimary`.
- `execution_workspaces` (`execution_workspaces.ts`) — per-run *runtime* state: `projectId`, `projectWorkspaceId`, `sourceIssueId`, `mode`, `strategyType`, `status` (`active` …), `cwd`, `repoUrl`, `baseRef`, `branchName`, `providerType`/`providerRef`, `derivedFromExecutionWorkspaceId`, lifecycle timestamps (`openedAt`, `closedAt`, `cleanupEligibleAt`, `cleanupReason`).

Plus operational tables `workspace_operations` and `workspace_runtime_services`.

Integration seam note: Paperclip "workspace" ≠ Discord "guild/server". The analogous container is **company → project**. The as-built design therefore attaches:

- guild ↔ company: `discord_guild_integrations` (`company_id` FK, unique `(company_id, guild_id)`).
- channel ↔ project: `discord_project_channel_mappings` (`project_id` FK).
- A hypothetical workspace-level mapping (channel ⇄ one `project_workspaces` row) would attach via a new `project_workspace_id` FK on a mapping table; nothing currently models that, and issues created from Discord are always placed at `project_id` scope, never at workspace scope. Document this as a deliberate non-goal of the current design.

## 4. Notification domain

### 4.1 `activity_log` (`activity_log.ts`) — the source of truth for domain events

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `companyId` | uuid → companies | |
| `actorType` | text | `agent` \| `user` \| `system` \| `plugin` |
| `actorId` | text | actor principal id |
| `action` | text | free-form action string, e.g. `issue.created`, `issue.updated`, `issue.comment.created`, `issue_comment_added`, `approval_approved` |
| `entityType` / `entityId` | text | for issues: `issue` / issue uuid |
| `agentId`, `runId` | uuid | optional correlation |
| `responsibleUserId` | text | resolved by `resolveResponsibleUserIdForActivity` (override → actor user → run → issue → api key → company default) |
| `details` | jsonb | redacted change details; `_previous` carries the before-state used for status/assignee/priority diffs |
| `createdAt` | timestamp | |

Indexes: `(company_id, created_at)`, `(company_id, agent_id, created_at)`, `(company_id, responsible_user_id, created_at)`, `(run_id)`, `(entity_type, entity_id)`.

### 4.2 Event types that exist today

**Live (realtime UI) events** — `LIVE_EVENT_TYPES` (`packages/shared/src/constants.ts`):

`heartbeat.run.queued`, `heartbeat.run.status`, `heartbeat.run.progress`, `heartbeat.run.event`, `heartbeat.run.log`, `agent.status`, `activity.logged`, `external_object.updated`, `plugin.ui.updated`, `plugin.worker.crashed`, `plugin.worker.restarted`.

**Plugin domain events** — `PLUGIN_EVENT_TYPES` (same file, 33 types): `company.created/updated`, `project.created/updated`, `project.workspace_created/updated/deleted`, `issue.created`, `issue.updated`, `issue.comment.created`, `issue.document.created/updated/deleted`, `issue.relations.updated`, `issue.checked_out`, `issue.released`, `issue.assignment_wakeup_requested`, `agent.created/updated/status_changed/error_cleared`, `agent.run.started/finished/failed/cancelled`, `goal.created/updated`, `approval.created/decided`, `budget.incident.opened/resolved`, `cost_event.created`, `activity.logged`.

Activity action → plugin event mapping lives in `ACTIVITY_ACTION_TO_PLUGIN_EVENT` in `server/src/services/activity-log.ts` (e.g. `issue_comment_added` → `issue.comment.created`, `approval_approved` → `approval.decided`, `budget_soft_threshold_crossed` → `budget.incident.opened`).

**Discord notification events** — the closed enum `DISCORD_NOTIFICATION_EVENTS` (defined in `server/src/routes/discord-integrations.ts`, echoed in the bridge client types):

| Event | Produced from activity when… |
|---|---|
| `issue.created` | action `issue.created` |
| `issue.status_changed` | `issue.updated` with `status` in details (not blocked/done) |
| `issue.assignee_changed` | `issue.updated` with `assigneeAgentId`/`assigneeUserId` in details |
| `issue.priority_changed` | `issue.updated` with `priority` in details |
| `issue.comment_created` | `issue.comment.created` / `issue_comment_added` / `issue_comment_created` |
| `issue.blocked` | `issue.updated` with new status `blocked` |
| `issue.unblocked` | `issue.updated` where previous status was `blocked` |
| `issue.completed` | `issue.updated` with new status `done` |

Mapping logic is `discordEventTypesForActivity()` in `activity-log.ts`: only `entityType === "issue"` actions produce events; the `details` `_previous` object distinguishes unblocked from other status changes.

## 5. Discord integration domain (as-built schema)

All tables in `packages/db/src/schema/discord_integrations.ts`, migrated in `0231_discord_integration_authority.sql`. Company-scoped everywhere.

### 5.1 Guild and channel mapping (workspace-to-Discord attachment points)

`discord_guild_integrations` — company ↔ guild enablement:

`id` uuid PK, `companyId` → companies (cascade), `guildId` text (not null), `enabled` bool default true, `createdByUserId`, timestamps. Unique `(company_id, guild_id)`.

`discord_project_channel_mappings` — channel ↔ project binding + routing policy:

`id`, `companyId` → companies (cascade), `guildId`, `channelId`, `projectId` → projects (cascade), `enabled` bool default true, `allowTaskCreate` bool default false, `notificationEvents` jsonb `string[]` (default `[]`; subset of `DISCORD_NOTIFICATION_EVENTS`), `createdByUserId`, timestamps. Unique `(guild_id, channel_id)`; index `(company_id, project_id)`.

### 5.2 Discord user ↔ Paperclip user linking

`discord_user_links` — the **Discord-user-to-Paperclip-user mapping**:

`id`, `companyId` → companies (cascade), `userId` text (**auth `user.id`**, no FK — consistent with all user fields), `discordUserId` text, `isPrimary` bool default true, `active` bool default true, `linkedAt`, `unlinkedAt`, timestamps. Unique `(company_id, discord_user_id)`; index `(company_id, user_id)`. One Discord account may hold at most one active link per company; relinking after unlink clears `unlinkedAt`.

`discord_link_codes` — single-use one-time-code linking (server stores only SHA-256 `codeHash`):

`id`, `companyId` (cascade), `userId`, `codeHash` text, `expiresAt` (10 minutes), `consumedAt`, `createdAt`. Unique `code_hash`; index `(company_id, user_id)`. Consumed atomically in a transaction against `discord_user_links`.

### 5.3 Notification preferences

`discord_notification_preferences` — per-user per-event opt-in:

`id`, `companyId` (cascade), `userId`, `eventType` text (from `DISCORD_NOTIFICATION_EVENTS`), `enabled` bool default **false** (opt-in), `deliveryMode` text default `dm` (`dm`|`channel`), `channelId` text (required when mode=channel; must reference an enabled channel mapping — enforced at write), `updatedAt`. Unique `(company_id, user_id, event_type)`.

### 5.4 Outbox and delivery (durable notification flow)

`integration_event_outbox` — event log for cross-system fan-out:

`id`, `idempotencyKey` text (unique; pattern `discord:activity:<activityId>:<eventType>` or `discord:issue.created:<issueId>`), `companyId` (cascade), `projectId` → projects (set null), `issueId` → issues (set null), `eventType` text, `origin` text (`paperclip` for server-side events, `discord` for bridge-side task-creates), `originDiscordChannelId` text (echo-suppression), `payload` jsonb (redacted allowlisted fields only: `issueIdentifier`, `title`, `issueUrl`, `actor`, `before`, `after`), `occurredAt`, `createdAt`. Index `(company_id, project_id, created_at)`.

`discord_delivery_attempts` — one row per recipient per event:

`id`, `eventId` → outbox (cascade), `recipientType` (`channel`|`dm`), `recipientId` (Discord channel id or Discord user id), `idempotencyKey` (unique; `event.id:recipientType:recipientId`), `status` (`pending`|`delivered`|`suppressed`|`terminal_failure`), `attempts` integer, `nextAttemptAt`, `discordMessageId`, `errorCode`, timestamps. Unique `(event_id, recipient_type, recipient_id)`; index `(status, next_attempt_at)` for the pending poll.

`discord_inbound_requests` — audit/idempotency for bridge commands:

`id`, `discordInteractionId` (unique), `discordUserId`, `guildId`, `channelId`, `commandName`, `companyId` (nullable until resolved), `issueId` → issues (set null), `status` (`processing`|`succeeded`|`failed`), `errorCode`, timestamps.

## 6. Service boundaries

### 6.1 Server (Paperclip API) — owns all authority and state

| File | Responsibility |
|---|---|
| `server/src/routes/discord-integrations.ts` | All `/api/integrations/discord/*` endpoints: settings read, link-code issue/consume, preferences upsert, channel-mapping upsert (instance-admin gated), unlink, `commands/task-create` (bridge-token gated), pending-deliveries poll, delivery acknowledgement. Defines `DISCORD_NOTIFICATION_EVENTS` and all zod contracts. |
| `server/src/services/activity-log.ts` | `persistActivity` writes `activity_log`, then `enqueueDiscordNotifications` derives Discord event types, resolves recipients (channel mappings + user preferences joined to active user links), writes outbox events and delivery attempts **in the same request**; failures only log a warning (never block the source action). Also bridges activity → plugin events and live events. |
| `server/src/routes/authz.ts` | `assertCompanyAccess`, `assertInstanceAdmin`; bridge calls checked by `assertBridge` (Bearer `PAPERCLIP_DISCORD_BRIDGE_TOKEN`, `timingSafeEqual`). |
| `packages/db` | Schema + migration `0231`; drizzle `Db` type. |
| `server/src/app.ts:552` | `api.use(discordIntegrationRoutes(db))` — mounted under `/api`. |

Authorization rules implemented today:

- Browser (board) users: must have an active membership (`assertCompanyAccess`); channel-mapping writes require `assertInstanceAdmin`.
- Bridge (bot): Bearer token; token unset ⇒ endpoint reports "Discord bridge is not configured" (401).
- Task-create: channel must be mapped + enabled, `allowTaskCreate` true, Discord user must be actively linked, linked Paperclip user must hold an active company membership (`principalType: "user"`), and the project must belong to the mapping's company.
- Notification recipients: channel recipients come from enabled mappings whose `notificationEvents` include the event type; DM recipients come from enabled preferences (mode `dm`) joined to active user links. Channel-mode preferences are rejected at write time if the channel is not an enabled mapping.

### 6.2 discord-bridge (standalone bot) — transport only; holds zero state

| File | Responsibility |
|---|---|
| `discord-bridge/src/index.ts` | discord.js client with **only `Guilds` intent** (no message-content / privileged intents); connects, registers `InteractionCreate` handler, starts the delivery worker. |
| `discord-bridge/src/commands/definitions.ts` | Slash-command registration payload (`/paperclip task create title description priority`). |
| `discord-bridge/src/commands/router.ts` | Routes interactions to `createTaskFromDiscord`; ephemeral replies; logs only interaction id, never command bodies. |
| `discord-bridge/src/lib/taskCreate.ts` | Client of `POST /api/integrations/discord/commands/task-create`; surfaces `duplicate: true`. |
| `discord-bridge/src/lib/discordIntegrationClient.ts` | Typed HTTP client + shared interfaces (`DiscordNotificationEvent`, `DiscordDelivery`, acknowledgements). |
| `discord-bridge/src/lib/notifier.ts` | Polls `GET /api/integrations/discord/deliveries/pending`, formats allowlisted fields only, sends via Discord API with mentions disabled, acknowledges `delivered`/`suppressed`/`retryable_failure`/`terminal_failure`. 4xx (non-429) terminal, 429/network retryable with exponential backoff (server schedules `nextAttemptAt`). |
| `discord-bridge/src/registerCommands.ts` | One-time slash-command registration (dev-guild scoped when `DISCORD_DEV_GUILD_ID` set). |

`discord-bridge/README.md` is the operational contract: "Bridge owns Discord transport. Paperclip integration API owns link state, channel mappings, authorization, idempotency, issues, event outbox, leases, retries, and delivery acknowledgement state."

## 7. Event flows

### 7.1 Outbound (Domain → Discord)

1. Any issue domain action calls `logActivity` (`persistActivity`).
2. `activity_log` row inserted; details redacted (`sanitizeRecord` + username censor).
3. `enqueueDiscordNotifications`: `discordEventTypesForActivity` maps the action (+`details`/`_previous`) → 0..n `DiscordEventType`s. Non-issue entities produce none.
4. For each event type: upsert `integration_event_outbox` (idempotency `discord:activity:<activityId>:<eventType>`); then compute recipients (channel mappings with the event in `notificationEvents`; enabled user preferences joined to active links) and insert `discord_delivery_attempts` rows (idempotency `event.id:type:recipientId`).
5. Enqueue failure only logs a warning — the source action is never blocked.
6. Bridge delivery worker polls pending (`status=pending`, `next_attempt_at <= now`); suppresses echo (see 7.3); sends DM (`user.send`) or channel message (`channel.send`) with `allowedMentions: {parse: []}`; acknowledges outcome.
7. Acknowledgement: `delivered` (+ `discordMessageId`), `suppressed`, `retryable_failure` (server re-schedules with `max(1, retryAfterSeconds ?? 2^attempts capped 3600)`), or `terminal_failure` (permanent 4xx).

### 7.2 Inbound (Discord → Domain)

1. `/paperclip task create` interaction → bridge `router.ts` → `taskCreate.ts` → `POST /api/integrations/discord/commands/task-create` with immutable interaction/user/guild/channel ids + typed options.
2. Server: idempotency check on `discord_inbound_requests.discordInteractionId` (previous success returns the existing issue with `duplicate: true`); channel-mapping + guild-integration + `allowTaskCreate` + user-link + membership checks; inserts `discord_inbound_requests` row (`processing`).
3. `issueService.create` with `idempotencyKey: discord:<interactionId>`, `originKind: "discord"`, `originId: interactionId`, `createdByUserId: linked auth user id`, project from mapping.
4. Outbox event `issue.created` with `origin: "discord"` and `originDiscordChannelId`; `discord_inbound_requests` → `succeeded` (issueId set).
5. Delivery attempts are created for **other** channels of the same project that opted into `issue.created` (the source channel is excluded; see echo suppression).

### 7.3 Echo suppression

`shouldSuppress()` in `notifier.ts`: an `issue.created` event with `origin === "discord"` whose channel recipient equals `originDiscordChannelId` is acknowledged `suppressed` instead of sent, so a task created via Discord is not announced back into the same channel.

## 8. Integration seams — where Discord state attaches

| Paperclip entity | Attachment table | Key |
|---|---|---|
| company (tenant) | `discord_guild_integrations` | `company_id` FK (cascade) |
| project | `discord_project_channel_mappings` | `project_id` FK (cascade) |
| auth user (`user.id`, text) | `discord_user_links`, `discord_link_codes`, `discord_notification_preferences` | `user_id` text (no FK, company-scoped) |
| issue | `integration_event_outbox.issue_id`, `discord_inbound_requests.issue_id` | FK, set null on delete |
| activity record | `integration_event_outbox.idempotency_key` = `discord:activity:<activityId>:<eventType>` | implicit correlation |
| project workspace (definition) | none today — a hypothetical workspace↔channel mapping would add `project_workspace_id` FK to a mapping table | not modeled by design |
| Discord guild | `discord_guild_integrations.guild_id`, `discord_project_channel_mappings.guild_id` | text ids, company-scoped |
| Discord channel | `discord_project_channel_mappings.channel_id`, `discord_notification_preferences.channel_id` | text ids, unique per guild |
| Discord user | `discord_user_links.discord_user_id`, `discord_delivery_attempts.recipient_id` (type `dm`) | text ids |

## 9. Open notes / non-goals (as-built)

- Guild↔workspace (`project_workspaces`) mapping is deliberately not modeled; mapping is at project scope.
- Discord user ↔ Paperclip user linking is one active link per (company, discord account); no cross-company or multi-account semantics beyond `is_primary`.
- Inbound surface today is task-create only; other commands/events would extend `discordInboundRequests.commandName` and the router.
- Delivery is poll-based (bridge polls `deliveries/pending`), not push/webhook; retries are server-scheduled.
- Server stores only SHA-256 hashes of link codes; bridge never logs command bodies or credentials.