# Tagged-Comment Ingestion Contract

Status: Draft v1
Audience: backend, infra, and QA implementers of the `@dev` tagged-comment →
development-backlog ingestion path.

Purpose: Define the exact contract for finding issue comments that carry the
actionable tag `@dev`, classifying the human's text as a complaint or a
suggestion, and creating deduplicated development-backlog items from them — the
comment query interface, pagination, authorization, processing state,
deduplication key, source linkage, title/body mapping, malformed-input
behavior, retry semantics, and audit fields — so the feature can be built and
tested without guessing field names, table shapes, endpoints, or status
behavior.

This contract is Hermes-only. It introduces **no** Google (or any external
provider) dependency: the sole ingestion source in V1 is Paperclip's own
`issue_comments` table, polled by the in-process heartbeat scheduler.

## Normative Language

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, and `OPTIONAL`
are to be interpreted as in RFC 2119.

## Ground Truth (as-built references)

Every field, table, enum, and function named below is taken from the current
codebase, not invented. The reference implementation already exists on branch
`wt/t_cc6a2cb0` (ingestion/scheduler) layered on `wt/t_d85fd6e6`
(storage/query). This document is the normative contract those modules satisfy;
downstream backend/infra/QA work MUST implement and verify against these exact
names.

- Source comment model: `issue_comments` table —
  `packages/db/src/schema/issue_comments.ts`.
  - `id` (uuid, PK), `companyId` (uuid, `NOT NULL`), `issueId` (uuid,
    `NOT NULL` → `issues.id`), `authorAgentId` (uuid, nullable → `agents.id`),
    `authorUserId` (text, nullable), `body` (text, `NOT NULL`),
    `deletedAt` (timestamptz, nullable — soft delete),
    `createdAt`/`updatedAt` (timestamptz, `NOT NULL`).
  - Human authorship is expressed as `authorAgentId IS NULL` joined to an
    existing `auth_users` row; agent-authored comments have a non-null
    `authorAgentId` and MUST be excluded.
- Backlog/task model: `issues` table — `packages/db/src/schema/issues.ts`.
  - `id`, `identifier` (nullable, e.g. `"ENV-13"`), `title` (`NOT NULL`),
    `description` (nullable), `status` (`NOT NULL`, default `"backlog"`),
    `companyId` (`NOT NULL`), `originKind` (nullable), `originId` (nullable),
    `updatedAt`.
  - Unique index `issues_company_id_unique_idx` on `(company_id, id)` — the
    referenced key for the composite backlog FK below.
- Status enum: `ISSUE_STATUSES` in `packages/shared/src/constants.ts` =
  `["backlog","todo","in_progress","in_review","done","blocked","cancelled"]`.
  New backlog items are created with `status: "backlog"`.
- Backlog creation: `issueService(db).create(companyId, input)` —
  `server/src/services/issues.ts`. Relevant `IssueCreateInput` fields:
  `title`, `description`, `status`, `originKind`, `originId`,
  `idempotencyKey?`, `onDeduplicated?: (reason: "idempotency_key" |
  "recent_open_title") => void`.
- Redaction: `redactSensitiveText(input)` — `server/src/redaction.ts`.
- Authorization helpers: `assertAuthenticated`, `assertCompanyAccess` —
  `server/src/routes/authz.ts`. Error shapes: `server/src/errors.ts`
  (`badRequest`, `unauthorized`, `forbidden`).
- Scheduler host: the heartbeat scheduler tick in `server/src/index.ts`
  (`trackHeartbeatSchedulerWork(commentIntakes.runDue(new Date()))`).

## Storage (as-built, migration `0232`)

Migration `packages/db/src/migrations/0232_comment_intake_schema.sql`; schema
`packages/db/src/schema/development_comment_intakes.ts`. Four tables:

### `comment_intake_sources`

Per-company registration of an ingestion source. A row means "poll this
provider/object-type/scope for `@dev` comments".

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid `NOT NULL` → companies | cascade delete |
| `provider_key` | text `NOT NULL` | V1 only value: `"paperclip"` |
| `object_type` | text `NOT NULL` | V1 only value: `"issue_comment"` |
| `source_scope_id` | text `NOT NULL` | V1 equals `company_id` |
| `enabled` | bool `NOT NULL` default `false` | poller ignores disabled |
| `tag` | text `NOT NULL` default `"@dev"` | actionable tag |
| `created_by_user_id` | text | audit |
| `created_at` / `updated_at` | timestamptz `NOT NULL` | |

Unique: `(company_id, provider_key, object_type, source_scope_id)`;
`(id, company_id)` (target of the composite FK below).

