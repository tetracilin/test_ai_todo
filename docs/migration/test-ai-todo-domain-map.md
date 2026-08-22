# Test AI Todo Domain and Schema Map

Status: owner-approved K6 architecture decision

Approved after human gate unblock: 2026-08-22T05:44:25Z

Inputs:

- Preserved legacy application tag at `9650b7dbd112d6c92ae56b81df391d5422ff0bd3`
- Canonical Paperclip baseline: `b73d7a7319437860851c177c214c6e96fcaa76f7`
- Approved scheduling delta: `2d73e7a26408c788f7dceecdcf17e144e04aa627`
- Approved provider-removal inventory: K4 commit `36ea27e0becbce5c827497445537d213a260f46e`

## Decision

Paperclip remains the sole domain model. Legacy collections are migration inputs, not schemas to reproduce. Core records enter existing company-scoped Paperclip tables and APIs. Only two scheduling extensions are retained: `issue_scheduling` for optional issue timing and `scheduling_routines` for personal recurring issue templates.

Do not create `tasks`, `work_packages`, `persons`, `tags`, `logs`, `legacy_projects`, `legacy_decisions`, or `legacy_approvals` tables. Do not store a second legacy object blob as an operational source of truth. Preserve only supported semantics in canonical rows, comments, documents, assets, labels, and activity entries; archive the original export outside the live application for audit.

## Ownership boundaries

| Concern | Owner | Canonical table(s) | Canonical API route(s) | Rule |
| --- | --- | --- | --- | --- |
| Work | Issue service | `issues`, `issue_relations`, `issue_documents`, `documents`, `issue_comments`, `issue_attachments`, `assets` | `GET/POST /api/companies/:companyId/issues`, `GET/PATCH /api/issues/:issueId`, issue comments/documents/attachments routes | Every task-like record becomes an issue. Hierarchy uses `parent_id`; dependency uses `issue_relations`. |
| Projects | Project service | `projects` | `GET/POST /api/companies/:companyId/projects`, `GET/PATCH /api/projects/:projectId` | One canonical project per legacy project; issues reference it by `project_id`. |
| People and access | Authentication/access services | `user`, `company_memberships`; `agents` only for actual AI agents | `/api/auth/get-session`, `/api/auth/profile`, `/api/companies`; invitation/onboarding access flow | A human never becomes an agent merely because legacy data called them a Person. Membership controls company access. |
| Labels | Issue service | `labels`, `issue_labels` | `GET/POST /api/companies/:companyId/labels`, `DELETE /api/labels/:labelId`; issue create/update routes accept label IDs | Legacy tags become company-scoped labels and issue-label links. |
| Audit and narrative history | Activity and issue services | `activity_log`, `issue_comments` | `GET /api/companies/:companyId/activity`, `POST /api/issues/:issueId/comments` | Structured mutations use append-only activity; human-readable task history uses comments. |
| Approvals | Approval service | `approvals`, `issue_approvals`, `approval_comments` | company approval CRUD/resolve routes and `/api/approvals/:approvalId/issues` | Approval state is not embedded in issues or scheduling rows. |
| Decisions | Decision service | `decisions`, `decision_bundles`, `decision_target_issues` | `POST/GET /api/companies/:companyId/decisions`, `GET/POST /api/decisions/:id/*` | Legacy decision records are imported into canonical decision workflow, with explicit import provenance. |
| Issue timing | Scheduling service | `issue_scheduling` | `GET/PUT/DELETE /api/companies/:companyId/issues/:issueId/scheduling`, `GET /api/companies/:companyId/scheduled-issues` | Exactly zero or one scheduling row per issue. Core issue lifecycle stays in `issues`. |
| Personal recurrence | Scheduling service | `scheduling_routines` | `/api/companies/:companyId/scheduling-routines` and generation routes | Template generates ordinary issues idempotently. It does not execute an agent. |
| Agent execution recurrence | Routine service | `routines`, `routine_revisions`, `routine_triggers`, `routine_runs` | `/api/companies/:companyId/routines`, `/api/routines/:routineId/*` | Separate concept. Never migrate personal recurring tasks into agent-execution routines. |

## Entity map

### Task and WorkPackage