### `comment_intake_checkpoints`

One row per source (`source_id` PK). Durable poll cursor + failure counters.

`cursor` (text), `high_watermark_occurred_at` (timestamptz),
`high_watermark_id` (text), `last_success_at`, `last_attempt_at`,
`consecutive_failure_count` (int `NOT NULL` default 0, `CHECK >= 0`),
`last_error_code` (text), `updated_at`.

### `development_comment_intakes`

The processing/state record for every candidate comment, and the link to the
created backlog issue.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid `NOT NULL` | scoping root |
| `source_id` | uuid `NOT NULL` → sources | |
| `source_comment_id` | text `NOT NULL` | **source linkage** to `issue_comments.id` |
| `source_issue_id` | uuid → issues | `ON DELETE SET NULL` |
| `source_author_user_id` | text | preserved author |
| `source_created_at` / `source_updated_at` | timestamptz `NOT NULL` | preserved timestamps |
| `source_url` | text | null in V1 |
| `tag` | text `NOT NULL` default `"@dev"` | |
| `tag_positions` | jsonb `NOT NULL` default `[]` | `[{start,end}]` in visible prose |
| `kind` | text `NOT NULL` | classification, see below |
| `subject` | text `NOT NULL` | derived title, see mapping |
| `request_body` | text (nullable) | preserved original visible text; null when redacted |
| `content_fingerprint` | text `NOT NULL` | SHA-256 of visible text (edit detection) |
| `dedupe_key` | text `NOT NULL` | **deduplication key**, see below |
| `intake_status` | text `NOT NULL` default `"new"` | **processing state**, see below |
| `backlog_issue_id` | uuid → issues | `ON DELETE SET NULL` |
| `backlog_status_snapshot` | text | last-seen issue status (snapshot only) |
| `backlog_updated_at` | timestamptz | |
| `dismissed_reason_code` | text | e.g. `"secret_detected"` |
| `created_at` / `updated_at` | timestamptz `NOT NULL` | audit |
| `redacted_at` / `archived_at` | timestamptz | audit / retention |

Constraints/indexes:
- Unique `(company_id, dedupe_key)` — the idempotency guarantee.
- Partial unique on `backlog_issue_id WHERE NOT NULL` — one intake per backlog
  issue.
- Composite FK `(company_id, backlog_issue_id) → issues(company_id, id)`. Column
  order MUST match `issues_company_id_unique_idx`; drizzle emits FK alters
  before index creates, so the FK MUST be declared after the referenced unique
  index or PostgreSQL raises `42830`.
- Composite FK `(source_id, company_id) → comment_intake_sources(id, company_id)`.
- List indexes on `(company_id, intake_status, source_created_at DESC, id DESC)`
  and `(company_id, kind, source_created_at DESC, id DESC)`.

### `comment_intake_runs`

Audit row per poll attempt: `status`, `started_at`, `finished_at`,
`page_count`, `candidate_count`, `created_count`, `updated_count`,
`duplicate_count`, `rejected_count`, `error_code`, `error_detail`.

## 1. Comment Query Interface (candidate selection)

The poller (`commentIntakeService(db).runSource` in
`server/src/services/comment-intake.ts`) selects candidate comments with a
single scoped query. A comment is **eligible** iff ALL hold:

1. `issue_comments.company_id = source.company_id` (company scoping).
2. `authorAgentId IS NULL` — human-authored only. Agent comments MUST NOT be
   ingested (prevents feedback loops).
3. joined to an existing `auth_users` row (`INNER JOIN auth_users ON
   auth_users.id = issue_comments.author_user_id`) — verified human author.
4. joined to an `issues` row in the same company (`INNER JOIN issues ON
   issues.id = issue_comments.issue_id AND issues.company_id =
   source.company_id`).
5. `deletedAt IS NULL` — soft-deleted comments MUST NOT be ingested.
6. within the watermark window (see §2).

Ordering MUST be `createdAt ASC, id ASC` (stable forward scan). Tag matching is
NOT done in SQL — every windowed comment is fetched and the tag is detected in
application code (`parseCommentIntakeText`, §5) against **visible prose only**
(code fences/inline code stripped), so `@dev` inside a code block never
triggers ingestion.

## 2. Pagination

- Page size: `MAX_PAGE_SIZE = 100` rows per source per tick (`LIMIT 100`).
- The scan is a durable keyset over `issue_comments.createdAt`, persisted in
  `comment_intake_checkpoints`:
  - `high_watermark_occurred_at` / `high_watermark_id` record the last
    processed comment's `createdAt`/`id`.
  - Each tick resumes at `createdAt >= high_watermark_occurred_at - OVERLAP_MS`
    where `OVERLAP_MS = 5 min`. The **five-minute overlap intentionally
    replays** recently-seen rows so a comment written during a prior tick's
    read window is never skipped; the dedupe key (§6) makes replay a no-op.
  - After a page, the checkpoint advances to the last row of that page.
- A source is polled at most once per `POLL_INTERVAL_MS = 5 min`
  (`checkpoint.lastAttemptAt` gate); a tick that arrives early returns
  `{ skipped: "not_due" }`.
- The agent-facing read API (§3) uses a separate opaque **filter-bound keyset
  cursor** over the stored intakes — see `development-comment-intake-cursor.ts`.
  Order is fixed `source_created_at DESC, id DESC`; the cursor embeds a SHA-256
  hash of the canonical filter set, and a cursor minted under one filter set
  replayed against another MUST return `400`.

## 3. Authorization

Two distinct surfaces, two authorization models.

### Ingestion (write) path — server-internal only

Candidate selection and backlog creation run **inside the heartbeat scheduler**
(`server/src/index.ts`), not behind any HTTP route. There MUST be **no**
agent-, board-, or user-facing endpoint that triggers ingestion, configures a
source, mutates a checkpoint, or creates a backlog item from a comment. This
keeps the trust boundary at the server process.

### Query (read) path — `development-comment-intakes.ts` routes

Read-only agent/board surface (design as-built in
`server/src/routes/development-comment-intakes.ts`):

- `GET /api/companies/:companyId/development-comment-intakes` (list) —
  `assertCompanyAccess(req, companyId)`:
  - unauthenticated → `401`;
  - agent API key/JWT whose company ≠ `:companyId` → `403` before any query;
  - board caller without company access → `403`.
- `GET /api/companies/:companyId/development-comment-intakes/:intakeId`
  (detail) — `assertAuthenticated(req)` then company-scoped lookup:
  - unauthenticated → `401`;
  - missing id **or** cross-company id → **indistinguishable `404`** (no
    existence oracle).

All queries are rooted at `company_id` in SQL; a stale/forged
`backlog_issue_id` can never widen visibility because the composite FK binds it
to the same company.

## 4. Processing State

`development_comment_intakes.intake_status` is the state machine. Allowed values
(`DEVELOPMENT_COMMENT_INTAKE_STATUSES` in
`packages/shared/src/validators/development-comment-intakes.ts`):

`new`, `triaged`, `backlog_created`, `duplicate`, `dismissed`, `rejected`,
`redacted`, `archived`.

Transitions produced by the poller:

- New eligible candidate, clean → inserted `new`, then on successful backlog
  create → `backlog_created` (or `duplicate` if `issueService.create` reports
  `onDeduplicated`).
- New candidate whose body is empty or trips redaction → inserted `redacted`
  with `dismissed_reason_code = "secret_detected"`, `redacted_at = now`,
  `request_body = null`; **no** backlog issue is created.
- Existing intake (same dedupe key), source unchanged
  (`content_fingerprint` and `source_updated_at` equal) → **no-op** (idempotent
  replay).
- Existing intake whose source was **edited** after a backlog issue was already
  created → `triaged` (human must reconcile; the poller MUST NOT silently
  rewrite existing backlog content).
- `archived` is a retention terminal state; `dismissed` is a manual terminal
  state. Neither is produced automatically in V1 but both are valid query
  filters and both suppress `request_body` on read.

## 5. Classification (complaint vs suggestion)

`parseCommentIntakeText(body)` (`server/src/services/comment-intake-text.ts`):

1. Compute **visible prose**: NFC-normalize, strip fenced and inline code
   (newline boundaries preserved), collapse whitespace.
2. Find `@dev` with `/(?<![A-Za-z0-9_-])@dev(?![A-Za-z0-9_-])/gi` in the
   visible prose. Zero matches → return `null` (not a candidate). Record all
   match spans in `tag_positions`.
3. Read the optional directive immediately after the first tag:
   - `complaint` | `bug` | `issue` → `kind = "complaint"`;
   - `suggestion` | `feature` | `idea` → `kind = "suggestion"`;
   - none/unrecognized → `kind = "needs_triage"`.

`DEVELOPMENT_COMMENT_INTAKE_KINDS = ["complaint","suggestion","needs_triage"]`.
`needs_triage` is the safe default; a human/agent reclassifies later. There is
**no** LLM call in the classification path — it is deterministic directive
matching, so it is cheap, testable, and Hermes-only.