| Legacy source | Canonical destination | Migration behavior |
| --- | --- | --- |
| `Task` | `issues` | Insert one company-scoped issue. Map `title`, `note -> description`, creator, assignee, project, priority default, status, timestamps where import tooling permits. |
| `WorkPackage` | `issues` | Insert one issue, not a project and not a new work-package table. Keep project association on `issues.project_id`. |
| `Task.parentId` | `issues.parent_id` | Resolved parent task wins when valid and same-company. |
| `Task.workPackageId` | `issues.parent_id` | Used when `Task.parentId` is empty. Invalid/missing parents are reported and issue remains root-level. |
| `WorkPackage.parentId` | `issues.parent_id` | Preserve nested work-package hierarchy after all issue IDs are allocated. Reject cycles. |
| Block/dependency edge | `issue_relations` | Use `type='blocks'` only for explicit issue-to-issue blockers. Status text alone does not invent an edge. |
| `note`, clarification, blockage narrative | `issues.description`, `issue_comments` | Main note becomes description. Clarification and blockage events become attributed comments; attachment payloads become `assets` plus `issue_attachments`. |
| `DefinitionOfDone[]` | `documents` + `issue_documents` | Render retained definitions and requirement checkboxes into one Markdown document keyed `definition-of-done` on owning issue. No DoD table. |
| `tagIds` | `issue_labels` | Resolve through migrated label map. Unknown tag IDs are migration errors, not silently created values. |
| `flagged=true` | `labels` + `issue_labels` | Attach one company label named `Flagged`; false creates no link. |
| `dueDate`, `scheduledTime`, `deferDate`, `estimate` | `issue_scheduling` | Combine due date and optional local time using declared import timezone into `scheduled_at`; all-day due date uses local start-of-day. Map defer date to `defer_until`; estimate to `scheduled_duration_minutes`. |
| `routineId` | `issues.origin_kind`, `origin_id`, `origin_fingerprint` | For generated instances use `origin_kind='scheduling_routine_instance'`, canonical routine ID as `origin_id`, and occurrence date as fingerprint. |

Status normalization:

| Legacy `ItemStatus` | Issue status |
| --- | --- |
| `Active` | `todo` |
| `On-going` | `in_progress` only when assignment and checkout invariants can be established; otherwise `todo` plus migration comment |
| `Blocked` | `blocked` |
| `Completed` | `done` |
| `Dropped` | `cancelled` |

Issue delete behavior remains canonical: parent records are not recursively hard-deleted by migration logic. Import must allocate all issue IDs first, then apply same-company parent and relation edges in a second pass.

### Project

| Legacy source | Canonical destination | Migration behavior |
| --- | --- | --- |
| `Project` | `projects` | Insert one company-scoped project with name, mapped status, and source timestamps where supported. |
| `Project.id` | migration ID map | Store mapping in migration report/checkpoint, not an operational legacy-ID column. |
| `Project.name` | `projects.name` | Required; reject blank names. |
| `Project.status` | `projects.status` | Normalize known active/planned/completed values to current project status vocabulary; unknown values become `backlog` and a migration warning. |
| Task/WorkPackage `projectId` | `issues.project_id` | Link only after verifying project belongs to same company. |

Project phases and milestones do not create parallel phase/milestone tables. If owner later needs them, model deliverables as ordinary issues under the project through a separate product decision.

### Person and legacy identity

| Legacy source | Canonical destination | Migration behavior |
| --- | --- | --- |
| Authenticated human | `user` + active `company_memberships` row | Match normalized email to existing user. Never overwrite an existing account from legacy profile data. Invite/onboard unmatched people; do not synthesize credentials. |
| `Person.name`, `email`, `avatarUrl` | existing auth/profile fields where supported | Import only after identity match or invitation acceptance. Email conflict requires manual resolution. |
| `Person.reportsTo` | no human org-chart table | Drop. `agents.reports_to` applies only to AI-agent organization and must not hold human Person IDs. |
| `Person.aiPrompt` | no user field | Drop. AI behavior belongs to Hermes-backed agent config and secret-safe server configuration, never human identity. |
| `Person.mobile` | no canonical field | Drop unless a separately approved user-profile feature adds encrypted, access-controlled storage. |
| Task `assigneeId` | `issues.assignee_user_id` | Resolve only to active same-company membership. Unresolved values become unassigned and appear in migration exceptions. |
| Task `collaboratorIds` | no issue collaborator field | Do not create a collaborator table. Add an attributed migration comment listing resolved collaborators only when needed for historical context. |