## 6. Deduplication Key & Source Linkage

`commentIntakeDedupeKey({ companyId, providerKey, objectType, sourceScopeId,
sourceCommentId })` = `SHA-256` of those five values joined with `\u0000`.

- Stored in `development_comment_intakes.dedupe_key`; unique per
  `(company_id, dedupe_key)`. This is the durable idempotency guarantee:
  reprocessing the same comment (overlap replay, restart, retry) can never
  create a second intake or a second backlog item.
- Backlog creation additionally passes `idempotencyKey:
  "comment-intake:${intake.id}:v1"` to `issueService.create`, so a crash
  between "intake inserted" and "backlog created" cannot double-create the
  issue on the next tick.
- **Source linkage** preserved on every intake: `source_comment_id`,
  `source_issue_id`, `source_author_user_id`, `source_created_at`,
  `source_updated_at`, plus `content_fingerprint` (SHA-256 of visible text) for
  edit detection. `backlog_issue_id` links back the other direction; backlog
  status is resolved from the **canonical `issues` row at read time** (the
  stored `backlog_status_snapshot` is never returned to callers).

## 7. Title / Body Mapping

Backlog issue created via `issueService.create(companyId, …)`:

- `title` = `` `[${kind}] ${subject}` `` where `subject` is the first non-empty
  visible-prose line with the leading tag+directive removed, trimmed of leading
  `:`/`-`/space, capped at `COMMENT_INTAKE_MAX_SUBJECT_CODE_POINTS = 240`
  code points; empty → default `"Development feedback"`.
- `description` = a structured block:
  ```
  Feedback imported from a verified human issue comment.
  Source issue ID: <sourceIssueId>
  Source timestamp: <sourceCreatedAt ISO>
  Category: <kind>

  <requestBody>
  ```
- `status` = `"backlog"`.
- `originKind` = `"comment_intake"`, `originId` = `intake.id` — the backlog
  item's provenance.
- `request_body` stored on the intake is the visible prose capped at
  `COMMENT_INTAKE_MAX_REQUEST_BODY_CODE_POINTS = 16_000` code points.

## 8. Malformed / Edge Input Behavior

The poller MUST handle every case below without aborting the page:

| input | behavior |
|---|---|
| no `@dev` in visible prose | not a candidate; skipped, no row |
| `@dev` only inside code fence/inline code | not a candidate (stripped from visible prose) |
| empty visible body after tag | intake `redacted`, `request_body=null`, no backlog |
| body trips `redactSensitiveText` (secret) | intake `redacted`, `dismissed_reason_code="secret_detected"`, `redacted_at=now`, no backlog |
| agent-authored comment | excluded by `authorAgentId IS NULL` filter |
| author not in `auth_users` | excluded by inner join (unverified human) |
| soft-deleted comment (`deletedAt` set) | excluded |
| comment for another company's issue | excluded by company-scoped joins |
| already-processed (same dedupe key), unchanged | no-op |
| already-processed but source edited after backlog created | intake → `triaged`, backlog untouched |
| unknown/unsupported source (`provider_key`/`object_type`/scope mismatch) | `runSource` returns `{ skipped: "unsupported_source" }` |
| oversized body/subject | truncated to code-point caps (§7) |

## 9. Retry Semantics

- Each `runSource` is wrapped in a DB transaction guarded by
  `pg_advisory_xact_lock(hashtextextended("comment-intake:<sourceId>"))`, so
  concurrent ticks for the same source serialize (overlap-safe).
- On success: `comment_intake_runs` row set `succeeded`/`partial`;
  checkpoint's `consecutive_failure_count → 0`, `last_error_code → null`,
  `last_success_at`/`last_attempt_at` advanced.
- On failure: the run row is `failed` with a **sanitized** `error_code`
  (only `database_error`/`unexpected_error` surface; anything else collapses to
  `unexpected_error`) and a short `error_detail` (error name, ≤120 chars — no
  raw payloads/secrets); the checkpoint's `consecutive_failure_count` is
  incremented and `last_error_code` recorded, but the **high watermark is not
  advanced**, so the next tick re-reads the same window. Combined with the
  dedupe key and backlog idempotency key, retries are safe and duplicate-free.
- `partial` status is returned when at least one candidate was rejected
  (redacted) while others succeeded; it is not an error and does not increment
  the failure counter.
- No exponential backoff in V1: retry cadence is simply the 5-minute poll
  interval. `consecutive_failure_count` exists so a future policy (alerting /
  disabling a persistently failing source) can be layered on without schema
  change.

## 10. Audit Fields