Legacy cloud UIDs are identity-match inputs only. They are not copied into runtime tables, comments, or metadata. No legacy auth provider, token, configuration, or credential survives.

### Tags and labels

Create labels by `(company_id, normalized name)` using deterministic colors. Duplicate legacy tags with the same normalized name collapse to one label; emit old-to-new mappings in migration report. Issue links use `issue_labels`. Deleting a label follows canonical cascade behavior for links only.

### Logs and comments

Legacy `LogEntry` is not bulk-copied as if it were trusted Paperclip audit data. For rows tied to one migrated task/work package:

- narrative `CLARIFY` and `BLOCK` details become issue comments;
- import may emit a canonical `migration.legacy_record_imported` activity entry referencing canonical entity and source record ID in controlled migration details;
- lifecycle state comes from final canonical issue/project/approval/decision rows, not replaying mutable legacy events;
- login and provider-specific events are dropped.

This preserves useful history without falsely asserting legacy client-side logs were immutable Paperclip audit events.

### Approvals

Map each `ApprovalRequest` to one `approvals` row and one `issue_approvals` link after task mapping. Map `reason` into typed approval payload, `response` into `decision_note`, requester into matched user attribution, and terminal status into canonical approval lifecycle. Legacy `approverId` is not an authorization grant: resolution remains governed by Paperclip board permissions. Orphan approvals are skipped with an exception report. Do not embed approval status on `issues` or `issue_scheduling`.

### Decisions

Map decision title and status into `decisions`, link target issue through `decision_target_issues`, and retain useful body/history in canonical fields or an issue document. Migration-created decisions need explicit migration provenance and deterministic idempotency key. Legacy project association resolves through target issue/project context; no direct project-ID column is added.

Legacy decision-tree fields do not fit current governed choice semantics exactly. Preserve readable context, but do not fake executable effects:

- `parentId` becomes narrative context or a document link, not a new decision hierarchy column;
- `knowledgeGaps` become child issues only when independently actionable; otherwise document them;
- `convertedToWpId` links to migrated issue in document/comment context;
- planned/actual date fields are dropped unless represented by a resulting issue schedule;
- generated options without valid canonical decision effects stay informational.

### Issue scheduling

`issue_scheduling.issue_id` is primary key, enforcing one scheduling row per issue. `company_id` must match issue company. Timestamps are `timestamptz`; durations are positive minutes. K7/K8 must preserve:

- same-company reference checks;
- deterministic conversion from legacy date plus time with explicit import timezone;
- clear distinction between `scheduled_at` and `defer_until`;
- cascade delete when issue is deleted;
- indexed company/time queries through scheduling routes;
- no duplicate due-date fields on `issues`.

Legacy values with invalid dates, invalid time, non-positive duration, or missing timezone enter exception report and do not create partial scheduling rows.

### Scheduling routines versus agent-execution routines

`scheduling_routines` owns personal task templates. It creates ordinary issues and optional `issue_scheduling` rows. `routines` owns automated agent execution, revisions, triggers, and run history. Shared word "routine" does not make them interchangeable.

| Legacy `Routine` field | `scheduling_routines` field/behavior |
| --- | --- |
| `title` | `title` |
| `note` | `description` |
| `assigneeId` | `assignee_user_id` after active same-company membership resolution |
| `estimate` | `estimate_minutes` |
| daily/weekly rule | `recurrence_rule` with `kind` and validated `daysOfWeek` |
| `lastGeneratedForDate` | `last_generated_for_date`, validated date key |
| `tagIds` | dropped from routine template; generated issue label propagation needs a future explicit schema decision |
| no legacy time value | `scheduled_time = null` |

Generation uses `origin_kind='scheduling_routine_instance'`, `origin_id=<routine id>`, occurrence-date fingerprint, and canonical issue-create idempotency. A routine with unresolved assignee remains unassigned; it never points across companies. K7/K8 must enforce project, agent, and active user membership scope.

## Settings disposition

Only preferences required by retained features may survive, in dedicated user preference tables or an approved new preference schema. Do not use generic JSON dumping ground and do not put user preferences in scheduling tables.