- Per intake: `created_at`, `updated_at`, `redacted_at`, `archived_at`,
  `content_fingerprint`, `source_author_user_id`, and the preserved source
  timestamps.
- Per poll: `comment_intake_runs` (started/finished, page & candidate &
  created & updated & duplicate & rejected counts, sanitized error code +
  detail).
- Per source: `comment_intake_checkpoints` (`last_attempt_at`,
  `last_success_at`, `consecutive_failure_count`, `last_error_code`).

## 11. File / Module Change Map

Implemented (branch `wt/t_cc6a2cb0` over `wt/t_d85fd6e6`). Downstream workers
implement/verify against these paths:

| file | responsibility |
|---|---|
| `packages/db/src/migrations/0232_comment_intake_schema.sql` (+ `meta/0232_snapshot.json`, `meta/_journal.json`) | four tables, indexes, composite FKs |
| `packages/db/src/schema/development_comment_intakes.ts` | Drizzle schema for the four tables |
| `packages/db/src/schema/index.ts` | export the new schema module |
| `packages/shared/src/validators/development-comment-intakes.ts` | kinds/statuses/sources enums, list-query validator |
| `packages/shared/src/index.ts` | export validators |
| `server/src/services/comment-intake-text.ts` | visible-prose extraction, tag detection, classification, dedupe key |
| `server/src/services/comment-intake.ts` | poller: candidate query, redaction, intake upsert, backlog create, checkpoint/run bookkeeping (`runSource`, `runDue`) |
| `server/src/services/development-comment-intakes.ts` | read-only list/getById query service |
| `server/src/services/development-comment-intake-cursor.ts` | filter-bound opaque keyset cursor |
| `server/src/services/index.ts` | export `commentIntakeService` |
| `server/src/routes/development-comment-intakes.ts` | read-only agent/board GET endpoints + authz |
| `server/src/app.ts` | mount the read routes |
| `server/src/index.ts` | register the source poller on the heartbeat scheduler tick |

Migration numbering MUST avoid collision with `origin/main`'s highest
migration; V1 chose `0232` because `0231_discord_integration_authority.sql`
already exists on `main`. Re-check and renumber if `main` advances before land.

## 12. Acceptance Examples

QA MUST demonstrate each of these end-to-end against a real Postgres (the
embedded-PG service suite skips on hosts without native support, so a real DB
is required for true acceptance):

1. **Happy path — complaint.** Verified human posts
   `@dev complaint the export button is broken` on an issue. One tick later a
   `development_comment_intakes` row exists (`kind="complaint"`,
   `intake_status="backlog_created"`) and exactly one `issues` row exists with
   `originKind="comment_intake"`, `status="backlog"`,
   `title="[complaint] the export button is broken"`.
2. **Happy path — suggestion.** `@dev suggestion add dark mode` →
   `kind="suggestion"`, backlog `title="[suggestion] add dark mode"`.
3. **Untagged exclusion.** A comment with no `@dev` (and one with `@dev` only
   inside a fenced code block) produces **no** intake row and **no** backlog
   item.
4. **Agent-authored exclusion.** An agent comment containing `@dev` is never
   ingested.
5. **Dedup on rerun.** Running the poller twice (including a run inside the
   5-minute overlap) over the same comment yields exactly one intake and one
   backlog issue; second run reports `duplicate`/no-op, not a new create.
6. **Idempotency-key dedup.** Simulate a crash after intake insert but before
   backlog create; the next tick creates the backlog issue exactly once
   (`comment-intake:<intakeId>:v1`).
7. **Secret redaction.** `@dev complaint token is sk-...` → intake
   `redacted`, `dismissed_reason_code="secret_detected"`, `request_body=null`,
   no backlog item.
8. **Edited source after backlog created.** Edit the comment body after its
   backlog issue exists; next tick sets the intake to `triaged` and leaves the
   backlog issue unchanged.
9. **Query authz.** List endpoint returns `401` unauthenticated, `403` for a
   cross-company agent key; detail endpoint returns an indistinguishable `404`
   for a missing id and for a cross-company id.
10. **Pagination.** With >100 candidate comments, a single tick processes 100
    and advances the checkpoint; the next tick resumes without gap or
    duplicate. The read API cursor walks all pages with no duplicate and
    returns `400` when a cursor is replayed against a different filter set.
11. **Retry after failure.** Force a DB error mid-run; the run row is `failed`
    with a sanitized `error_code`, the high watermark does **not** advance,
    `consecutive_failure_count` increments, and the next tick reprocesses the
    same window without creating duplicates.