| Legacy setting | Disposition |
| --- | --- |
| `todayViewTagIds` | Rebuild from canonical label selection only if Today UI ships persistence; otherwise drop. |
| `todayViewConfig.startHour/endHour/slotDuration` | Candidate user preference for retained scheduling UI. K11 may add typed preference schema after separate review; K6 does not approve storage. |
| `inboxFeedFilter` | Map only to existing typed inbox preference/policy where semantics match; otherwise use defaults and drop legacy value. |
| `dismissedFeedItemIds` | Do not copy raw IDs. `inbox_dismissals.item_key` keys canonical feed items, so stale legacy IDs are dropped. |
| `aiConfig` and master prompts | Drop. K10 owns Hermes-only server-side configuration. Never migrate legacy-provider prompt/key settings to client preferences. |
| `leaveBlocks` | Drop. No canonical leave/calendar-block domain exists. This is not encoded as fake issues or schedules. |

## Explicitly dropped fields

Dropped means no operational column, metadata blob, hidden table, or runtime fallback.

- `WorkPackage.workPackageType`
- `WorkPackage.responsible`, `accountable`, `consulted`, `informed` (single canonical issue assignment remains)
- `Project.code`, `contractId`, `phases`, phase type, milestones, and milestone planned/actual dates
- `Person.mobile`, `aiPrompt`, `reportsTo`; legacy UID/provider data and all provider configuration
- task `timerStartedAt`, `accumulatedTime`, `dodId`, raw `isBlocked`, duplicate `workPackageId` after parent resolution, and unresolved collaborator IDs
- raw `BlockageDetails.reporterId/assigneeId` when not resolvable; attachment base64 after asset import
- routine `tagIds`
- decision `parentId`, planned/actual dates, and converted legacy IDs after useful narrative links are captured
- `todayViewTagIds`, `todayViewConfig`, `leaveBlocks`, `aiConfig`, `inboxFeedFilter`, and `dismissedFeedItemIds` unless a retained typed preference mapping above explicitly applies
- legacy login/provider logs and any secret, token, credential, API key, or provider configuration

## Migration order and behavior

1. Export and hash immutable legacy snapshot; run migration on a copy. Never read live client collections while writing target rows.
2. Select target company and declared IANA timezone. Abort if either is missing.
3. Normalize and validate people, projects, tags, issues, approvals, decisions, and routines. Produce conflict/exception report before writes.
4. Match users and memberships; create invitations rather than credentials. Allocate canonical projects, labels, issues, and scheduling routine IDs with deterministic checkpoints.
5. Insert projects and labels, then issues without graph edges, then same-company parent relations, issue-label links, documents/comments/assets, and `issue_scheduling`.
6. Insert `scheduling_routines`, approvals plus issue links, and decisions plus target links. Generate no recurrence instances during import.
7. Emit canonical migration activity events. Keep old-to-new ID map and dropped-field counts in external migration report, not runtime domain tables.
8. Verify counts, no orphan foreign keys, no cross-company references, no parent cycles, one scheduling row per issue, label uniqueness, and scheduling-routine idempotency.
9. Rerun against same snapshot in dry-run/idempotency mode; require zero duplicate canonical entities and zero duplicate generated issues.

Source deletion never cascades into target. Target deletion follows canonical FK behavior only. Import failures are per-record exceptions until a required reference or integrity invariant fails; required invariant failure aborts transaction/batch and leaves checkpoint resumable.

## No-duplicate-domain acceptance checks

- Core work routes remain issue/project/label/approval/decision routes; scheduling routes extend issues rather than replace them.
- No new table mirrors legacy `AppData` arrays.
- `issue_scheduling` contains timing only; no title, description, status, project, labels, comments, approval, or decision columns.
- `scheduling_routines` contains personal template recurrence only; no trigger, run, adapter, execution, secret, or agent-workflow columns.
- `routines` remains agent-execution automation and receives no migrated personal routine rows.
- Humans resolve through auth users and memberships; `agents` remains AI agents.
- Original legacy export remains audit artifact outside live domain model.

## Downstream contract

K7/K8 implement and harden only `issue_scheduling` and `scheduling_routines` against existing Paperclip entities. K9/K10 remove legacy provider runtime and establish Hermes-only AI without changing this domain map. K13 may choose network topology but must not introduce alternate persistence or identity models.
