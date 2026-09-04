---
id: T3-SLICE1-FEATURE-PLAN
role: plan
status: APPROVED
owner: tetracilin
derives_from: docs/designs/t3-company-os-ssot.md
targets: [backlog.md, roadmap.md]
updated: 2026-09-03
---

# T3 — Slice 1 feature decomposition (agent-implementable)

Turns the design record `docs/designs/t3-company-os-ssot.md` and the PC-xxx story specs in
`backlog.md` into **feature units an agent can pick up cold**: one unit = one GitHub issue =
one branch = one PR. Stories say *what the user gets*; this file says *what gets built, in
what order, against which files, with which tests, and when it is done*.

Two parts:

- **Part A — user-story completeness pass.** Which roadmap personas have story coverage,
  which do not, and the new PC-xxx stories that close the gaps.
- **Part B — Slice 1 feature units.** F-ids under each story, with bindings, tests, DoD,
  dependencies, and lanes.

On approval, Part A's new stories are folded into `backlog.md` and Part B's units are filed
as GitHub issues (`backlog.md` Filing-status table records the numbers).

---

## Current state — verified in code, not assumed

| Claim | Verified | Evidence |
|---|---|---|
| PC-001 evidence gate | **SHIPPED** (develop, #40 / issue #41) | `server/src/services/issues.ts:7842-7940`, gate inside the row-locked `issueService.update()` transaction; `companies.evidenceGateEnabled` flag; `cancelled` never gated; activity_log `issue.evidence_gate.closed` with count written even when the flag is off |
| PC-001 tests | 13 cases | `server/src/__tests__/issue-evidence-gate.test.ts` — flag on/off, both evidence sources, cancelled, already-done no-retrigger, race/reopen, activity_log, PATCH 422, recovery-actions 422 |
| `issue_evidence_links` table | **EXISTS** | `packages/db/src/schema/issue_evidence_links.ts`, migration `0232_naive_cerise.sql`. Columns: id, company_id, issue_id, external_object_id, created_at. FK cascade on both. |
| `issue_evidence_links` **write path** | **WRITTEN AND PUSHED — `origin/feature/evidence-substrate`** | Not on `develop`, so the gate on `develop` can today only be satisfied by `issue_attachments`. But the branch carries `server/src/services/issue-evidence-links.ts` (493 lines) + `issue-evidence-links.test.ts` (980) and the link/unlink/move routes. **No PR is open for it.** See F-000. |
| PC-011 `source` provenance column | **WRITTEN AND PUSHED — same branch** | Migration `0233_evidence_source_provenance.sql`, plus `server/src/services/evidence-provenance.ts` (199) + test (391). |
| `source=bot` **producer** | **DOES NOT EXIST — deliberately** | `server/src/routes/issues.ts:342` on that branch is `const HTTP_EVIDENCE_SOURCE: EvidenceSource = "manual"`, used at :8568 and :13341. Every HTTP filing act records `manual`. The chat bridge is the only intended `bot` writer and is unbuilt. See ENG-8. |
| **Company export carries evidence links** | **NO — live silent failure** | Portability uses an enumerated manifest (`packages/shared/src/types/company-portability.ts`), not a table walk. `issue_evidence_links` appears 0 times in `company-portability.ts` and 0 times in `export-fidelity.ts`. Export drops it; the fidelity report reports clean. See review finding 1.2. |
| Dossier mechanism | free-text `key` on `issue_documents` | `packages/db/src/schema/issue_documents.ts` — key `dossier` needs no schema change |
| Discord bridge | slash-command + outbox transport only | `discord-bridge/src/` — `commands/`, `lib/notifier.ts`, `lib/taskCreate.ts`. README: "Gateway requests only `Guilds`; no message content or privileged intents." No message handler, no DM path, no media path. |
| Teable client | **DOES NOT EXIST** | No module under `server/src/services/` |
| `doc/WP0-OPERATIONS.md` | **EXISTS (757 lines) on `feature/evidence-substrate`** | Not on `develop`. Satisfies most of F-OPS-1. |
| Vietnamese phrase table | **EXISTS on that branch** | `packages/shared/src/wp0-phrases.ts` (514) + test (356). Satisfies most of F-VERB-0. |
| Dossier service | **EXISTS on that branch** | `server/src/services/issue-dossier.ts` (412) + fixture + test (351). Satisfies most of F-002-1 and F-002-4. |

**Residual PC-001 gaps** (the story is merged but three ACs are not fully met):

- AC2 half-met — the rejection names accepted evidence types, but its remedy is *"link
  evidence via the API"*. The AC promises **the chat phrase**; the phrase table does not
  exist yet. The message is addressed to a developer, not to a Vietnamese field engineer.
- AC5 unmet — evidence counts are in `activity_log` payloads but no query surface exposes
  them per engineer per WP. Superseded by F-011-3.
- AC6 partly met — tests cover the main PATCH and the recovery-action path. The
  **comment-decision auto-approval path** is not in the test list, and the AC requires all
  done-producing paths be exercised.

---

## Part A — user-story completeness pass

`roadmap.md` carries four personas. Mapping them onto `backlog.md`:

| Roadmap persona | Story coverage | Verdict |
|---|---|---|
| Engineer on the move | PC-002, 003, 004, 007, WP-0 verbs 1–2, PC-402 | covered |
| PM as orchestrator | PC-005, WP-0 verb 3 | covered |
| CTO | PC-001, 006, 011, 502 | covered |
| **Founder as portable operator** | **none** | **gap — new story PC-012** |

Two more commitments in `design.md` carry no story:

| design.md section | Story coverage | Verdict |
|---|---|---|
| Self-development pipeline charter + 60-day health metrics | none | **gap — new story PC-013** |
| gbrain memory (NEXT) | none | **gap — new story PC-014 (NEXT, header-level)** |
| Tier-1 file plugins (NEXT) | none | **gap — new story PC-015 (NEXT, header-level)** |
| Company skill repo (NEXT) | none | **gap — new story PC-016 (NEXT, header-level)** |

### PC-012 Portability floor — [Founder] [Slice 1]

As the founder, I want the company export/import round-trip to keep working as Slice 1 adds
tables and providers, so that the portable-OS premise stays true instead of decaying one
migration at a time.

Rationale for Slice-1 placement (not NEXT): premise 1 of the design record calls portability
a **hard constraint**, and gate decision D4 (2026-09-02) fixed the floor as *"no company-id
hardcoding, and company export keeps working."* Slice 1 adds a table (`issue_evidence_links`),
two columns (`source` ×2), three `external_objects` providers (`minio`, `git`, `nas`,
`teable`), and a document key (`dossier`). Every one of them silently breaks export if it is
not registered — and the breakage is invisible until the founder tries to move. The cost of
holding the floor now is one test per new object; the cost of restoring it later is an audit.

1. Company export includes `issue_evidence_links` rows and the `source` column on both
   evidence tables; import restores them with FK integrity intact.
2. A round-trip test (`export → fresh company → import → compare`) covers one card carrying:
   a dossier document, one attachment, one evidence link per provider, and one Teable
   external object. It runs in CI, not by hand.
3. A CI check fails the build on a hardcoded company id or company-name literal in
   `server/src`, `packages/*`, and `discord-bridge/src` (allowlist for fixtures/tests).
4. Confidential (`nas`) evidence exports as a **path reference only** — the round-trip test
   asserts no bytes and no NAS content cross the export boundary (AD-021, C16).
5. The portability floor is stated in one place — `design.md` — and this story's ACs are the
   executable form of it.
- Binding: existing company portability service (`server/src/services/*`), `packages/db`
  schema registration, CI

### PC-013 Self-development health metric — [Founder] [Slice 2]

As the founder, I want the self-development loop's health measured, so that the charter
("consolidation, bugfixes, feedback adaptation — no autonomous feature invention until the
wedge metric is green") is enforced by a number instead of by memory at the 60-day review.

1. Per-period counts: merged auto-PRs, reverts/rollbacks attributable to them, and
   engineer-facing usage improvements shipped.
2. The charter's gating condition is machine-checkable: while `wp0_evidence_via_bot` is not
   green, auto-PRs labelled as feature invention are flagged in the report.
3. A single report is produced at the 60-day mark and recorded in the repo.
- Binding: GitHub API, `backlog.md` `metrics:` map, `design.md` charter
- Note: **Slice 2, not Slice 1.** It measures a loop that only matters once the wedge is
  running; building it during the pilot competes with the pilot for the same maintainer.

### PC-014 / PC-015 / PC-016 — NEXT-horizon placeholders

Header-level only; each needs its own spec before ACs are written. Recorded so `roadmap.md`
NEXT items are traceable to backlog IDs rather than living only as prose.

- **PC-014 gbrain as re-brief memory source** — depth is an open question in `roadmap.md`
  (memory source vs full knowledge plane). Blocked on that decision.
- **PC-015 Tier-1 file plugin** — file store + version control with viewing; v1 workflow is
  download → edit in native desktop tool → re-upload with version notation.
- **PC-016 Company skill repo** — versioning, review, and rollout mechanics for company-wide
  skills, on the hermes-agent workspace pattern. Needs its own spec (open question).

---

## Part B — Slice 1 feature units

Convention: `F-<story>-<n>` for story-scoped units, `F-<VERB>-<n>` for units under the WP-0
verb pipeline that belong to no single PC story. Every ID is greppable; the index below is
what tells you an ID's story, lane, and PR batch. Effort is dual-scale — `human:` a competent
engineer, `CC:` Claude Code with review.

### B.0.1 Unit index — ID → story → lane → PR batch

| Unit | Story | Lane | PR batch | Depends on |
|---|---|---|---|---|
| F-000 | PC-007/011 (recovery) | A | substrate | — |
| F-012-1 | PC-012 | A | substrate | F-000 |
| F-011-1 | PC-011 | A | substrate | F-000 |
| F-007-1 | PC-007 | A | substrate | F-000, F-011-1 |
| F-007-5 | PC-007 | A | substrate | F-007-1, F-002-2 |
| F-011-2 | PC-011 | A | substrate | F-007-1..4 |
| F-007-2 / -3 / -4 | PC-007 | A | providers | F-007-1 |
| F-011-3 | PC-011 | A | providers | F-011-2 |
| F-002-1 / -2 | PC-002 | A | dossier | F-002-1 for -2 |
| F-002-3 / -4 / -5 | PC-002 | A | dossier | F-002-1, F-002-2 |
| F-001-1 / -2 | PC-001 | A | gate-residue | F-VERB-0 for -2 |
| F-010-1 / -2 / -3 | PC-010 | B | teable | F-010-1 |
| F-005-1 | PC-005 | B | teable | F-010-1 |
| **F-CI-1** | **pipeline (P0)** | **gates ALL lanes** | **ci (own PR, label `ci`)** | — |
| **F-GATE-1** | PC-001 (A4) | A | substrate | F-000 |
| **F-CAP-4a** | WP-0 verb 1 (A6) | C | spike (throwaway) | G-0b |
| F-VERB-0 | WP-0 (all verbs) | C | phrases | — |
| F-DM-2 / -3 | WP-0 (transport) | C | dm-surface | G-2, F-VERB-0, F-CI-1 |
| F-004-1 / -2 / -3 | PC-004 | C | intake | F-DM-2, F-002-1 |
| F-CAP-1..5 | WP-0 verb 1 | C | capture | F-DM-2, F-007-1, F-002-1 |
| F-BRIEF-1 | WP-0 verb 2 | C | brief | F-CAP-1, F-002-1 |
| F-DIGEST-1 / -2 | WP-0 verb 3 | C | digest | F-011-3, G-1, G-3 |
| F-006-1 / -2 / -3 | PC-006 | D | export | F-002-3, F-011-3 |
| F-402-1 / -2 / -3 | PC-402 | D | pilot-card | F-007-1, F-007-3 |
| F-003-1..4 | PC-003 | E | onboarding | F-003-1, F-DM-2, F-VERB-0 |
| F-OPS-1 / -2 / -3 | WP-0 (ops ACs) | E | ops | F-DM-2, F-010-1, F-CAP-1 |
| F-PILOT-1 / -2 / -3 | WP-0 (pilot protocol) | E | pilot | F-011-3, F-006-3, F-DIGEST-1 |

**Every unit body below must carry a `Files:` line and a `Verify:` line.** Where a path is the
implementer's call, the `Files:` line says so explicitly rather than being omitted — an absent
line reads as an oversight, an explicit one reads as permission.

### B.0.2 Verify commands

Run the smallest thing that proves your unit. Repo-wide checks are for hand-off, not for the
edit loop (CLAUDE.md). All paths are from the repo root; `npx vitest run` works from there.

| Units | Verify |
|---|---|
| F-000 | `pnpm --filter @paperclipai/db build && pnpm -r typecheck` |
| F-012-1 | `npx vitest run server/src/__tests__/company-portability-routes.test.ts server/src/__tests__/schema-registration.test.ts` |
| F-011-1 | `pnpm db:generate && pnpm -r typecheck` |
| F-007-1, F-007-5 | `npx vitest run server/src/__tests__/issue-evidence-links.test.ts` |
| F-007-2 / -3 / -4 | `npx vitest run server/src/__tests__/evidence-providers.test.ts` |
| F-011-2, F-011-3 | `npx vitest run server/src/__tests__/evidence-provenance.test.ts` |
| F-001-1, F-001-2 | `npx vitest run server/src/__tests__/issue-evidence-gate.test.ts` |
| F-002-1..4 | `npx vitest run server/src/__tests__/issue-dossier.test.ts` |
| F-002-5 | `pnpm check:token-gates && npx vitest run ui/src/pages/IssueDetail.test.tsx` |
| F-010-*, F-005-1 | `npx vitest run server/src/__tests__/teable-client.test.ts` |
| F-VERB-0 | `npx vitest run server/src/__tests__/phrase-table.test.ts` (asserts every referenced phrase key resolves) |
| F-CI-1 | the workflow's own run on the PR, showing a vitest summary |
| F-DM-*, F-CAP-*, F-004-* | `cd discord-bridge && npm install && npm test` — **npm, not pnpm**: `discord-bridge` is not a pnpm-workspace member and carries its own `package-lock.json` (see ENG-1) |
| F-CAP-4 | the Vietnamese eval suite; passing bar ≥90% correct-card matching |
| F-006-*, F-402-* | `npx vitest run server/src/__tests__/wp-close-export.test.ts` |
| F-003-*, F-OPS-*, F-PILOT-* | doc/runbook units — verification is the timed dry-run or the end-to-end alert test named in the unit |

Test file names above are the intended targets; where one does not exist yet, creating it is
part of the unit.

### B.0.3 `AD-xxx` references, resolved inline

The `AD-xxx` codes inherited from `backlog.md` cite "INFRA-DESIGN-v1 Patch Set 003", a document
that is **not in this repo** — grep finds these codes only in `backlog.md` and the design
record, both of which merely cite them. So no unit may treat an `AD-xxx` as its specification.
Their one-line content, as used here:

| Code | What it means for this plan |
|---|---|
| AD-021 | Confidential (defense/B2G) content never enters chat bridges or the repo |
| AD-022 | Teable replaces Fibery as the tabular system of records |
| AD-026 | Wiki exports carry NAS path references for confidential content, never bytes |
| AD-028 | Storage plane = the NAS MinIO bucket used for evidence blobs |
| AD-031 | Hermes worker agents can hold issue assignments |
| AD-032 | The evidence set: attachments plus external objects, gated on Done |
| AD-033 | Each engineer gets a personal agent bound to their Paperclip identity |
| AD-034 | The per-card dossier document, and the WP-close export built from it |
| AD-037 | `max_turns` is the agent spend governor (default 150) |

Vendoring the full AD list into `doc/` is the durable fix and is a separate PR (TODOS item 4).

### B.0 Pre-build gates (not code — they block the build)

| ID | Gate | Owner | Why it blocks | Lead time |
|---|---|---|---|---|
| G-1 | PM observation session done (design-record Assignment) | owner | Her orchestrate-review-summarize workflow **is** the digest verb's spec; building it first means guessing | ~1 day, schedulable now |
| G-2 | Discord privileged-intent request filed (message content + DM) | owner | External approval on the critical path — no DM capture is possible without it | **file today**; approval is days–weeks |
| G-3 | PM + CTO Discord accounts linked as digest recipients | owner | Verb 3 DMs them daily; nothing else creates these links | ~15 min, after G-2 |

G-2 is the single longest external dependency in Slice 1. Everything in Lane C behind
`F-DM-2` is gated on it. File it before writing any code.

### B.1 Lane A — server substrate

Ordered. `F-011-1` goes first because every later write path must set the column, and adding
it after those writes exist means touching each of them twice.

| ID | Feature | Depends on | Effort |
|---|---|---|---|
| **F-000** | **Recover the stashed evidence-substrate WIP** | — | human: 2h / CC: 20m |
| **F-012-1** | **Portability manifest + registration test (P1)** | F-000 | human: 2-3d / CC: 2h |
| F-011-1 | Provenance columns — review + complete recovered code | F-000 | human: 1h / CC: 10m |
| F-007-1 | Evidence-link write/unlink API — review + complete | F-000, F-011-1 | human: 1d / CC: 1h |
| F-007-2 | MinIO evidence upload (provider `minio`) | F-007-1 | human: 2d / CC: 2h |
| F-007-3 | Git commit verify + link (provider `git`) | F-007-1 | human: 1d / CC: 1h |
| F-007-4 | NAS path reference (provider `nas`) | F-007-1 | human: 4h / CC: 30m |
| F-007-5 | Unlink / move correction path | F-007-1, F-002-2 | human: 1d / CC: 1h |
| ~~F-011-2~~ | _moved to Lane C and rewritten as a design unit — see A1. `human: >=1d`_ | — | — |
| F-011-3 | Provenance ratio + evidence-count query | F-011-2 | human: 1d / CC: 1h |
| F-002-1 | Dossier service (create/read/append) | — | human: 1.5d / CC: 1.5h |
| F-002-2 | Dossier append hooks + scope-change mirror | F-002-1, F-007-1 | human: 1d / CC: 1h |
| F-002-3 | Scope-change timestamp query | F-002-2 | human: 4h / CC: 30m |
| F-002-4 | Dossier markdown export + fixture | F-002-1 | human: 1d / CC: 45m |
| F-002-5 | Dossier renders in card UI | F-002-1 | human: 1d / CC: 1h |
| F-001-1 | Comment-decision done-path gate test | — | human: 3h / CC: 20m |
| F-001-2 | Machine-relayable gate rejection payload | F-VERB-0 | human: 4h / CC: 30m |

---

**F-000 — Open a PR for `feature/evidence-substrate`** *(rewritten after the Phase 3 outside
voice; the earlier "recover a stash" version was wrong — see finding 1.1-CORRECTED)*

The work is **not** in a stash. `origin/feature/evidence-substrate` is a pushed branch, five
commits ahead of `develop`, **+4,885 lines across 19 files**, with **no PR open**:

| On the branch | Unit it largely satisfies |
|---|---|
| `server/src/services/issue-evidence-links.ts` (493) + test (980) | F-007-1, F-007-5 |
| `packages/db/src/migrations/0233_evidence_source_provenance.sql` + both schema edits | F-011-1 |
| `server/src/services/evidence-provenance.ts` (199) + test (391) | F-011-2, F-011-3 |
| `server/src/services/issue-dossier.ts` (412) + fixture + test (351) | F-002-1, F-002-4 |
| `packages/shared/src/wp0-phrases.ts` (514) + test (356) | F-VERB-0 |
| `doc/WP0-OPERATIONS.md` (757) | F-OPS-1 |

Commits: `77e82e93` provenance, `988c5263` wedge-metric reader, `e6ca51e8` link/unlink/move
routes, `00f6e9b4` dossier contract + fixture, `e5ddebd7` phrase table + runbook.

- Steps: `git worktree add` on `feature/evidence-substrate`; rebase onto current `develop`;
  regenerate the migration if `_journal.json` has moved; open the PR into `develop`.
- Verified clean: `git diff --name-only origin/develop...origin/feature/evidence-substrate`
  touches **nothing** under `.github/`, `CICD/`, or `backlog.md`. It is application code only,
  so it does not trip CLAUDE.md's pipeline-PR rule.
- **Branch-name caveat:** `feature/evidence-substrate` carries no `PC-xxx`, so the commit
  auto-linker specified in F-007-3 and F-402-2 matches nothing on the fork's own substrate
  branch. Either rename before opening the PR, or accept that these commits will not
  auto-link and file their evidence manually.
- DoD: the PR is open against `develop`. Everything else in Lane A is then **review of
  existing commits**, not greenfield work.

**Effort correction.** F-007-1, F-007-5, F-011-1, F-011-2, F-011-3, F-002-1, F-002-4, F-VERB-0
and F-OPS-1 are re-scoped from "build" to "review and complete against named files" —
roughly **7 human-days already written**. Their estimates in the Lane A and Lane C tables
above are stale in the pessimistic direction; re-derive Lane A's critical path from what this
branch actually leaves undone before filing issues.

**F-012-1 — Portability manifest + registration test (P1, moved from Lane E)**
Closes a live silent failure: `issue_evidence_links` shipped in #40 without a portability
manifest entry, so company export drops every evidence link and the fidelity report says
clean (review finding 1.2).
0. **`external_objects` must be registered FIRST.** It is also absent (grep: 0 hits in both
   `company-portability.ts` and `packages/shared/src/types/company-portability.ts`), and every
   link row is `externalObjectId ... .notNull().references(() => externalObjects.id)`
   (`schema/issue_evidence_links.ts:12-14`). Registering the link table alone produces an **FK
   violation on import**, not a restored link. Identity fields: `provider_key`, `external_id`,
   `sanitized_canonical_url`; import dedupes on `(company_id, provider_key, external_id)`.
1. `issue_evidence_links` then gains its manifest entry in
   `packages/shared/src/types/company-portability.ts`, a normalizer in
   `company-portability.ts`, and an import path — matching the existing
   `normalizePortableIssueAttachments` shape (line 1117).
2. Its count joins `collectExportFidelityCounts` (`export-fidelity.ts:23-45`).
3. **Registration test — scoped, not repo-wide.** The naive version is not "one guard": there
   are **122 schema files, 108 carrying `company_id`**, against a manifest covering ~15
   entities. Requiring day-one classification of ~90 tables makes "append an exclusion line"
   the cheap way to green a new table — the same habit it was meant to replace. So: the test
   runs against a **curated portability watchlist** (the entities a company export is expected
   to carry), and every exclusion needs a reason code, surfaced in the PR template. A table
   added to the watchlist without a manifest entry fails the build.
4. Round-trip test (`export → fresh company → import → compare`) over a card carrying a
   dossier document, an attachment, one evidence link per provider, and a Teable external
   object. `nas` evidence round-trips as a **path reference only** — no bytes cross the
   export boundary (AD-021, C16).
5. A CI check fails the build on a hardcoded company id or company-name literal in
   `server/src`, `packages/*`, `discord-bridge/src` (fixtures and tests allowlisted).
- DoD: PC-012's ACs are executable. Must land before Slice 1's remaining schema objects
  (`source` ×2, three `external_objects` providers, the `dossier` key) ship on top of it.

**F-011-1 — Provenance columns (review + complete recovered code)**
Additive migration adding `source text NOT NULL DEFAULT 'manual'` to `issue_evidence_links`
and `issue_attachments`. Accepted values **`bot` | `manual` | `system`** as a shared constant in
`packages/shared/src/constants.ts` — the third value is a gate decision (UC-1, 2026-09-03):
auto-linked git commits and any other system-generated filing are neither a bot capture nor a
human re-entry, and must leave the wedge ratio rather than suppress it. The code comment at
`server/src/routes/issues.ts:327` on `feature/evidence-substrate` already anticipates this (not a Postgres enum — a check constraint, so adding a
third source later is a migration, not a type rewrite). **No column on `external_objects`**:
provenance is per filing act, not per object (gate decision, 2026-09-02) — the same object
can be bot-linked on one card and manually linked on another.
- Files: `packages/db/src/schema/issue_evidence_links.ts`, `.../issue_attachments.ts`,
  `packages/db/src/migrations/`, `packages/shared/src/constants.ts`
**The migration must add a real `CHECK (source IN ('bot','manual'))` on both tables.** Drizzle's
`text("source").$type<EvidenceSource>()` is a TypeScript-only cast — it emits a plain `text`
column, so without the check the database accepts `source='banana'` from any writer that
bypasses the typed client (review finding ENG-3). This is the column the pilot's pass/abort
decision is computed from.
- Tests: migration applies forward on a populated table; existing rows read back as
  `manual`; **the database rejects an unknown value** (a regression test — it fails against the
  stashed code as written).
- Files: `packages/db/src/schema/issue_evidence_links.ts`, `.../issue_attachments.ts`,
  `packages/db/src/migrations/`, `packages/shared/src/constants.ts`
- Verify: `pnpm db:generate && pnpm -r typecheck`
- DoD: `pnpm db:generate` output committed with the schema edit in the same commit;
  `pnpm -r typecheck` green. Backward-compatible with the previous release (CLAUDE.md
  migration rule: add column → deploy → backfill → deploy).

**F-007-1 — Evidence-link write/unlink API**
The substrate's keystone: today nothing can create the row the shipped gate counts.
`POST /api/issues/:id/evidence-links` creates (or reuses) an `external_objects` row and its
`issue_evidence_links` row **in one transaction**, company-scoped, with `source` from the
caller's context. `DELETE /api/issues/:id/evidence-links/:linkId` unlinks.
- Files: `server/src/routes/issues*.ts` (thin handler), new
  `server/src/services/evidence-links.ts` (domain logic), `packages/shared` types + path
  constants, `ui/src/api/*` client.
Two structural additions this unit owns:
- **A unique index on `(issue_id, external_object_id)`.** The shipped table declares only
  `index("issue_evidence_links_company_issue_idx")` — non-unique — so "duplicate link is
  idempotent" is an app-level check-then-insert that two concurrent bot filings race straight
  through. Two rows means the gate counts 2 and **F-011-3's ratio numerator is inflated**: a
  metric-integrity bug, not untidy data (review finding ENG-2). Add
  `uniqueIndex("issue_evidence_links_issue_object_uq")` and implement the write as an upsert
  (`onConflictDoNothing`, returning the existing row with `created:false`).
- **One shared `countEvidenceForIssue(db, issueId)` helper**, exported from this service, and
  the shipped gate refactored onto it. Five consumers need this predicate — the gate, F-011-3's
  ratio, F-BRIEF-1's evidence gaps, F-DIGEST-1's blocked-cards list, F-006-1's evidence index —
  and five independent implementations will drift into inconsistent numbers between the digest
  and the export (ENG-4). The gate refactor is a structural change: separate commit, before
  the behavioural ones in the same PR.
- Tests: company-scope isolation (another company's issue is 404, not 403 — no existence
  leak); duplicate link returns the existing row, not a second one; **two concurrent inserts of
  the same pair produce ONE row and two successful responses** (regression test for ENG-2);
  unlink then re-close re-triggers the gate (the shipped race test's mirror image); **a static
  evidence row sits cleanly in the `external_objects` refresh machinery — liveness `unknown`,
  no resolver-error spam** (backlog PC-007 AC7).
- Verify: `npx vitest run server/src/__tests__/issue-evidence-links.test.ts`
- DoD: gate satisfiable end-to-end via API for the first time; PC-001's `evidenceLinkCount`
  branch exercised by a test that creates the row through the real route.

**F-007-2 — MinIO evidence upload (provider `minio`)**
Chat/UI file → NAS MinIO evidence bucket, SHA-256 recorded, linked via F-007-1. Content-type
allowlist and a body-size cap at the boundary. Same hash on the same card does not create a
second link.
- Files: `server/src/services/evidence-links.ts`, storage plane (AD-028)
The dedupe key is **`(company_id, sha256)`**, never the bare hash — a global hash index is an
existence oracle across companies (review finding 3.2). Content-type is **sniffed**, never
taken from the client's declared header, before the allowlist check.
- Tests: per-company dedupe (same bytes in two companies produce two objects); a declared
  `image/png` whose bytes are something else is refused; oversize rejected with an actionable
  message; upload failure leaves **no orphan link row** (ordering: store first, link second),
  and a GC sweep reclaims assets left unlinked past a threshold, logged (finding 4.1).

**F-007-3 — Git commit verify + link (provider `git`)**
Commit URL or hash verified against the fork's own remotes before linking — an unverified
hash is refused, never linked optimistically. Verification **parses the URL and compares host
and repository path exactly**; a prefix or substring match accepts
`https://github.com/tetracilin/test_ai_todo.attacker.example/commit/...` and links
attacker-controlled content as gate-satisfying evidence (review finding 3.1). Bare hashes
resolve against the local object database rather than being accepted as strings. Branch names
matching `PC-\d{3}` auto-link their commits (see §B.6).
- Tests: unknown hash refused; lookalike host refused; hash on a fork remote linked;
  branch-name matcher covers both `PC-007-slug` and `feature/PC-007-slug`.

**F-007-4 — NAS path reference (provider `nas`)**
Path string only. **No bytes leave the NAS** — asserted by a test, because this is the C16
confidentiality boundary and a regression here is a disclosure, not a bug.
- Tests: the stored row contains a path and no content field; export (PC-012 AC4) carries the
  path reference only.

**F-007-5 — Unlink / move correction path**
Mis-filed evidence is unlinked or moved by chat phrase or UI action; writes an `activity_log`
entry and a dossier correction line. Never a silent delete.
**Unlinking the last evidence from a card that is already `done` is refused**, with a message
naming the reopen path. Otherwise the card sits `done` with zero evidence — exactly the state
the gate exists to prevent — and PC-001's transaction cannot catch it, because the invariant
breaks outside any status transition and C14 marks the reconciliation cron as MVP-only
(review finding 4.2).
- Tests: unlink writes both records; the dossier correction line is appended, not overwritten;
  unlinking the last evidence from a `done` card is refused; unlinking a non-last evidence
  from a `done` card succeeds.

**F-011-2 — Provenance set on every write path**
Bridge-originated filings write `source=bot`; UI/API filings default to `manual`.
- Tests: one per entry point asserting the stored value. This is the wedge metric's integrity
  — an unset `source` silently reads as `manual` and understates the bot ratio.

**F-011-3 — Provenance ratio + evidence-count query**
`GET /api/companies/:id/evidence-provenance?from&to&engineer&wp` → `{bot, manual, system, ratio}`.
**The ratio is `bot / (bot + manual)` — `system` rows are excluded from BOTH numerator and
denominator** (gate decision UC-1). Without this, the pilot card type `PC-402` files most of
its evidence as auto-linked commits, which would count as `manual` and suppress the ratio no
matter how well the bot performs.
Also closes **PC-001 AC5** (evidence counts per engineer per WP).
- Tests: ratio arithmetic against a seeded fixture; date-range boundaries inclusive/exclusive
  stated and tested; the `n < 15` case returns the count so the caller can honour the
  minimum-n rule rather than the query hiding it.
- DoD: one query answers the pilot band. The band call is mechanical — this endpoint's output
  decides it.

**F-002-1 — Dossier service**
`issue_documents` key `dossier`, sections: Job order · Clarifications · Evidence log · Scope
changes · Related Teable rows. Create-on-intake, read, append-section.
- Tests: sections created in fixed order; append is idempotent per source message id.

**F-002-2 — Dossier append hooks + scope-change mirror**
Every evidence link appends one Evidence-log line (PC-007 AC5). Clarification answers append
to Clarifications. Scope-change entries are timestamped by the agent and mirrored as issue
comments.
- Tests: one link → exactly one line; the line carries the **chat-message-id ↔ card-id
  correlation** the observability section depends on.

**F-002-3 — Scope-change timestamp query** — first-signal timestamps, the CTO's
replanning-latency metric. Feeds F-006-1's timeline.

**F-002-4 — Dossier markdown export + fixture**
One example dossier checked in as a fixture, shared by the agent, the export, and the CTO
retrieval test, so all three agree on one concrete shape.

**F-002-5 — Dossier renders in card UI**
The only UI unit in Slice 1. Rides the existing `issue_documents` card surface.
- DoD: `pnpm check:token-gates` green; tokens from `ui/src/index.css` only; no hex, no raw px
  (`docs/designs/DESIGN-UI.md`).

**F-001-1 — Comment-decision done-path gate test**
Closes PC-001 AC6's "all three done-producing paths". The shipped suite covers PATCH and
recovery-actions/resolve; the comment-decision auto-approval path is untested.
- DoD: the test fails if the gate is removed from that path.

**F-001-2 — Machine-relayable gate rejection payload**
The shipped rejection says "link evidence via the API" — correct for a developer, useless to
the field engineer the AC targets. Add a structured payload (`code`, `acceptedEvidenceTypes[]`,
`chatPhraseKey`) so the bridge renders **one Vietnamese line naming the card and the filing
phrase** from the F-VERB-0 table. The English API message stays for API callers.
- DoD: the phrase key resolves against the checked-in phrase table — a rejection can never
  name a phrase the bot does not answer to (op AC10). Test asserts key resolution.

### B.2 Lane B — Teable

| ID | Feature | Depends on | Effort |
|---|---|---|---|
| F-010-1 | Teable REST client (shared service module) | — | human: 2d / CC: 2h |
| F-010-2 | Append-only agent write + link + attribution | F-010-1, F-007-1, F-002-2 | human: 2d / CC: 2h |
| F-010-3 | Teable read verb (no write scope) | F-010-1 | human: 1d / CC: 1h |
| F-005-1 | Card → Teable mirror cron | F-010-1 | human: 3d / CC: 3h |

**F-010-1** — `server/src/services/teable-client.ts`, credentials via the existing secrets
service (named refs, never inline), retry with backoff, typed responses. **A shared module,
not inlined in agent code** — PC-203 in Slice 2 reuses it.
- Tests: mocked unit tests + one recorded integration pinned to a fixture (no live Teable in
  CI).

**F-010-2** — Slice-1 subset per gate decision T2: **append-only, one allowlisted table**.
Creates a row, links it on the card as `external_objects(provider=teable)`, appends one
dossier Evidence-log line, and carries the **bot-account attribution marker**. The marker
ships in Slice 1 (not Slice 2) because F-005-1 ships in the same slice and its conflict
flagging must never fire on the bot's own writes.
- Deferred to Slice 2 (PC-010 AC2/AC3): multi-table allowlist framework, per-table schema
  maps, update-with-conflict policy.
- Tests: a write outside the allowlist is refused with an actionable message; the linked row
  appears on the card; F-005-1 does not flag the bot's row as a conflict.

**F-010-3** — reads answer "what's in table X for Y" in chat; read scope grants no write.

**F-005-1** — card create/status/assignee → base "Tecotec CN" within 5 minutes
(`pc005_teable_mirror_latency_minutes`). Direction Paperclip → Teable only; Teable-side edits
are flagged as conflicts and never overwritten; failures surface in `activity_log` and retry
with backoff.
- Tests: latency budget asserted against a clock-frozen fixture; a Teable-side edit produces a
  conflict flag, not an overwrite; a row carrying the F-010-2 attribution marker is skipped.

### B.3 Lane C — conversational verb pipeline (Discord DM surface)

The pipeline is **channel-agnostic**; only `F-DM-*` is Discord-specific. A later WhatsApp/Zalo
work package binds a second transport to the same pipeline (TODOS.md).

| ID | Feature | Depends on | Effort |
|---|---|---|---|
| F-VERB-0 | Canonical Vietnamese phrase table | — | human: 4h / CC: 30m |
| **F-004-1** | **Job-order intake → card + seeded dossier** | F-DM-2, F-002-1 | human: 2d / CC: 2h |
| **F-004-2** | **Clarifying-question turn → dossier** | F-004-1 | human: 2d / CC: 1.5h |
| **F-004-3** | **Confidential-content refusal (NAS instructions)** | F-004-1 | human: 1d / CC: 45m |
| F-DM-2 | Discord DM surface (intent, handler, auth gate, media) | G-2, F-VERB-0 | human: 1w / CC: 4h |
| F-DM-3 | Inbound persistence + replay across agent downtime | F-DM-2 | human: 2d / CC: 2h |
| F-CAP-1 | Capture pipeline — one bounded LLM call | F-DM-2, F-007-1, F-002-1 | human: 1w / CC: 4h |
| F-CAP-2 | Capture fallback → unstructured triage capture | F-CAP-1 | human: 1d / CC: 1h |
| F-CAP-3 | Server-side write-target validation | F-CAP-1, F-003-1 | human: 1d / CC: 1h |
| F-CAP-4 | Vietnamese eval suite (≥90% card matching) | F-CAP-1 | human: 3d / CC: 2h |
| F-CAP-5 | Wrong-card correction reply | F-CAP-1 | human: 1d / CC: 45m |
| F-BRIEF-1 | Re-brief verb (on-demand + proactive) | F-CAP-1, F-002-1 | human: 3d / CC: 2h |
| F-DIGEST-1 | PM digest (daily, PM + CTO) | F-011-3, G-1, G-3 | human: 3d / CC: 2h |
| F-DIGEST-2 | Digest reliability (empty day, failure alert) | F-DIGEST-1, F-OPS-2 | human: 1d / CC: 1h |

**F-004-1 — Job-order intake.** A forwarded message becomes an issue with title, description,
seeded dossier, assignee = the engineer, and a resolved project (or a triage label when
resolution fails). Idempotency reuses the existing `issue_create_idempotency_keys` table —
do **not** build a second fingerprint store. The agent replies with the card link.
- Tests: re-forwarding the same message produces no second card; unresolvable project routes
  to triage rather than failing; the seeded dossier carries all five sections.

**F-004-2 — Clarifying-question turn.** The agent asks clarifying questions and files the
answers into dossier Clarifications. This is the one capture-adjacent verb that legitimately
spins a full `eng-<name>` agent session (`max_turns=150`) — unlike F-CAP-1, which must stay a
single bounded call.
- Tests: answers land in Clarifications, not in the Evidence log; an abandoned thread leaves
  the card usable.

**F-004-3 — Confidential-content refusal.** Suspected confidential (defense/B2G) content is
refused with NAS drop-folder instructions and **nothing is stored** — no media fetched, no
text persisted, no card created (AD-021, C16). Defense-in-depth only: per C16 the structural
control is that confidential projects are never onboarded to chat bots at all.
- Tests: the refusal path writes zero rows and fetches zero bytes. A regression here is a
  disclosure, not a bug, so this test is non-negotiable.

**F-CI-1 — Make `t3-ci` actually run the tests (P0, pipeline PR, lands before everything).**
*(rewritten after the Phase 2.5 outside voice — see ENG-1-CORRECTED)*

`.github/workflows/t3-ci.yml`'s `unit` job runs guard scripts, four `node --test` script tests,
and `typecheck:build-gaps`. **It never invokes vitest.** The suite runs only in
`t3-nightly.yml` at 22:00 UTC, after merge. So a PR is green with every test in it failing, and
this plan's DoD is unenforced for all 47 units.
1. `t3-ci`'s `unit` job gains a vitest run. Use the repo's existing
   `scripts/run-vitest-stable.mjs`, which shards and serializes to survive embedded-Postgres
   contention — do not call raw `vitest run` across the workspace.
2. A second step runs `discord-bridge`'s own suite: `cd discord-bridge && npm ci && npm test`.
   It is not a pnpm-workspace member (`pnpm-workspace.yaml` lists `packages/*`,
   `packages/adapters/*`, `packages/plugins/*`, `server`, `ui`, `cli`) and carries its own
   `package-lock.json`, so step 1 will never reach it.
3. Both are required for merge, on the same footing as the existing checks.
- **Pipeline change:** own branch, label `ci`, human review, no application code (CLAUDE.md).
  Changes no pipeline contract — no `/api/health`, Dockerfile, build args, ports, or compose
  service names.
- Interim rule until this lands: "`t3-ci` green" is evidence of nothing. PR authors paste local
  test output in the PR body, and the reviewer reads it.
- Verify: the workflow's own run on the PR, showing a vitest summary.

**F-VERB-0 — Canonical Vietnamese phrase table.** One checked-in artifact: verb → canonical
phrase + accepted aliases, imported by **both** the agent system prompt and the error-message
templates. Includes a help verb (`trợ giúp`) returning the table, and the bot's 4-line
Vietnamese first message to a newly linked engineer. It is also PC-003's quickstart appendix.
**Build this first in Lane C** — F-001-2, F-CAP-*, F-003-4 and every error template import it,
and a phrase invented independently in any of them is a bug that reaches the engineer.
- Tests: every phrase key referenced anywhere in the codebase resolves in the table (a
  reference check, so a rename cannot silently orphan a message).

**F-DM-2 — Discord DM surface.** Honest sizing: **a real feature, not glue.** The shipped
bridge (~718 lines) has no message handler, DM path, or media path. This unit adds the
message-content/DM privileged intent (G-2), a DM handler, a **DM auth gate** (DMs from
unlinked Discord users are ignored — anyone can DM a bot), a media fetch path with a
content-type allowlist, and its own DM-surface tests.
- Files: `discord-bridge/src/` (new `lib/dmHandler.ts`, `lib/media.ts`), bridge↔server
  contracts in `server/src/routes/integrations/discord*`.
- Tests: unlinked DM ignored; linked DM routed; oversize/wrong-type media rejected before the
  evidence bucket; existing slash-command behaviour unaffected (regression).
- Note: Discord uses a gateway, not a webhook — so the webhook-signature hardening in backlog
  op AC1 does **not** apply to the pilot. Its channel-generic intent is met here by the DM
  auth gate. The signature work activates with the later WhatsApp WP.

**F-DM-3 — Inbound persistence + replay.** The bridge persists inbound messages independently
of agent availability and replays on recovery. Downtime > 15 min sends one automated
Vietnamese status message per affected engineer. A failed capture **clears its idempotency
fingerprint** so an engineer's resend is never dropped as a duplicate. Pilot-day downtime is
logged so the band call can discount it.
- Tests: agent down → message persisted → agent up → capture completes exactly once; the
  fingerprint-clear path proven by a resend-after-failure test.

**F-CAP-1 — Capture pipeline.** Deterministic bridge-side pipeline with **exactly one
bounded, schema-constrained LLM call** producing `{card, evidence_type, caption}`. Full
`eng-<name>` agent sessions (`max_turns=150`) are reserved for re-brief and clarification —
a photo must never spin an agent loop (cost, latency, head-of-line blocking at 17-staff
scale). **Message pairing:** a media message and a following text from the same sender within
a short window form ONE capture (photo first, caption next — the common field pattern). An
engineer with zero open cards routes to the triage card explicitly. Confirms in one
Vietnamese line. Captured content is filed **verbatim Vietnamese**; the agent may add an
English one-line gloss.
- Tests: pairing window (paired / just outside the window / caption-first); zero-open-cards →
  triage; one LLM call per capture asserted (a guard against silent regression to an agent
  loop).

**F-CAP-2 — Capture fallback.** Malformed, empty, or refusing structuring output → re-prompt
once → file the raw message as an unstructured capture on a triage-labelled card and tell the
engineer in one line. **The same path also covers provider-unavailable** — network failure,
outage, quota, or auth error — which is a different failure from bad output with the same
user cost: the photo vanishes (review finding 1.7). On that path the idempotency fingerprint
is **not** consumed, so a resend still works (the F-DM-3 rule).
- Tests: each of malformed / empty / refusal / provider-down lands on the triage card with a
  reply; the provider-down case leaves the fingerprint clear. **Capture is never silently lost.**

**F-CAP-3 — Server-side write-target validation.** Whatever the LLM output names, the write
target is validated against PC-003 AC2 scoping (assignee or creator) and the F-010-2 allowlist
**before any write**. An injected *"file to card #999"* fails at the API, not in the prompt.
Message content is data, never instructions — enforced server-side, not prompt-side.
- Tests: a capture naming another engineer's card is refused at the API layer with the agent
  prompt stubbed out entirely (proving the control is not the prompt).

**F-CAP-4 — Vietnamese eval suite.** Checked-in eval set on real-shaped Vietnamese messages:
diacritics, emoji-only, photo-with-caption, photo-then-caption-seconds-later,
forwarded-of-forwarded, adversarial injection. **Passing bar ≥90% correct-card matching
before pilot start**; gates all prompt changes. Live mis-file rate tracked so a 50–79% band
outcome is diagnosable as *channel* problem vs *accuracy* problem.

**F-CAP-5 — Wrong-card correction reply.** "wrong card? reply the number" → re-file, with a
dossier correction line via F-007-5. Out-of-range replies answered, not ignored.

**F-BRIEF-1 — Re-brief verb.** On-demand (`brief` / VN phrase) and proactive at task
checkout via the existing heartbeats/wakeups event triggers. Returns: current card, open
evidence gaps, next task. This is the highest-value verb per the cross-model read — the
re-brief is the unbuilt feature with observed demand.
- Tests: gaps list matches the gate's own count query (one source of truth, not a second
  implementation of "what counts as evidence").

**F-DIGEST-1 — PM digest.** Daily DM to PM and CTO: evidence filed, cards blocked on missing
evidence, the bot/manual ratio (F-011-3), and per-pilot-week bot spend. **G-1 gates this
unit** — the PM observation session defines what the digest must contain; building it first
means guessing at the one artifact meant to make her the champion.

**F-DIGEST-2 — Digest reliability.** An empty day still sends a one-line "no evidence filed
today" so absence is visible. Delivery failure raises an operator alert — a silently missing
digest is exactly the failure mode that recreates the PM's manual summary.

### B.4 Lane D — export and pilot card

| ID | Feature | Depends on | Effort |
|---|---|---|---|
| F-006-1 | WP-close export bundle generator | F-002-3, F-011-3 | human: 3d / CC: 2h |
| F-006-2 | Commit to T3-wiki + CTO notification | F-006-1 | human: 1d / CC: 1h |
| F-006-3 | Example bundle fixture | F-006-1 | human: 4h / CC: 30m |
| F-402-1 | Brief required before `in_progress` | — | human: 1d / CC: 1h |
| F-402-2 | Commit auto-link from `PC-xxx` branches | F-007-3 | human: 1d / CC: 1h |
| F-402-3 | Close requires commit + demo + test report | F-007-1 | human: 1d / CC: 1h |

**F-006-1** — closing a parent issue labelled `WP` generates a markdown bundle: per-card
dossier, activity summary, evidence index (links, hashes, counts), scope-change timeline, and
the bot/manual ratio. Refuses while any child is neither `done` nor `cancelled`.
**F-006-2** — bundle committed to `Tecotec-JSc/T3-wiki`; confidential content is NAS path
references only, never bytes (AD-026); CTO notified in chat with the commit link within 24h.
**F-006-3** — one example bundle checked in; the CTO retrieval test runs against this shape.
**F-402-1/2/3** — the pilot card type. `in_progress` blocked without a linked brief
(flowchart / REQ spec / PUC reference); commits on `PC-xxx` branches auto-link as evidence;
close requires ≥1 commit + demo + test report.
**F-402-1 is implemented at the same commit-point choke as PC-001's evidence gate** — the
row-locked transaction in `issueService.update()` (`server/src/services/issues.ts:7842-7940`)
— as a second transition rule in the same place, with the same feature-flag treatment and the
same all-transition-paths test discipline. A separate hook would re-fragment exactly what #40
unified, and the second implementation would drift (review finding 1.4).

### B.5 Lane E — onboarding, ops, pilot instrumentation

| ID | Feature | Depends on | Effort |
|---|---|---|---|
| F-003-1 | `eng-<name>` profile + identity mapping + scoping | — | human: 3d / CC: 2h |
| F-003-2 | Environment pre-provisioning runbook | G-2 | human: 4h / CC: 30m |
| F-003-3 | Per-engineer runbook + timed dry-run | F-003-1, F-DM-2 | human: 4h / CC: 30m |
| F-003-4 | Vietnamese engineer quickstart (1 page) | F-VERB-0 | human: 3h / CC: 20m |
| F-OPS-1 | `doc/WP0-OPERATIONS.md` runbook home | F-DM-2, F-010-1 | human: 1d / CC: 1h |
| F-OPS-2 | Alert routing + adoption-drop alarm | F-DM-2 | human: 1d / CC: 1h |
| F-OPS-3 | LLM/bot spend cap under budgets | F-CAP-1 | human: 1d / CC: 1h |
| F-PILOT-1 | Band-call query + min-n guard | F-011-3 | human: 4h / CC: 30m |
| F-PILOT-2 | CTO retrieval test protocol + recorded result | F-006-3 | human: 4h / CC: 20m |
| F-PILOT-3 | PM engagement signal tracking | F-DIGEST-1 | human: 4h / CC: 30m |
| ~~F-012-1~~ | _moved to Lane A and promoted to P1 — review finding 1.2_ | — | — |

**F-003-1** — hermes profile `eng-<name>` registered through the existing `hermes-gateway`
adapter as an `agents` row; Discord user ↔ Paperclip user mapping; the agent acts **only** on
cards where that engineer is assignee or creator; `max_turns` 150 (AD-037). The hermes join
flow's board-approval step is pre-approved/batched for `eng-*` profiles so onboarding cannot
stall on an absent approver.
**F-003-2** — one-time environment setup (Discord bot app, privileged intents, token secret,
Hermes gateway, secrets), **explicitly outside the 30-minute clock**.
**F-003-3** — numbered per-engineer steps; acceptance evidence is a **timed dry-run on a fresh
engineer** recorded next to `pc003_onboarding_minutes`. Clock starts at "engineer's Discord
account known", stops at "first capture confirmed". Target ≤30 min.
**F-003-4** — ~5-minute Vietnamese one-pager: link your Discord, DM the bot a job order, type
"brief". Phrase table (F-VERB-0) is its appendix.
**F-OPS-1** — one named home for every WP-0 runbook: Discord gateway outage/disconnect,
Discord-account relink, media-fetch failure, agent-runtime-down, MinIO/NAS outage, Teable
outage during mirror, digest-alert response, secrets rotation. The engineer's realistic manual
fallback ("hand it to the PM", who files via UI with `source=manual`) is **written down, not
implicit**.
**F-OPS-2** — all operator alerts (digest failure, adoption drop, gateway error-rate) land in
one channel the maintainer demonstrably watches daily. The digest-failure alert is tested
end-to-end (fires → seen) **before** pilot start. An alert to an unwatched channel is a silent
failure in costume.
**F-OPS-3** — bot LLM/channel spend runs under the existing budgets subsystem with a hard cap
and alarm; per-pilot-week cost reported in the digest.
**F-PILOT-1** — band call is mechanical: ≥80% pass / 50–79% iterate / <50% abort, with a
**minimum n of 15** evidence items (below that, extend the window rather than call the band)
and pilot-day downtime discounted. **The n counts `bot` + `manual` rows only — `system` rows
(auto-linked commits) are excluded** (gate decision UC-1). Before the pilot starts, sanity-check
against a recent week of `PC-402`-shaped work that 15 non-commit evidence items plausibly occur;
if they do not, the band is uncallable and the pilot needs a second card type or a longer window.
**F-PILOT-2** — at pilot end the CTO answers 3 real questions from dossiers and the WP-close
export alone. Records that cannot be retrieved and used are not institutional memory — this is
the actual value test, distinct from the adoption metric.
**F-PILOT-3** — PM reads/acts on the digest ≥4 of 5 pilot days. Championship is tested, not
assumed.
**F-012-1** — PC-012's executable ACs: export/import round-trip test over the new objects, and
the no-hardcoded-company-id CI check.

### B.6 Branch and PR protocol for implementing agents

**A contradiction to resolve before the first issue is filed.** Two repo documents disagree:

| Source | Rule |
|---|---|
| `CLAUDE.md` (CI/CD section) | Branch `feature/*` **from `develop`**; PR into `develop`; squash-merge; never push to `main`; `main` advances only by PR from `develop` |
| `backlog.md` line 10 | "work lands on main" |
| `backlog.md` line 39 | "Branches for a story are named `PC-xxx-*`" |

`develop` exists on origin and is 7 commits ahead of `main`; the branch-protection rules are
real. The CI/CD section is the newer and harder constraint. But `PC-007 AC2` and `F-402-2`
auto-link commits from branches matching `PC-xxx` — under a bare `feature/<topic>` name the
auto-linker matches nothing, so the evidence trail the whole product is about silently stops
working on its own repo.

**Resolution (recommended):**
1. Branch name is `feature/PC-xxx-<slug>` — satisfies the `feature/*` prefix rule **and**
   carries the story id.
2. The auto-linker matches `PC-\d{3}` **anywhere** in the branch name (F-007-3 test covers
   both shapes).
3. `backlog.md` lines 10 and 39 are corrected to the develop flow in the same PR that folds
   Part A into the backlog.

**Work in a worktree, never in the shared checkout.** During this review another session ran
`git stash -u` on the primary checkout and switched branches, sweeping in-flight work — and
this plan file — into a stash. `git reflog` shows five branch switches on that checkout in a
short window. CLAUDE.md already forbids in-place work on the shared automation checkout; the
same hazard is live locally. With five parallel lanes a worktree per unit was already the
right shape, and it is now also a data-safety requirement.

**PR batching and merge authority.** 52 units at one PR each, into a protected `develop`,
reviewed by one human who cannot self-merge, is ~13 working days of review alone. Units that
touch the same files ship as one PR:

| PR | Units |
|---|---|
| substrate | F-000, F-012-1, F-011-1, F-007-1, F-007-5, F-011-2 |
| providers | F-007-2, F-007-3, F-007-4 |
| dossier | F-002-1, F-002-2 |
| capture | F-CAP-1, F-CAP-2, F-CAP-3, F-CAP-4, F-CAP-5 |
| intake | F-004-1, F-004-2, F-004-3 |

That turns ~52 units into ~20 PRs. The maintainer merges; **agents never self-merge**; a unit
counts as done at PR-open, so lane progress is never blocked on review latency.

Working protocol for an implementing agent, per feature unit:

1. Set up an isolated worktree — **all three commands, in order**:
   ```sh
   git fetch origin
   git worktree add "$(git rev-parse --show-toplevel)/../t3-PC-xxx-<slug>"        -b feature/PC-xxx-<slug> origin/develop
   cd "$(git rev-parse --show-toplevel)/../t3-PC-xxx-<slug>" && pnpm install
   npx paperclipai worktree init --from-config ~/.paperclip/instances/default/config.json   # REQUIRED
   pnpm paperclipai worktree env                   # confirm it came up
   ```
   Three corrections over the obvious version, each verified: **`paperclipai` is not on PATH**
   (`command -v paperclipai` → nothing) — use `npx paperclipai` for the content-bearing
   `--from-config <path>` argument (`doc/CLI.md`), not `pnpm paperclipai`. **Manual worktrees must
   pass `--from-config`** (`doc/DEVELOPING.md:489`). And the path is anchored to the repo root,
   because a bare `../t3-…` resolves against the current directory and lands in the wrong place
   when you are already inside a worktree.
   The init step is not optional: `pnpm dev` **fails fast** in a linked worktree when
   `.paperclip/.env` is missing (`doc/DEVELOPING.md:479`), and it is what gives the worktree its
   own embedded Postgres instance. Two servers must never share one data directory. The
   `worktree env` line is the health check — do not start implementing until it answers.
   **Inside `discord-bridge/`, use npm, not pnpm** — it is not a pnpm-workspace member and
   carries its own `package-lock.json` (ENG-1). Lanes may be *open* in parallel, but run at most
   **two** lanes' server test suites concurrently on one machine: each worktree carries its own
   embedded Postgres, and `pnpm test` is deliberately serialized for exactly that reason (ENG-7).
2. **Branch base when a dependency is still an open PR.** A unit counts as done at PR-open, so
   your dependency's code may not be on `develop` yet. If its PR is open and unmerged, branch
   from **that branch** instead of `origin/develop`, write "stacked on #NNN" in your PR body,
   and rebase onto `develop` once the dependency merges. If the dependency is already merged,
   branch from `develop` as normal.
3. Implement the unit **with its tests in the same commit** — not after.
4. Run the unit's own `Verify:` command. Run `pnpm -r typecheck && pnpm test:run && pnpm build`
   before hand-off, or when the change is broad. `pnpm check:token-gates` for F-002-5.
4. Fill `.github/PULL_REQUEST_TEMPLATE.md` in full, including Thinking Path and Model Used.
5. PR into `develop`. **Do not merge your own PR.** Never tag, never approve environments.
6. Pipeline files (`.github/workflows/`, `deploy/`) never share a PR with application code.
7. Do **not** edit `backlog.md`. Its Filing-status table is keyed by story, has no row shape
   for a feature unit, and ~20 PRs appending to one 3-column table conflicts on every rebase.
   The maintainer updates it at merge time. (F-000's own steps already treat backlog edits as a
   separate SSoT PR; this makes the rule consistent.)

**Definition of done for a feature unit:** ACs met · tests written with the code and green ·
**`t3-ci / unit`, `t3-ci / build` and `t3-ci / build-image` all green** (CLAUDE.md:205 requires
three, not two) · no files touched outside the unit's scope ·
PR body states what was verified · `backlog.md` filing row updated.

### B.7 Sequencing

```
day 0   G-1 PM observation ─┐   G-2 Discord intent request ─────────────┐ (external, days-weeks)
                            │   G-3 digest recipients ──┐               │
LANE A  F-000 recover ─▶ F-012-1 portability ─▶ F-011-1 ─▶ F-007-1 ─┐   │
              └▶ F-007-2/3/4 ─▶ F-011-2 ─▶ F-011-3                  │   │
              └▶ F-002-1 ─▶ F-002-2 ─▶ F-002-3/4/5 ; F-007-5 ; F-001-1/2 │
LANE B  F-010-1 → F-010-2/3 → F-005-1                                   │
LANE C  F-VERB-0 ──────────────────────────────────────────────────────▶F-DM-2 → F-DM-3
                                     → F-004-1 → F-004-2/3
                                     → F-CAP-1 → F-CAP-2/3/4/5
                                     → F-BRIEF-1
                                        (needs F-011-3 + G-1/G-3) → F-DIGEST-1 → F-DIGEST-2
LANE D  F-402-1 (rides A's choke point) ; (after F-002-3 + F-011-3) F-006-1 → F-006-2/3 ; F-402-2/3
LANE E  F-003-1 → F-003-3 ; F-003-2 ; F-003-4 ; F-OPS-1/2/3 ; F-PILOT-1/2/3
```

**F-000 and F-012-1 come before everything.** F-000 because 966 lines of matching work are in
a stash that another session could drop; F-012-1 because company export is dropping evidence
links today, and four more schema objects are queued to land on top of that bug.

Lanes A and B both touch `server/src/services/` — different modules, but keep them in
separate worktrees and coordinate, or sequence B behind A's first two units.

**Critical path:** `G-2` (external approval) → `F-DM-2` → `F-CAP-1` → pilot start. Lane A can
run to completion inside G-2's lead time, which is why it starts first and why G-2 is filed on
day 0.

**Pilot-start gate:** F-VERB-0, F-DM-2/3, F-004-1..3, F-CAP-1..5 (with F-CAP-4 at ≥90%),
F-BRIEF-1, F-DIGEST-1/2, F-003-1..4, F-OPS-1/2/3, F-PILOT-1, plus Lane A complete and F-010-2
for verb 4. F-006-* and F-402-* may land during the pilot week. **F-000 and F-012-1 gate
everything else in Lane A** and must land before any further schema object ships.

---

## Open items carried into this plan

- **OQ-1..OQ-5** from `backlog.md` — unchanged, none block Slice 1.
- **C13** — re-decided: Discord-only pilot. The post-pilot channel comparison (WhatsApp vs
  Zalo OA) is a recorded input to the deferred WhatsApp WP, not a Slice 1 item.
- **gbrain depth** (PC-014) — memory source vs full knowledge plane. Blocks PC-014 only.
- **Skill repo mechanics** (PC-016) — needs its own spec.
- **Identity doctrine sentence** in `roadmap.md` — owner edit, still open in TODOS.md.

---

# /autoplan review addendum (2026-09-02) — feature decomposition

Scope reviewed: this file (Part A + Part B). Mode: SELECTIVE EXPANSION (autoplan override).
Codex CLI not installed → all outside voices are Claude subagents, tagged `[subagent-only]`.

## Phase 1 — CEO Review

### Pre-review system audit

| Signal | Finding |
|---|---|
| Branches | `origin/develop` exists, 7 ahead of `main`; `main` 2 ahead of `develop`. Dependabot targets `develop`. The CI/CD branch flow in CLAUDE.md is live, not aspirational. |
| **Stash (evidence work)** | **"On develop: WIP evidence-gate work" — 966 insertions across `backlog.md` (+794), `issue_attachments.ts`, `issue_evidence_links.ts`, `server/src/routes/issues.ts` (+178), migration journal.** See finding 1.1. |
| **Concurrent session** | **Another session stashed this working tree and switched branches mid-review** (`chore/hard-fork-remove-upstream-release` → `fix/decouple-tests-from-deleted-workflows`), sweeping the CICD work and this plan file into a `-u` stash. See finding 1.8. |
| Hottest file | `server/src/routes/issues.ts` — 37 touches in 30 days, the most-modified file in the repo. Lane A adds 178 more lines to it. |
| TODO/FIXME | None in `server/src/services`, `server/src/routes`, `packages/db/src/schema`, `discord-bridge/src`. |
| TODOS.md | 4 open items; 2 (WhatsApp WP, identity doctrine sentence) bound this plan's edges, neither blocks it. |
| Prior reviews | /autoplan CEO+DX+Eng on WP-0 (2026-09-01), Final Gate + coherence re-run (2026-09-02). Those decisions are settled and are **not** re-litigated here. |

### 0A. Premise challenge

The design record's five premises were cross-model challenged in `/office-hours` and settled
at the 2026-09-02 gate. Not reopened. These are **this plan's own** premises:

| # | Premise | Verdict |
|---|---|---|
| P-a | The PC-xxx story specs are ready to decompose | **Holds** — two review passes gave them ACs and code-verified bindings. One exception: PC-004 (job-order intake) got no feature units. See 1.3. |
| P-b | One feature unit = one issue = one branch = one PR | **Holds mechanically, strains socially.** 52 PRs into `develop`, one human reviewer, and CLAUDE.md forbids self-merge. See 1.5. |
| P-c | The pilot needs all of Slice 1 | **Assumed, not argued here** — inherited from the design record's staging decision and the 2026-09-02 gate. Queued for the outside voice rather than auto-reversed. |
| P-d | `develop` is the integration branch for this work | **Verified** — and it contradicts `backlog.md` lines 10/39. Resolved in §B.6. |
| P-e | PC-001 is shipped | **Verified in code**, with three residual AC gaps named in the current-state table. |
| P-f | **Lane A starts from zero** | **FALSE, twice over.** First correction (stash) was itself wrong; see 1.1-CORRECTED. ~7 human-days of the plan's Lane A and Lane C work is already written and pushed on `feature/evidence-substrate`. |
| P-g | **This repo checkout is exclusively ours to write to** | **FALSE.** Corrected by finding 1.8. |

Nothing reaches "clearly wrong premise" except P-f and P-g, which are factual corrections
rather than judgment calls, so they are fixed in place rather than queued to the gate.

### 0B. Existing code leverage — every claim probed

| Sub-problem | Existing code | Reused? |
|---|---|---|
| Evidence-link write path | **`origin/feature/evidence-substrate`** — `GET/POST/DELETE /issues/:id/evidence-links` + `/move`, `issue-evidence-links.ts` (493), company scoping through the existing `getAccessibleResource`, 980 lines of tests | **Yes — open a PR for it; do not rewrite** |
| Provenance columns | **same stash** — `source text NOT NULL DEFAULT 'manual'` on both evidence tables, shared `EVIDENCE_SOURCES` union (= F-011-1); `source` derived from `getActorInfo().actorType` (= core of F-011-2) | **Yes** |
| Done-transition choke point | `server/src/services/issues.ts:7842-7940`, row-locked txn | Yes — F-402-1 must use it, not a second hook (1.4) |
| Intake idempotency | `issue_create_idempotency_keys` (`packages/db/src/schema/index.ts:77`, used at `issues.ts:7117`) | Yes — PC-004 AC4; do not build a second fingerprint store |
| Dossier storage | `issue_documents` free-text `key` | Yes — no schema change |
| Proactive re-brief trigger | heartbeat wakeup events incl. `issue_comment_mentioned` (`heartbeat.ts:758`) | Yes — F-BRIEF-1 |
| Secrets | server secrets service, named refs | Yes — Discord token, Teable creds |
| Spend governor | `server/src/services/budgets.ts` | Yes — F-OPS-3 |
| **Company export/import** | `company-portability.ts` (6381 lines), `export-fidelity.ts`, `packages/shared/src/types/company-portability.ts`, 4 test files | **Yes — and it has a live gap. See 1.2.** |
| Chat transport | `discord-bridge/` slash-command + outbox | Partly — transport yes, capture no |
| Teable client | none | New build |
| `external_object_mentions` | exists | **No** — `SET NULL` detector semantics, wrong ledger for a gate. Settled 2026-09-02. |

### 0C. Dream state delta

```
CURRENT                          THIS PLAN                       12-MONTH IDEAL
Gate shipped but unsatisfiable   Every Slice-1 story broken   →  Every phase pre-sales→FAT
via links (no write path);   →   into issue-sized units with     evidence-gated; Teable the
provenance unbuilt; capture      bindings, tests, DoD; the       records GUI; gbrain re-briefs;
unshipped on every channel;      portability floor made          self-dev loop measured; the
966 lines stranded in a stash    executable; work sequenced      OS exports and travels
                                 against real external lead time
```
The plan converts settled specs into executable work and closes one live silent failure
(1.2) on the way. It moves toward the ideal. Its risk is throughput, not direction.

### 0C-bis. Implementation alternatives

```
APPROACH A: Story-level tickets only
  Summary: File the 12 Slice-1 PC-xxx stories as GitHub issues; let the implementing
           agent decompose each one at pickup time.
  Effort:  S   (human: ~2h / CC: ~15min)
  Risk:    High
  Pros:    Fastest to start; nothing to keep in sync; agent holds full story context
  Cons:    Every agent re-derives sequencing; the G-2 external lead time gets discovered
           late; cross-story dependencies (F-VERB-0 is imported by five things) stay
           invisible; "one PR per story" means a one-week PR
  Reuses:  backlog.md as-is
  Completeness: 4/10

APPROACH B: Feature decomposition of Slice 1 only
  Summary: Part B without Part A — units, lanes, DoD, branch protocol. No new stories.
  Effort:  M   (human: ~1d / CC: ~1h)
  Risk:    Med
  Pros:    Directly actionable; dependencies explicit; critical path named
  Cons:    Leaves the roadmap's fourth persona (founder-as-portable-operator) with no
           story — and 1.2 shows that gap is already costing something real
  Reuses:  backlog.md story specs
  Completeness: 8/10

APPROACH C: Feature decomposition + roadmap completeness pass  (CHOSEN)
  Summary: Part A (persona/story coverage, PC-012..016) + Part B (52 units, 5 lanes).
  Effort:  M   (human: ~1.5d / CC: ~1.5h)
  Risk:    Med
  Pros:    Closes the persona gap; PC-012 turns out to be load-bearing on Slice 1's own
           migrations rather than future work; NEXT-horizon prose gets traceable IDs
  Cons:    Two new stories to carry; PC-013 competes with the pilot for maintainer time
           (mitigated: PC-013 sits in Slice 2, not Slice 1)
  Reuses:  backlog.md, company-portability + export-fidelity services
  Completeness: 10/10
```

**RECOMMENDATION: C.** Completeness (P1) plus one hard fact: the portability gap Part A was
written to prevent has already happened once, in the single migration Slice 1 has shipped so
far. A plan that adds four more schema objects without closing it repeats the failure four
more times.
→ **Auto-decided: C** (mechanical — highest completeness, and the gap is evidenced, not hypothetical).

### 0D. SELECTIVE EXPANSION analysis

**Complexity check.** One document, but it specifies work across ~40 files and 5 lanes. The
smell is real; the mitigations are the lane structure, one-unit-one-PR, and the explicit
dependency graph. Held.

**Minimum set that achieves the stated goal.** Strictly, the wedge question ("does evidence
arrive via the bot instead of via the PM") is answerable with F-000, F-007-2, F-011-2/3,
F-DM-2, F-CAP-1/2/4, F-003-1/3, F-PILOT-1 — about 12 units. Re-brief, digest, Teable,
export, and the dossier are not needed to answer it. This is the sharpest scope question in
the review, and it targets a decision the owner already made at the 2026-09-02 gate
(substrate-first, four verbs inside Slice 1). Not auto-reversed — **queued for the outside
voice**, and surfaced at the Final Gate only if the voice reaches it independently.

**Cherry-pick ceremony** (auto-decided per /autoplan principles):

| # | Expansion candidate | Effort | Decision | Why |
|---|---|---|---|---|
| E1 | F-000 stash-recovery unit at the head of Lane A | S | **ACCEPTED** | Not an expansion, a correction. 966 lines of matching work already exists (1.1) |
| E2 | PC-004 feature units (F-004-1..3) | M | **ACCEPTED** | Gap in this plan, not new scope. In blast radius, <1d CC (P2) |
| E3 | Retarget F-012-1 to the portability manifest + a registration test | M | **ACCEPTED** | Closes a live silent failure and prevents recurrence (1.2). P1 |
| E4 | F-402-1 rides the existing done-transition choke point | S | **ACCEPTED** | DRY (P4) — a second transition gate re-fragments what PC-001 unified |
| E5 | Batch file-sharing units into single PRs; name merge authority | S | **ACCEPTED** | Review throughput is the real constraint (1.5). In radius, cheap |
| E6 | Evidence-link API is the single write path for UI **and** bot | S | **ACCEPTED** | One path means provenance cannot diverge. Folded into F-007-1 |
| E7 | Dossier fixture doubles as the Vietnamese eval-suite seed | S | **ACCEPTED** | Two consumers, one artifact (P4). Folded into F-CAP-4 |
| E8 | Phrase table (F-VERB-0) generalized into an i18n surface for all engineer-facing messages | M | **TASTE → gate** | 3-5 files, borderline blast radius; useful but not needed by the pilot |
| E9 | `paperclipai next-unit` CLI printing the next unblocked feature unit | M | **DEFERRED → TODOS** | Outside blast radius; agent ergonomics, not the wedge |
| E10 | F-005-1 mirror watermark + `created_at` index for the provenance query | S | **DEFERRED → TODOS** | Invisible at pilot scale; triggers stated (7.1, 7.2) |

**Lake Score: 9/10 recommendations chose the complete option** (E10 deferred on measured
irrelevance at pilot scale, not on effort).

### 0E. Temporal interrogation

```
HOUR 1  (foundations)   Does Lane A start from the stash or from develop? → 1.1, answered.
                        Which branch does the first PR target? → §B.6, answered.
                        Where does EVIDENCE_SOURCES live: db schema or shared? → 5.1.
                        Is this checkout safe to write to? → 1.8, it is not.
HOUR 2-3 (core logic)   What does the gate do when evidence is unlinked from a DONE card?
                        → 4.2, was unanswered. Now answered.
                        Does the media dedupe hash scope per company? → 3.2, now answered.
HOUR 4-5 (integration)  Is the Discord privileged intent approved yet? → G-2, external,
                        which is why it is filed on day 0.
                        Does export carry the new tables? → 1.2, it does not. Now scoped.
HOUR 6+  (polish/tests) Who reviews 52 PRs? → 1.5, now answered.
                        What happens to capture when the LLM provider is down, as opposed
                        to returning junk? → 1.7, was unrescued. Now rescued.
```
Human hours above; with CC the same decisions arrive in roughly 30-60 minutes. The decisions
are identical — only the clock changes.

### 0F. Mode

**SELECTIVE EXPANSION** (autoplan override). Approach C. Committed.

### Section 1 — Architecture

**1.1-CORRECTED — HIGH — Lane A does not start from zero. The work is a pushed branch, not a
stash, and this review got it wrong the first time.**

*Original finding (superseded):* "966 lines are stranded in a stash; recover them before a
`git stash drop` loses them." That was built on reading `stash@{1}`'s five **tracked** files
and never checking its untracked tree — and, more importantly, on not opening
`feature/evidence-substrate`, which `git branch -a` had listed from the start with a `+`
marker (checked out in another worktree). The Phase 3 outside voice caught it.

*Corrected:* `origin/feature/evidence-substrate` is a pushed branch, **+4,885 lines across 19
files in 5 clean commits**, with **no PR open**. It contains working, tested implementations of
what this plan specified as six separate greenfield units — see F-000's table. The stash holds
roughly 195 lines of superseded draft plus a 794-line `backlog.md` hunk; it is not the
substrate.

The urgency argument inverts too. The risk was never "a stash could be dropped" — pushed
commits are safe. The real risk is **duplication**: an agent handed the original F-000 would
have created a second, divergent implementation of six units, and the plan's own
current-state table would have told it that was correct.

→ **Decision:** F-000 becomes "open a PR for `feature/evidence-substrate`". Nine units
re-scope from build to review. Lane A's critical path is re-derived from what that branch
leaves undone. And the general lesson, written into the plan rather than just fixed:
**a current-state table is only as good as `git branch -a` plus a diff against every branch
it lists** — this one was assembled from `develop` and a stash, and was wrong about five rows.

**1.2 — CRITICAL GAP (silent failure, already live) — company export drops evidence links.**
Company portability is driven by an **enumerated manifest**, not a generic table walk:
`packages/shared/src/types/company-portability.ts` defines per-entity manifest types (e.g.
`CompanyPortabilityIssueAttachmentManifestEntry`), and `company-portability.ts` normalizes
each one explicitly (`normalizePortableIssueAttachments`, line 1117).
`export-fidelity.ts:23-45` counts labels, issue labels, relations, documents, work products,
attachments, approvals, cost events, activity log, and monitors per company, to build the
fidelity report that is supposed to catch exactly this class of bug.
`issue_evidence_links` shipped in #40. It appears in **none** of them (grep count: 0 in
`company-portability.ts`, 0 in `export-fidelity.ts`).
Consequence, today, on `develop`: export a company and every evidence link is dropped.
Import into a fresh company and cards that passed the evidence gate now hold zero evidence;
the gate re-blocks them on any re-close, and the WP-close export's evidence index is wrong.
**And the fidelity report says clean**, because it does not count the table. The mechanism
built to make this visible is the mechanism hiding it.
This is the decay PC-012 was written to predict — it already happened, in the one migration
Slice 1 has shipped so far, and four more schema objects are queued behind it (`source` ×2,
three `external_objects` providers, the `dossier` document key).
→ **Decision:** F-012-1 is retargeted and promoted to **P1**, landing in Lane A right after
F-000 rather than in Lane E: (a) add the `issue_evidence_links` manifest entry, normalizer,
and import path; (b) add its count to `collectExportFidelityCounts`; (c) add a
**registration test** that enumerates schema exports from `packages/db/src/schema/index.ts`
and fails the build for any table absent from both the portability manifest and an explicit
exclusion list. (c) is the root-cause fix — one guard where every future table routes
through, instead of a habit nobody will keep.

**1.3 — HIGH — PC-004 (job-order intake) has no feature units.** Part B decomposes
PC-001/002/003/005/006/007/010/011/402 and the WP-0 verbs, but PC-004 — the story that turns
a forwarded job order into a card, the *entry point of the whole recorder loop* — is covered
only implicitly by F-CAP-1. Two of its four ACs describe behaviour F-CAP-1 does not carry:
the agent asking clarifying questions with answers landing in the dossier, and the
confidential-content refusal.
→ **Decision:** add **F-004-1** (forwarded message → issue with title, description, seeded
dossier, assignee, project resolution or triage label; idempotency via the existing
`issue_create_idempotency_keys`), **F-004-2** (clarifying-question turn → answers appended to
dossier Clarifications; this is the one verb that legitimately spins a full `eng-<name>`
agent session, unlike capture), and **F-004-3** (confidential-content refusal with NAS
drop-folder instructions, storing nothing — AD-021/C16, and the one AC whose regression is a
disclosure rather than a bug).

**1.4 — MEDIUM — F-402-1 would add a second transition gate.** PC-001's architectural point
was one choke point: the evidence count and the status write inside a single row-locked
transaction in `issueService.update()`. F-402-1 ("cannot enter `in_progress` without a linked
brief") is the same shape of rule at a different transition. Specifying it as its own hook
re-fragments what #40 unified, and the second implementation will drift from the first.
→ **Decision:** F-402-1 is implemented **at the same commit-point choke** as the evidence
gate, as a second transition rule in the same place, with the same feature-flag treatment and
the same all-done-producing-paths test discipline.

**1.5 — MEDIUM/HIGH — review throughput is the plan's real bottleneck.** 52 units × one PR
each, into a protected `develop`, with CLAUDE.md's "Do not merge your own PR" and one human
maintainer. At a generous four PR reviews a day that is 13 working days of review alone,
serialized against a pilot whose external dependency (G-2) may clear sooner.
→ **Decision:** (a) units touching the same files ship as one PR — explicitly:
{F-000, F-011-1, F-007-1, F-007-5, F-011-2} as the recovered-substrate PR;
{F-007-2, F-007-3, F-007-4} as the providers PR; {F-002-1, F-002-2} as the dossier PR;
{F-CAP-1..5} as the capture PR. That turns ~52 units into ~20 PRs. (b) Merge authority is
stated in the plan: the maintainer merges, agents never self-merge, and a unit counts as done
at PR-open, so lane progress is not blocked on review latency.

**1.6 — MEDIUM — the hottest file in the repo is on the critical path.**
`server/src/routes/issues.ts` took 37 commits in 30 days (most-modified file in the repo),
`server/src/services/issues.ts` took 18, and the evidence stash adds 178 lines to the former.
Lanes A and B both land in `server/src/services/`.
→ **Decision:** Lane A's substrate PR lands **first and alone** on
`server/src/routes/issues.ts`. Lane B (Teable) is a new module
(`server/src/services/teable-client.ts`) touching neither file — the lanes are genuinely
parallel once that is stated. Rebase Lane A onto `develop` before opening the PR, and again
if `develop` moves (CLAUDE.md rule).

**1.7 — MEDIUM — capture has a single point of failure the plan does not rescue.** F-CAP-1 is
one bounded LLM call, and that call *is* the capture path. F-CAP-2 rescues malformed, empty,
and refusal output. It does not rescue **provider unavailable** (network, outage, quota,
auth) — a different failure with the same user cost: the photo vanishes.
→ **Decision:** F-CAP-2's AC extends to provider-unavailable: file the raw message as an
unstructured capture on the triage card through the same path, reply in one Vietnamese line,
and do not consume the idempotency fingerprint, so a resend still works (the F-DM-3 rule).

**1.8 — HIGH (process, not code) — this checkout is shared, and it is not safe to write to.**
Mid-review, another session ran `git stash -u` and switched the branch from
`chore/hard-fork-remove-upstream-release` to `fix/decouple-tests-from-deleted-workflows`.
That swept the in-flight CICD work **and this plan file** into a stash; the file was
recovered from `stash@{0}^3`. `git reflog` shows five branch switches on this checkout in the
recent window. CLAUDE.md already forbids in-place work on the shared automation checkout and
prescribes `git worktree add`; the same hazard is live here on Windows.
→ **Decision:** the working copy of this plan lives in the session scratchpad until the owner
places it. Implementing agents get an explicit instruction in §B.6: **each feature unit runs
in its own `git worktree`, never in the shared checkout.** With 5 parallel lanes this was
already the right shape; it is now also a data-safety requirement.

**Architecture — lane dependency graph (post-amendment)**

```
                    ┌──────────────────────────────────────────┐
 G-2 Discord intent │ external approval, days-weeks            │
 (file day 0) ──────┴──────────────────────────────┐           │
                                                   ▼           ▼
 LANE A (server substrate)  ── PR1 ──▶ ── PR2 ──▶ ── PR3 ──▶  │
   F-000 recover stash ──▶ F-012-1 portability ──▶            │
   F-011-1/F-007-1/F-007-5/F-011-2 (complete recovered code)  │
        └─▶ F-007-2/3/4 providers ─▶ F-011-3 ratio query      │
        └─▶ F-002-1/2 dossier ─▶ F-002-3/4/5                  │
        └─▶ F-001-1/2 gate residue                            │
                                                              │
 LANE B (Teable, new module, no file overlap with A)          │
   F-010-1 client ─▶ F-010-2 append-only ─▶ F-010-3 read      │
                  └─▶ F-005-1 mirror cron                     │
                                                              ▼
 LANE C (verbs)  F-VERB-0 phrases ─────────────────▶ F-DM-2 DM surface
                                                       └─▶ F-DM-3 replay
   F-004-1/2/3 intake ─┬─▶ F-CAP-1 ─▶ F-CAP-2/3/4/5
                       ├─▶ F-BRIEF-1
                       └─▶ F-DIGEST-1 ─▶ F-DIGEST-2  (needs F-011-3, G-1, G-3)
 LANE D  F-402-1 (rides A's choke point) ; F-006-1/2/3 ; F-402-2/3
 LANE E  F-003-1..4 ; F-OPS-1/2/3 ; F-PILOT-1/2/3
```

**Evidence-link data flow — four paths**

```
 chat/UI input ─▶ scope check ─▶ store object ─▶ link row ─▶ dossier line ─▶ confirm
      │               │              │              │            │             │
 nil: no target   not assignee/  MinIO down:    dup (obj,card): append fails: reply fails:
 card named →     creator →      retry+backoff, no 2nd row,     link stands, link stands,
 triage card      422 refusal    then "chưa     return existing  log warning   outbox retry
 (F-CAP-1)        (F-CAP-3)      lưu được"      (idempotent)     (never block  (existing
 empty: media     cross-company:  orphan asset:  unlink on DONE   the evidence) transport)
 with no bytes →  404 not 403     GC sweep +     card → 4.2
 ask resend       (no oracle)     logged
```

### Section 2 — Error & Rescue Registry (new codepaths only)

| Codepath | What can go wrong | Exception / condition | Rescued? | Rescue action | User sees |
|---|---|---|---|---|---|
| `POST /issues/:id/evidence-links` | issue not visible to actor | 404 via `getAccessibleResource` | Y | refuse, no existence leak | "Issue not found" |
| same | duplicate (object, issue) | unique conflict | Y | return existing link, `created:false` | same confirmation |
| same | object insert ok, link insert fails | txn abort | Y | one transaction, both or neither | retryable error |
| MinIO upload | timeout / unavailable | `StorageUnavailable` | Y | retry w/ backoff, then notify | "chưa lưu được, mình sẽ thử lại" |
| MinIO upload | stored, link fails | orphan asset | **Y (new, 4.1)** | GC sweep of unlinked assets + logged | nothing |
| Media fetch (Discord) | expired URL / 404 | `MediaFetchFailed` | Y | retry, then ask resend | "gửi lại ảnh giúp mình" |
| Media fetch | wrong content-type / oversize | rejected pre-store | Y | refuse before the bucket | one-line reason |
| Git link | hash not on a fork remote | `UnverifiedCommit` | Y | refuse, never link optimistically | actionable refusal |
| LLM structuring | malformed / empty / refusal | `StructuringFailed` | Y | re-prompt once → unstructured triage capture | one-line notice |
| LLM structuring | **provider unavailable** | `ProviderUnavailable` | **Y (new, 1.7)** | same triage path, fingerprint not consumed | one-line notice |
| Capture | zero open cards for engineer | — | Y | explicit triage-card route | "chưa có thẻ mở, mình để tạm ở thẻ phân loại" |
| Capture | injected write target | scope violation | Y | server-side refusal (F-CAP-3) | refusal, prompt not consulted |
| Evidence unlink | **card is already `done`** | invariant break | **Y (new, 4.2)** | refuse; reopen first | actionable refusal |
| Discord DM | DM from unlinked user | — | Y | ignored | nothing (correct) |
| Discord gateway | disconnect | — | Y | F-DM-3 persist + replay; >15m status msg | Vietnamese status line |
| Teable write | 429 / timeout | `TeableRateLimited` | Y | backoff retry | nothing |
| Teable write | outside allowlist | `TableNotWritable` | Y | refuse whole write | actionable refusal |
| Teable mirror | Teable-side edit newer | conflict | Y | flag, never overwrite; skip bot-attributed rows | conflict comment |
| Digest cron | send failure | `DeliveryFailed` | Y | operator alert (tested e2e) | PM told via alert path |
| Digest cron | zero evidence that day | — | Y | one-line "no evidence filed today" | absence is visible |
| **Company export** | **unregistered table** | **silent drop** | **Y (new, 1.2)** | **registration test fails the build** | **red build, not silent data loss** |
| Provenance query | n < 15 | — | Y | return the count; caller applies min-n | band call deferred, not faked |

**0 unrescued GAP rows after amendment.** Three rows were unrescued on entry: orphan asset,
provider-unavailable capture, and unlink-on-done.

### Section 3 — Security & threat model

**3.1 — MED likelihood / MED impact — git commit verification is a URL-matching problem.**
F-007-3 verifies a commit "against fork remotes". A prefix or substring match on the remote
URL accepts `https://github.com/tetracilin/test_ai_todo.attacker.example/commit/...`, linking
attacker-controlled content as evidence that satisfies the gate.
→ **Decision:** parse the URL and compare **host and repository path exactly** against the
configured remotes; bare hashes resolve against the local object database rather than being
accepted as strings. One test per rejection shape.

**3.2 — MED / MED — media dedupe by SHA-256 must be company-scoped.** F-007-2 dedupes on
content hash. A global hash index becomes an existence oracle: company A learns whether
company B holds a given file by observing a dedupe hit. Company scoping is the repo's core
invariant.
→ **Decision:** the dedupe key is `(company_id, sha256)`. Content-type is **sniffed**, never
taken from the client's declared header, before the allowlist check.

**3.3 — LOW / MED — `source=bot` is actor-derived and therefore spoofable by any agent actor.**
The stashed code sets `source` from `getActorInfo().actorType === "agent"`. Any
agent-authenticated caller can inflate `wp0_evidence_via_bot` — the number the entire pilot
decision rests on. Not a data-integrity threat; a **decision**-integrity one.
→ **Decision:** accepted as-is for the pilot (the only agent actor is the engineer's own),
recorded as a known limitation, with the compensating control in 8.2.

**3.4 — LOW / LOW — the phrase table is prompt input.** F-VERB-0 is imported by the agent
system prompt. If it ever becomes DB-backed or user-editable it turns into a prompt-injection
surface with write access to the capture path.
→ **Decision:** it stays a checked-in artifact, changed only through PR. Stated in F-VERB-0's DoD.

**3.5 — examined, nothing further flagged.** DM auth gate (F-DM-2), server-side write-target
validation (F-CAP-3), secrets through named refs, and the `nas` provider carrying paths only
(F-007-4) each hold. Note that Discord uses a gateway rather than a webhook, so backlog op
AC1's signature hardening does not apply to the pilot — its channel-generic intent is carried
by the DM auth gate, and the signature work activates with the later WhatsApp WP.

### Section 4 — Data flow & interaction edge cases

**4.1 — MEDIUM — orphan assets on partial store.** F-007-2 stores then links. A crash between
the two leaves an asset with no link: invisible, billable, and indistinguishable from a
pending upload.
→ **Decision:** a GC sweep for unlinked assets past a threshold, logged, plus the ordering
statement. Folded into F-007-2.

**4.2 — MEDIUM — unlinking evidence from a `done` card silently breaks the gate's invariant.**
PC-001 closes the check-then-write race *within* a transition. It does not cover a card that
is already `done` having its last evidence link removed — which F-007-5's own correction path
can do. The card stays `done` with zero evidence, precisely the state the gate exists to
prevent, and C14 marks the reconciliation cron as MVP-only.
→ **Decision:** unlink against a `done` card is **refused** with an actionable message naming
the reopen path (explicit over clever; the alternative — allow it and surface the card on the
digest — leaves a window where the invariant is false). Folded into F-007-5, with a test.

**Interaction edge cases**

| Interaction | Edge case | Handled? | How |
|---|---|---|---|
| Photo capture | photo, then caption seconds later | Y | F-CAP-1 pairing window + eval case |
| Photo capture | caption first, photo second | Y | pairing window is order-insensitive; eval case |
| Photo capture | same photo resent after a failure | Y | F-DM-3 clears the fingerprint on failed capture |
| Photo capture | 50MB video | Y | size cap before fetch (F-DM-2) |
| Photo capture | emoji-only / no text | Y | F-CAP-4 eval case; polite ignore |
| Wrong-card reply | number out of range | Y | answered, not ignored (F-CAP-5) |
| Wrong-card reply | reply arrives after a second capture | **Gap → fixed** | the correction targets the capture id it replies to, never "the last one" |
| Evidence unlink | card already done | **Gap → fixed (4.2)** | refused + reopen path |
| Digest | zero evidence that day | Y | one-line message |
| Digest | PM's Discord unlinked mid-pilot | **Gap → fixed** | delivery failure raises the operator alert (F-DIGEST-2), never a silent skip |
| Teable mirror | row edited on both sides | Y | conflict flagged, never overwritten |
| Export | child issue neither done nor cancelled | Y | refuses (F-006-1) |
| Onboarding | board approver absent | Y | pre-approved/batched for `eng-*` (F-003-1) |

### Section 5 — Code quality

**5.1 — MEDIUM — `EVIDENCE_SOURCES` has two candidate homes.** The stashed code defines it in
`packages/db/src/schema/issue_evidence_links.ts`; this plan's F-011-1 specified
`packages/shared/src/constants.ts`. CLAUDE.md's contract chain puts cross-cutting constants
and validators in `packages/shared` so `server` and `ui` stay in sync. Two definitions drift.
→ **Decision:** the union lives **once** in `packages/shared/src/constants.ts`; the schema
imports it for its `$type<>()`. The stash's placement is corrected during F-000's recovery
review rather than left as-is.

**5.2 — examined, no further issues.** The stashed route additions use the file's existing
`getAccessibleResource` / `getActorInfo` / `validate(schema)` idioms and put logic in a
service module instead of the handler — consistent with the repo's thin-route/fat-service
split. No DRY violations against existing code, no abstraction solving an absent problem, no
new method branching past five.

### Section 6 — Test review

```
NEW CODEPATHS                                    NEW USER FLOWS
[+] evidence-link write/unlink/move              [+] Recorder loop
  ├─ [unit] company scope: 404 not 403             ├─ [E2E] job order → card → evidence
  ├─ [unit] duplicate → idempotent                 │   → done gate passes  (the 2am test)
  ├─ [unit] txn: object+link both or neither       ├─ [e2e] wrong-card correction
  ├─ [unit] unlink on DONE card refused  (4.2)     ├─ [e2e] junk card → cancelled
  └─ [unit] move rewrites dossier, not deletes     └─ [e2e] agent down → replay → confirm
[+] provenance                                   [+] Intake  (1.3)
  ├─ [unit] default 'manual' on legacy rows         ├─ [int] forwarded order → card + dossier
  ├─ [unit] bot path writes 'bot'                   ├─ [int] clarifying turn → dossier
  └─ [unit] ratio arithmetic + n<15 surfaced        └─ [int] confidential → refused, nothing stored
[+] portability  (1.2)                           [+] Onboarding
  ├─ [unit] export/import round-trip w/ links       └─ [manual-E2E] timed dry-run ≤30 min
  ├─ [unit] nas provider exports path only         [+] Digest
  └─ [BUILD] registration test: every schema         ├─ [int] delivery + empty day
      export is in the manifest or excluded         └─ [int] failure → alert seen
[+] gate residue                                 [+] Teable
  ├─ [unit] comment-decision done path (F-001-1)    ├─ [unit] allowlist refusal
  └─ [unit] rejection payload resolves a phrase key ├─ [unit] conflict withheld + comment
[+] capture pipeline                               └─ [unit] no self-conflict on bot rows
  ├─ [EVAL] ≥90% card matching (VN suite)
  ├─ [unit] exactly ONE llm call per capture
  ├─ [unit] provider-unavailable → triage  (1.7)
  └─ [unit] pairing window, zero-open-cards
[+] media
  ├─ [unit] sniffed content-type, not declared (3.2)
  ├─ [unit] dedupe keyed (company_id, sha256)  (3.2)
  └─ [unit] orphan asset GC  (4.1)
[+] git provider
  └─ [unit] host+path exact match; lookalike host refused  (3.1)
COVERAGE TARGET: every line above written WITH its feature code, in the same commit.
```

**2am-confidence test:** a forwarded Vietnamese message with a photo → card created →
evidence linked with `source=bot` → gate passes → dossier carries the message-id↔card-id
line → export round-trips it. If that passes, the substrate is real.
**Hostile QA:** 50MB video; 4000-char diacritic caption; emoji-only; forwarded-of-forwarded;
two engineers sharing one Discord account; card-number reply out of range; unlink the last
evidence from a closed card; import a company whose export predates the `source` column.
**Chaos:** LLM provider down 2h during capture; MinIO down during upload; Discord gateway
disconnect mid-capture; Teable down during the mirror window.
**Flakiness watch:** digest tests must freeze time; the recorded Teable integration stays
pinned to a fixture; the eval suite's ≥90% bar needs a fixed seed or it will flap around the
threshold.
**LLM/prompt changes:** every change to the capture prompt or the phrase table runs the
F-CAP-4 Vietnamese eval suite and must hold ≥90% correct-card matching against the
checked-in baseline. That is the gate on prompt edits.

### Section 7 — Performance

**7.1 — LOW now, MEDIUM at 10x — the provenance ratio query has no supporting index.**
`issue_evidence_links` carries `issue_evidence_links_company_issue_idx` on
`(company_id, issue_id)` — right for the gate's count. F-011-3 filters by company and date
range and joins `issues` for engineer and WP, with no index on `created_at`. At one engineer
for one week that is a sequential scan over tens of rows. Deferred to TODOS with the trigger
stated: add `(company_id, created_at)` when the ratio query serves more than a handful of
engineers.

**7.2 — LOW now — F-005-1 mirror polling.** A ≤5-minute mirror that re-scans all cards each
tick is fine at pilot volume and wrong at company volume. Deferred to TODOS: changed-since
watermark. Trigger: a second company onboarded, or card count past ~5k.

**7.3 — examined, no issues.** Capture is one bounded LLM call per message by design
(F-CAP-1), so per-message cost and latency are bounded and the head-of-line blocking risk at
17-staff scale is already designed out. Media passes a size cap before fetch. The new read
paths carry no N+1 traversal — the evidence list is one indexed query per issue.

### Section 8 — Observability

**8.1 — CRITICAL, same root as 1.2 — the fidelity report is a false-negative generator.**
`export-fidelity.ts` exists to make portability drift visible. It reports clean while a table
is being dropped. An observability surface that cannot see the class of failure it was built
for is worse than none, because it is trusted.
→ **Decision:** the registration test (1.2c) is the fix — detection moves from "someone reads
the report" to "the build fails". Recorded as an F-012-1 acceptance criterion.

**8.2 — MEDIUM — the wedge metric rests on one counter.** `wp0_evidence_via_bot` is computed
entirely from the `source` column, which 3.3 shows is actor-derived. A bug in the bot's actor
resolution produces a plausible-looking wrong number, and the pilot's abort/iterate/pass
decision is made on it.
→ **Decision:** the bridge counts captures independently (F-OPS-2 already instruments
captures/day for the adoption alarm). The band call compares the two counters; divergence
past a small tolerance blocks the band call rather than silently picking one.

**8.3 — examined, covered.** Metrics (ratio, captures/day, structuring-failure rate, digest
success, gate rejections); alerts (adoption drop, digest failure, gateway error rate) into one
named channel tested end-to-end before pilot start; runbooks with one home in
`doc/WP0-OPERATIONS.md`; and the message-id↔card-id correlation line in the dossier for
post-hoc reconstruction. The only gaps were 8.1 and 8.2.

### Section 9 — Deployment & rollout

**9.1 — MEDIUM — the stashed migration is journal-positional.** The evidence stash includes a
`_journal.json` change. Migrations landed on `develop` since it was taken will collide.
→ **Decision:** F-000's recovery re-runs `pnpm db:generate` on top of current `develop` rather
than replaying the stashed migration file, and commits the regenerated output alongside the
schema edit (the repo's documented DB workflow).

**9.2 — LOW — rollout order is already right and worth stating.** All Slice-1 migrations are
additive (`source` with a default; the one new table already shipped). Order: migrate →
deploy → enable the evidence-gate flag for the pilot company only → onboard one engineer (a
natural canary) → bot verbs live. Rollback: disable the flag and the old `done` transition
returns without a redeploy. Per CLAUDE.md, migrations run on container start and must stay
backward-compatible with the previous release for one cycle — `DEFAULT 'manual'` satisfies that.

**9.3 — pipeline contract check, no issues.** Nothing here changes `/api/health`, the
Dockerfile, build args, ports, or compose service names. No unit touches `.github/workflows/`
or `deploy/` — the registration test (1.2c) is a vitest test, not a workflow change, so it
stays clear of the pipeline-PR rule. Stated so no agent assumes otherwise.

### Section 10 — Long-term trajectory

**Reversibility: 4/5.** Additive migrations, a feature flag over the gate, a channel-agnostic
verb pipeline, and a Teable client that is a service module rather than agent-embedded code.
The one-way element, `issue_evidence_links`, already shipped.

**Debt introduced, watched:** (a) 52 units against one reviewer — reduced to ~20 PRs by 1.5,
still the throughput ceiling; (b) the phrase table's i18n generalization deferred as a taste
call (E8); (c) provenance spoofability accepted for the pilot (3.3), with 8.2 as the
compensating control; (d) PC-010's compare-then-write race, already accepted at the
2026-09-02 gate.

**Path dependency:** the portability registration test (1.2c) makes *future* schema work
cheaper rather than harder — the rare debt-reducing addition. The single evidence-link write
path for UI and bot (E6) similarly removes a future divergence.

**The 1-year question.** A new engineer reading `roadmap.md` → `backlog.md` → this file gets
identity, stories, and executable units in three hops, with every binding named and every
"already exists" claim carrying a file and line. What will not be obvious in a year is why
`develop` and `main` both looked active in September 2026 — which is exactly why §B.6
resolves it in writing rather than by convention.

### NOT in scope (deferred, with rationale)

- **WhatsApp / Zalo transport** — gate decision 2026-09-02, Discord-only pilot. TODOS.md.
- **PC-013 self-development health metric in Slice 1** — placed in Slice 2; it measures a loop
  that only matters once the wedge runs, and building it during the pilot competes with the
  pilot for the single maintainer.
- **PC-014/015/016** — NEXT horizon, header-level only; each needs its own spec.
- **PC-010 full machinery** (multi-table allowlist, schema maps, update-with-conflict) —
  Slice 2, per gate decision T2.
- **`paperclipai next-unit` CLI** (E9) — outside blast radius. TODOS.md.
- **Provenance-query index / mirror watermark** (E10, 7.1, 7.2) — invisible at pilot scale,
  triggers stated. TODOS.md.
- **Pay linkage to performance records** — out until a separate announced decision (PC-502 AC3).
- **Epics 1-5 stories** — later slices, untouched by this review.

### Failure Modes Registry

| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| Evidence-link write | scope violation | Y | unit | 404 | Y |
| Evidence-link write | partial write | Y | unit (txn) | retryable error | Y |
| Evidence unlink | done-card invariant break | Y (4.2) | unit | actionable refusal | Y |
| Media store | orphan asset | Y (4.1) | unit | nothing | Y |
| Media store | spoofed content-type | Y (3.2) | unit | refusal | Y |
| Git provider | lookalike host accepted | Y (3.1) | unit | refusal | Y |
| Capture | LLM bad output | Y | eval suite | 1-line notice | Y |
| Capture | LLM provider down | Y (1.7) | unit | 1-line notice | Y |
| Capture | injected write target | Y | unit (prompt stubbed) | refusal | Y |
| Bridge | gateway disconnect | Y | integration | VN status line | Y |
| Digest | silent non-delivery | Y | integration | operator alert | Y |
| Teable | partial write | Y | unit | refusal | Y |
| **Export** | **unregistered table dropped** | **Y (1.2)** | **build test** | **red build** | **Y** |
| Wedge metric | single spoofable counter | Y (8.2) | unit | band call blocked on divergence | Y |
| Pilot metric | n < 15 band called anyway | Y | unit | window extended | Y |

**0 CRITICAL GAPS after amendment.** One CRITICAL GAP existed on entry (export drop, 1.2) and
is now scoped as P1 work with a build-level guard.

### TODOS.md updates proposed

1. `paperclipai next-unit` CLI (P3, human ~1d / CC ~1h) — prints the next unblocked feature
   unit for an implementing agent. Depends on: units filed as issues.
2. Provenance-query index `(company_id, created_at)` (P3, human ~1h / CC ~10min) — trigger:
   the ratio query serves more than a handful of engineers.
3. F-005-1 mirror changed-since watermark (P3, human ~1d / CC ~1h) — trigger: a second company
   onboarded, or ~5k cards.
→ All three auto-decided **A) Add to TODOS.md** (outside blast radius, contexts recorded).

### Stale diagram audit

ASCII diagrams in files this plan touches: the WP-0 addendum in `backlog.md` carries four
(system architecture, gate state machine, capture data flow, test map). Three remain accurate.
**One is stale:** the system-architecture diagram at `backlog.md:700-727` shows "WhatsApp
Cloud API / Discord" with a signature-verified webhook as the inbound path. The 2026-09-02
gate made the pilot Discord-only over the gateway, with no webhook. The addendum's
superseded-in-part banner covers it in prose, but the diagram itself still reads as current.
→ Flagged for correction when `backlog.md` is next edited; not corrected here (sibling SSoT,
different PR).

### Section 11 — Design & UX

**SKIPPED — no UI scope.** Grep over this plan returned two hits for view/rendering terms,
both the false positive "form" (in "never fill a form" / "form-filling"). The single
UI-touching unit, F-002-5, renders the dossier on the existing `issue_documents` card surface
and is gated by `pnpm check:token-gates` against `docs/designs/DESIGN-UI.md` — a token
compliance check, not a design decision, so a design review would have nothing to grade.

## Phase 2 — Design Review

**SKIPPED — no UI scope detected in Phase 0** (see Section 11 above for the grep evidence).

## Phase 2.5 — DX Review (mode: DX POLISH, `[subagent-only]`)

**Product type:** Platform/API + Documentation, **AI-agent-primary**. The plan file itself is
the developer-facing artifact: its main consumer is an agent that has to implement a named
unit from a cold start.

### Developer persona card

```
TARGET DEVELOPER PERSONA (composite — this plan's four "developers")
====================================================================
Primary:   (1) the IMPLEMENTING AI AGENT — assigned one F-unit, no conversation
               history, must produce a PR without asking a question
Also:      (2) the RUNTIME AGENT (hermes `eng-<name>`) consuming the verb interface
               and REST bindings
           (3) the SOLO MAINTAINER — deploys, onboards, operates, reviews ~20 PRs
           (4) the VIETNAMESE FIELD ENGINEER — chat only; end user, not a developer
Context:   internal tool, one maintainer, 5 parallel lanes, a shared checkout that
           other sessions are actively churning
Tolerance: agent (1): any ambiguity becomes either a question to the human (latency)
           or a wrong guess (a review cycle) — both cost more than the unit itself
Expects:   agent (1): which files, which tests, which command proves it
           maintainer (3): 2am-runbook standard
           engineer (4): the bot speaks first, and in Vietnamese
```

### Developer empathy narrative (the implementing agent, first unit)

I'm assigned F-007-2. I find its row in the Lane A table — dependency F-007-1, effort CC ~2h.
Good. I scroll to the body: content-type sniffing, per-company dedupe, orphan GC, store-then-link
ordering, four named tests. That part is genuinely excellent; I know what to build and what
proves it.

Then I look for *where*. F-007-1 lists `Files:`. F-007-2 says "Files: `server/src/services/
evidence-links.ts`, storage plane (AD-028)". **What is AD-028?** The glossary in the design
record says AD-xxx are decisions from "INFRA-DESIGN-v1 Patch Set 003" — a document that grep
says exists nowhere in this repo. The one pointer telling me where the storage plane lives
points outside the repo, and I cannot read it. First stall.

Then: **is F-007-1 available?** The plan says a unit is done "at PR-open, not at merge". So
F-007-1 might be an open PR whose code is not on `develop`. Do I branch from `develop` and
write against an API that isn't there, or from F-007-1's branch and stack? The plan doesn't
say. Second stall.

So I do what the plan tells me and run
`git worktree add ../t3-PC-007-minio -b feature/PC-007-minio origin/develop`, then `pnpm dev`
to see the thing run. It **fails fast**: `doc/DEVELOPING.md:478` says `pnpm dev` hard-fails in
a linked worktree when `.paperclip/.env` is missing, and tells you to run
`paperclipai worktree init` first. The plan never mentions that command. Third stall, in the
first five minutes, on the exact instruction the plan gave me.

### Competitive DX benchmark

| Artifact | TTHW for an implementing agent | Notable |
|---|---|---|
| A bare issue titled "implement PC-007" | 30-60 min of re-derivation | the status quo this plan replaces |
| A well-formed Linear/Jira ticket with ACs | 10-15 min | industry baseline |
| Stripe/Vercel-tier internal spec | < 5 min | named files + a runnable verify command |
| **THIS PLAN** | **~5 min for units with `Files:` + tests; unbounded for the rest** | strong on *what*, uneven on *where* and *prove it* |

Target tier: **Competitive (2-5 min to first edit)**. The plan already clears it for its best
units; the gap is uniformity, not depth.

### Magical moment

`git worktree add` → open the plan at your unit → the unit names the files, the tests, and one
runnable verify command → first edit inside five minutes, zero questions. Lowest-effort
delivery vehicle: a uniform per-unit template with mandatory `Files:` and `Verify:` lines.
That is a find-and-fill pass over the existing units, not new content.

### Developer journey map (implementing agent)

| Stage | Agent does | Friction | Status |
|---|---|---|---|
| 1. Discover | assigned an issue, or "take the next unblocked unit" | no ID→lane→PR index; three ID conventions | fixed (DX-5) |
| 2. Orient | find the unit body in the plan | fine — bodies are detailed and greppable | ok |
| 3. Install | `git worktree add` + deps | **`pnpm dev` hard-fails; `paperclipai worktree init` missing from the protocol** | fixed (DX-6) |
| 4. Hello world | first edit | **`Files:` present on only some units** | fixed (DX-1) |
| 5. Build | implement + tests | test lists are specific and per-unit | ok |
| 6. Verify | run the right check | **no per-unit `Verify:` command** | fixed (DX-2) |
| 7. Ship | PR template, Thinking Path, Model Used | §B.6 covers it | ok |
| 8. Debug | CI red | `gh run view --log-failed` named in CLAUDE.md | ok |
| 9. Upgrade | a dependency unit lands under me | **"done at PR-open" leaves branch-base undefined** | fixed (DX-3) |

### DX findings

**DX-1 — HIGH — `Files:` coverage is not uniform.** F-007-1, F-002-5 and a few others name
their files; most units do not. "Which files" is the implementing agent's first question every
single time, and the answer is cheap to write and expensive to re-derive.
→ **Decision:** every unit carries a `Files:` line. Where the path is genuinely the
implementer's call, say so explicitly ("new module, path at implementer's discretion under
`server/src/services/`") rather than omitting the line — an absent line reads as an oversight,
an explicit one reads as permission.

**DX-2 — HIGH — no unit names the command that proves it.** CLAUDE.md gives repo-wide commands
and says to "run the smallest relevant check", but no unit says which check is its smallest.
An agent either runs the full suite (slow, and the repo explicitly discourages it) or guesses.
→ **Decision:** every unit carries a `Verify:` line with one runnable command, e.g.
`npx vitest run server/src/__tests__/issue-evidence-links.test.ts`. F-002-5 additionally
carries `pnpm check:token-gates`.

**DX-3 — HIGH — "done at PR-open" leaves the branch base undefined.** §B.6 declares a unit done
at PR-open so lane progress is not blocked on review latency (a good call for throughput). It
creates an ambiguity for the next unit: its dependency's code is on an open PR, not on
`develop`. Branch from `develop` and the API isn't there; branch from the dependency and
nobody said that was allowed.
→ **Decision:** state the stacking rule in §B.6 — when a dependency's PR is open but unmerged,
branch from that dependency's branch, say so in the PR body ("stacked on #NNN"), and rebase
onto `develop` once the dependency merges. When the dependency is merged, branch from
`develop` as normal.

**DX-4 — MEDIUM — `AD-xxx` references are dangling pointers.** AD-021, AD-026, AD-028, AD-032,
AD-034 and AD-037 appear across this plan and `backlog.md`. Grep finds them in exactly two
files — `backlog.md` and the design record — both of which only *cite* them. The source
("INFRA-DESIGN-v1 Patch Set 003") is not in this repo, so an agent that needs the actual
decision cannot reach it.
→ **Decision:** each `AD-xxx` mention in this plan is annotated inline with its one-line
content, so the reference is decorative rather than load-bearing. Vendoring the full AD list
into `doc/` is the better fix and is a separate PR (added to TODOS).

**DX-5 — MEDIUM — three ID conventions, no index.** `F-000`, `F-004-1`, `F-CAP-1`, `F-VERB-0`,
`F-DM-2`, `F-OPS-1`, `F-PILOT-1`, `F-012-1` mix story-scoped, verb-scoped, and one-off forms.
Every ID is greppable (good — that is the property that actually matters for an agent), but no
ID tells you its story, lane, or PR batch.
→ **Decision:** keep the IDs — they are already cross-referenced throughout the review, and
renaming would break every reference — and add one **unit index table** (ID → story → lane →
PR batch → depends-on). One table beats a rename.

**DX-6 — MEDIUM/HIGH — the worktree instruction produces a hard failure as written.**
`git worktree add ... origin/develop` leaves a tree with no `node_modules` and no
`.paperclip/.env`. Per `doc/DEVELOPING.md:478`, `pnpm dev` **fails fast** in exactly that
state, and the repo already ships the fix: `paperclipai worktree init`, which creates an
isolated instance so two servers never share one embedded Postgres data directory.
→ **Decision:** §B.6's step 1 becomes three commands — `git worktree add`, `pnpm install`,
`paperclipai worktree init` — with a one-line note on why the third exists. This is the
first-five-minutes failure, so it is the highest-value line in the whole protocol.

**DX-7 — MEDIUM — engineer-facing error text is specified as behaviour, never as strings.**
F-001-2 promises "one Vietnamese line naming the card and the filing phrase". F-VERB-0
promises a phrase table. Nowhere does an actual Vietnamese string appear, so whoever builds
F-VERB-0 invents all of them, and F-001-2's phrase key has nothing to resolve against until
they do.
→ **Decision:** F-VERB-0's DoD includes the actual strings — the four verb phrases with
aliases, the help response, the 4-line first message, and the three highest-traffic error
lines (gate rejection, capture failure, wrong-card correction) — written out in Vietnamese in
the checked-in artifact. The plan already names the correct constraint (captured content stays
verbatim Vietnamese; structure stays English); this makes it executable.

**DX-8 — examined, no issue.** Escape hatches are in good shape: the evidence gate sits behind
a per-company flag with a no-redeploy rollback, `cancelled` is the deliberate escape for junk
cards, F-007-5 is the correction path for mis-filed evidence, and the PM-files-manually
fallback is written into F-OPS-1 rather than left implicit. Every opinionated default in the
plan has a named override.

### DX scorecard

```
+====================================================================+
|              DX PLAN REVIEW — SCORECARD                            |
+====================================================================+
| Dimension            | Initial | Post-amendment | Trend            |
| Getting Started      |  4/10   |  8/10          | ↑ (DX-6, DX-3)   |
| API/CLI/SDK          |  7/10   |  8/10          | ↑ (DX-5 index)   |
| Error Messages       |  6/10   |  9/10          | ↑ (DX-7 strings) |
| Documentation        |  6/10   |  8/10          | ↑ (DX-1, DX-4)   |
| Upgrade Path         |  8/10   |  8/10          | = (additive +    |
|                      |         |                |    flagged)      |
| Dev Environment      |  4/10   |  8/10          | ↑ (DX-6)         |
| Community            |  n/a    |  n/a           | internal tool,   |
|                      |         |                | 1 maintainer     |
| DX Measurement       |  7/10   |  9/10          | ↑ (DX-2 verify)  |
+--------------------------------------------------------------------+
| TTHW (implementing agent) | unbounded → < 5 min to first edit      |
| TTHW (field engineer)     | ~5 min quickstart (F-003-4), measured  |
| TTHW (maintainer onboard) | <= 30 min, timed dry-run (F-003-3)     |
| Competitive tier          | Competitive (2-5 min)                  |
| Magical moment            | designed — uniform Files:/Verify: lines |
| Product type              | Platform/API + Docs, AI-agent-primary  |
| Mode                      | DX POLISH                              |
| Overall DX                |  6/10 → 8/10                           |
+====================================================================+
| PRINCIPLE COVERAGE: Zero Friction covered (DX-6) - Incremental      |
| Steps covered (lanes) - Learn by Doing covered (fixtures) - Decide  |
| For Me + Escape Hatches covered (DX-8) - Fight Uncertainty covered  |
| (DX-2 verify, 22-row rescue registry) - Code in Context covered     |
| (dossier + export fixtures) - Speed covered (PR batching) -         |
| Magical Moments covered (DX-1/DX-2 template)                        |
+====================================================================+
```

### DX implementation checklist

```
[x] TTHW target defined and measured (agent < 5 min; engineer ~5 min; onboarding <= 30 min timed)
[x] Environment setup separated from per-engineer onboarding (F-003-2 vs F-003-3)
[x] First run produces meaningful output (one-line Vietnamese confirmation)
[x] Every unit names its files (DX-1)
[x] Every unit names one runnable verify command (DX-2)
[x] Branch base defined for open-PR dependencies (DX-3)
[x] Worktree protocol runnable end to end without a hard failure (DX-6)
[x] Cross-references resolve inside this repo, or are annotated inline (DX-4)
[x] Unit index maps ID -> story -> lane -> PR batch (DX-5)
[x] Engineer-facing error strings written, not merely described (DX-7)
[x] Every opinionated default has a named escape hatch (DX-8)
[x] Docs: one runbook home (doc/WP0-OPERATIONS.md) + quickstart + fixtures
[x] Upgrade: eval-gated prompts, additive migrations, flag rollback
[x] Works in CI: new tests extend the existing vitest workspace — EXCEPT Lane C, see ENG-1
[ ] Community channel — n/a (internal tool, one maintainer)
```

## Phase 3 — Eng Review (`[subagent-only]`, reviewed the final amended plan)

### Step 0 — Scope challenge

**Complexity check triggers** (well past 8 files; 4+ new services). Per the autoplan override,
scope is **never reduced** here (P2) — the CEO phase already ran the minimum-set analysis and
queued the "12 units would answer the wedge question" argument for the outside voice rather
than auto-cutting. Scope held. What follows is implementation rigor on the plan as amended.

**Reuse check.** Every "already exists" claim in Part A and 0B was probed against the code, and
two were corrected during the CEO phase (the evidence stash, the portability manifest). No
remaining claim is unverified.

**Distribution check.** No new artifact type (binary, package, container) is introduced. The
one distribution-shaped question is Lane C's package, which turns out to be the phase's
largest finding — ENG-1.

**TODOS cross-reference.** No open TODO blocks this plan; two (WhatsApp WP, identity doctrine
sentence) bound its edges. Three new TODOs proposed in Phase 1, one more added here (ENG-6).

### 1. Architecture review

**ENG-1-CORRECTED — [P0] (confidence: 10/10) — `t3-ci` does not run the test suite at all. Every
unit's definition of done is vacuous, not just Lane C's.**

*Original finding (superseded, and its evidence was wrong):* "Lane C's package is outside the
pnpm workspace and outside CI", citing a `unit` job that runs
`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test:unit`. That
description came from **`CICD/t3-ci.yml`** — the staging copy in the CICD planning directory —
not from **`.github/workflows/t3-ci.yml`**, the file that actually runs. They differ. The DX
outside voice caught it.

*Corrected, read from the live workflow:* `.github/workflows/t3-ci.yml`'s `unit` job runs
`pnpm install --frozen-lockfile` and then, in order: `check-ssot-guards.mjs`,
`check-docker-deps-stage.mjs`, `check-no-git-push.mjs`, `node --test check-no-git-push.test.mjs`,
`pnpm check:no-google-runtime`, `pnpm test:check-no-google-runtime`,
`pnpm test:scan-client-bundle`, `node --test run-vitest-stable-shard.test.mjs`,
`node --test e2e-shard.test.mjs`, `node --test build-standalone-concurrency.test.mjs`,
`node --test link-plugin-dev-sdk.test.js`, and `pnpm run typecheck:build-gaps`.

**There is no vitest invocation.** The three grep hits for "vitest" are the *names of scripts
that test the shard partitioner*, not a run of the suite. There is no `lint` script and no
`test:unit` script in `package.json`. The full suite runs only in `t3-nightly.yml` at 22:00
UTC — **after** merge to `develop`.

Consequences, and they are larger than the original finding:
1. A PR can be `t3-ci` green with **every test in it failing**. This plan's DoD ("tests written
   with the code and green · `t3-ci / unit` green") and its "COVERAGE TARGET: every line
   written WITH its feature code" are enforced by nothing at PR time, for **all 47 units** —
   not just the eleven in Lane C.
2. A regression reaches `develop` and is discovered by the nightly, at which point it is
   someone else's morning and the authoring PR is already squashed.
3. The original Lane C observation still holds and is now a subset: `discord-bridge` is not in
   `pnpm-workspace.yaml`, uses npm (`package-lock.json`), and has its own vitest config — so it
   would stay uncovered even after vitest is wired in workspace-wide.

→ **Decision:** F-CI-1 is rewritten and promoted to **P0, ahead of F-000**: add a vitest run to
`t3-ci`'s `unit` job (the repo already ships `scripts/run-vitest-stable.mjs` for exactly this,
sharded to survive embedded-Postgres contention), **and** a step for `discord-bridge`'s own
npm suite. Still a pipeline PR: its own branch, label `ci`, human review, no application code.
Until it lands, treat "`t3-ci` green" as evidence of nothing and require the author to paste
local test output in the PR body.

**ENG-2 — [P1] (confidence: 9/10) `packages/db/src/schema/issue_evidence_links.ts:6-20` — no
unique constraint on `(issue_id, external_object_id)`.** The shipped table declares exactly one
index:

```ts
(table) => ({
  companyIssueIdx: index("issue_evidence_links_company_issue_idx").on(table.companyId, table.issueId),
}),
```

`index(...)`, not `uniqueIndex(...)`. F-007-1 promises "duplicate link is idempotent, not a
second row", which without a DB constraint is an app-level check-then-insert — and two
concurrent bot filings of the same object on the same card race straight through it. The result
is two rows, so the gate counts 2 where it should count 1 **and F-011-3's ratio numerator is
inflated**. The wedge metric is computed from these row counts, so this is a metric-integrity
bug, not just untidy data.
→ **Decision:** F-007-1 adds `uniqueIndex("issue_evidence_links_issue_object_uq").on(issueId,
externalObjectId)` and implements the write as an upsert (`onConflictDoNothing`, returning the
existing row with `created:false`). Test: two concurrent inserts of the same pair produce one
row and two successful responses.

**ENG-3 — [P2] (confidence: 9/10) `packages/db/src/schema/issue_evidence_links.ts` (stashed
version) — the `source` column has no database constraint.** The stashed line is:

```ts
source: text("source").$type<EvidenceSource>().notNull().default("manual"),
```

`$type<>()` is a **TypeScript-only** cast. Drizzle emits a plain `text` column, so the database
will happily accept `source = 'banana'` from a migration, a psql session, or any writer that
bypasses the typed client. The plan's F-011-1 specified a check constraint precisely so a third
source later is a migration rather than a type rewrite; the stashed code has neither `pgEnum`
nor a check.
→ **Decision:** F-011-1's migration adds
`CHECK (source IN ('bot','manual'))` on both evidence tables. Cheap, and it protects the one
column the pilot's pass/abort decision is computed from.

**ENG-4 — [P2] (confidence: 8/10) — "what counts as evidence" will get four implementations.**
The definition is consumed by the gate (`issues.ts:7856-7873`, attachments + links), F-011-3's
ratio, F-BRIEF-1's "open evidence gaps", F-DIGEST-1's "cards blocked on missing evidence", and
F-006-1's evidence index. The plan already says F-BRIEF-1 must match the gate's count; it does
not say that for the other three. Four independent implementations of one predicate is the
classic drift bug, and here the drift is visible to the CTO as inconsistent numbers between the
digest and the export.
→ **Decision:** one exported helper — `countEvidenceForIssue(db, issueId)` in
`server/src/services/evidence-links.ts` — is the single definition, and the gate is refactored
onto it as part of F-007-1. All five consumers call it. This is the "one guard where they all
route through" move, and it is cheap now and expensive after five call sites exist.
Note the ordering constraint: refactoring the gate onto the helper is a structural change, so
it lands in its own commit **before** the behavioural commits in the same PR.

**ENG-5 — [P3] (confidence: 8/10) — `company-portability.ts` is 6381 lines and F-012-1 adds to
it.** Not a defect, a hazard: it is a merge-conflict magnet and the second-largest file the plan
touches. F-012-1 should add its normalizer as a small, clearly-delimited block near the
existing `normalizePortableIssueAttachments` (line 1117) rather than scattering changes, and
must not drive-by refactor (CLAUDE.md: drive-by refactors go in a separate PR).

**Architecture — new components and their attachment points**

```
  EXISTING                                    NEW (this plan)
  ────────────────────────────────────────    ────────────────────────────────────
  server/src/routes/issues.ts  ◀──────────── evidence-link routes (F-007-1)
    (37 commits/30d — hottest file)             GET/POST/DELETE + /move
  server/src/services/issues.ts ◀─────────── countEvidenceForIssue() refactor (ENG-4)
    gate @ 7842-7940 (row-locked txn)         + F-402-1 second transition rule (1.4)
  server/src/services/            ◀───────── evidence-links.ts     (F-007-*)  [new]
                                  ◀───────── teable-client.ts      (F-010-1)  [new]
  packages/db/src/schema/         ◀───────── source columns + unique index (F-011-1, ENG-2/3)
  packages/shared/src/constants.ts ◀──────── EVIDENCE_SOURCES (5.1)
  packages/shared/src/types/
    company-portability.ts        ◀───────── evidence-link manifest entry (F-012-1)
  server/src/services/
    company-portability.ts (6381L) ◀──────── normalizer + import path (F-012-1)
    export-fidelity.ts             ◀──────── evidence-link count (F-012-1)
  ─────────────────────────────────────────────────────────────────────────────────
  discord-bridge/  ← npm package, NOT in pnpm workspace, NOT in t3-ci  (ENG-1)
    commands/, lib/notifier.ts,   ◀───────── lib/dmHandler.ts, lib/media.ts (F-DM-2)
    lib/taskCreate.ts                        capture pipeline (F-CAP-*), intake (F-004-*)
                                             phrase table (F-VERB-0)
  ─────────────────────────────────────────────────────────────────────────────────
  Coupling introduced: Lane A ↔ Lane C via the REST evidence-link API only (no shared
  module), which is why the lanes parallelize. Lane B shares no file with A or C.
```

**Production failure scenario per new integration point:** Teable returns 429 during the
mirror window → backoff retry, activity_log, PM sees stale rows for one cycle (accounted).
MinIO times out mid-upload → no orphan link, GC reclaims the asset, engineer told to resend
(accounted, 4.1). The LLM provider 500s for two hours → every capture lands on the triage card
with a Vietnamese notice and the fingerprints stay clear (accounted, 1.7). Discord gateway
drops for 20 minutes → inbound persisted and replayed, one status message per engineer,
downtime logged so the band call discounts it (accounted, F-DM-3).

### 2. Code quality review

**ENG-6 — [P3] (confidence: 7/10) — two package managers in one repo is undocumented.**
`CLAUDE.md` says "Package manager is pnpm", full stop. `discord-bridge/package-lock.json` says
otherwise for the directory that holds eleven of this plan's units. An implementing agent that
reads CLAUDE.md and runs `pnpm install` inside `discord-bridge/` gets a wrong-shaped
`node_modules` and a confusing failure.
→ **Decision:** the plan's §B.6 states it explicitly, and a one-line note goes to TODOS for
CLAUDE.md itself (a doc PR, not this work).

**DRY, naming, over/under-engineering — examined.** The stashed route code follows the file's
existing `getAccessibleResource` / `getActorInfo` / `validate(schema)` idioms and puts logic in
a service module rather than the handler, matching the repo's thin-route/fat-service split. The
one real DRY violation is ENG-4 (the evidence predicate). `EVIDENCE_SOURCES`'s placement is 5.1.
No new abstraction solves an absent problem; no added method branches more than five times.
The plan's own naming is consistent except for the ID scheme, addressed as DX-5.

**Stale diagrams in touched files:** one, at `backlog.md:700-727` — recorded in the Phase 1
stale-diagram audit.

### 3. Test review

**Framework detection.** `RUNTIME:node`; `vitest.config.ts` at the root defines a multi-project
workspace over `server`, `ui`, `cli`, `packages/*`, `packages/adapters/*`, `packages/plugins/*`.
`pnpm test` routes through `scripts/run-vitest-stable.mjs`, which shards and serializes runs to
avoid embedded-Postgres contention. Single files run with `npx vitest run <path>` from the root,
which is what §B.0.2 uses. **`discord-bridge` has its own separate vitest config and is not a
workspace project** — the root config never sees it (ENG-1).

**ENG-7 — [P2] (confidence: 9/10) — the parallel-lane plan collides with the embedded-Postgres
constraint.** `pnpm test` is deliberately serialized because concurrent vitest runs contend on
the embedded Postgres instance. Five worktrees each running server tests means five Postgres
instances on one machine. `paperclipai worktree init` makes that *correct* (each worktree gets
its own instance under `~/.paperclip-worktrees/`) but not *free* — it is five database servers.
→ **Decision:** §B.6 gains one line: run at most two lanes' server test suites concurrently on
a single machine; `paperclipai worktree init` is what makes even that safe. Lanes may be *open*
in parallel; their heavy suites should not *run* in parallel.

**Test coverage diagram — every planned branch**

```
evidence-links service (F-007-1) ─┬─ link(): object exists? ──┬─ yes → reuse    [unit]
                                  │                           └─ no  → insert   [unit]
                                  ├─ unique conflict → return existing, created:false  [unit ENG-2]
                                  ├─ concurrent same pair → ONE row, two 200s   [unit ENG-2]
                                  ├─ issue not in actor's company → 404         [unit]
                                  ├─ txn: object ok + link fails → neither      [unit]
                                  └─ countEvidenceForIssue() shared by 5 callers [unit ENG-4]
  unlink(): ─┬─ card not done → ok + activity_log + dossier line                [unit]
             ├─ card done, other evidence remains → ok                          [unit 4.2]
             └─ card done, this is the last → REFUSED + reopen hint             [unit 4.2]
  move():    ─── rewrites dossier on both cards, never deletes                  [unit]
provenance (F-011-*) ─┬─ legacy rows read 'manual'                              [unit]
                      ├─ DB rejects source='banana'                             [unit ENG-3]
                      ├─ bot path writes 'bot'; UI path writes 'manual'         [unit ×2]
                      └─ ratio: boundaries inclusive/exclusive; n<15 surfaced   [unit]
portability (F-012-1) ─┬─ round-trip: dossier + attachment + 4 providers        [int]
                       ├─ nas exports path only, zero bytes                     [int]
                       └─ registration test: new table absent from manifest → RED [build]
gate residue ─┬─ comment-decision done path                                     [unit F-001-1]
              └─ rejection payload's phraseKey resolves in the table            [unit F-001-2]
capture (F-CAP-*) ─┬─ exactly ONE llm call per capture (regression guard)       [unit]
                   ├─ malformed / empty / refusal / PROVIDER-DOWN → triage      [unit ×4]
                   ├─ pairing: paired / just outside window / caption-first     [unit ×3]
                   ├─ zero open cards → triage explicitly                       [unit]
                   ├─ injected target refused with the prompt STUBBED OUT       [unit F-CAP-3]
                   └─ ≥90% correct-card matching, fixed seed                    [EVAL]
media ─┬─ sniffed type beats declared type                                      [unit 3.2]
       ├─ dedupe keyed (company_id, sha256)                                     [unit 3.2]
       └─ orphan asset GC                                                       [unit 4.1]
git provider ─── lookalike host refused; fork remote accepted                   [unit 3.1]
teable ─┬─ allowlist refusal / schema reject                                    [unit ×2]
        ├─ conflict withheld + comment                                          [unit]
        └─ mirror skips bot-attributed rows (no self-conflict)                  [unit]
digest ─┬─ delivery + empty-day one-liner                                       [int ×2]
        └─ failure → alert actually seen                                        [int]
E2E ─── forwarded VN message + photo → card → link(source=bot) → gate passes
        → dossier correlation line → export round-trips it            (the 2am test)
```

**Regression rule.** Every finding above that describes a bug in *shipped* code — ENG-2
(missing unique index) and ENG-3 (unconstrained enum) — gets a test that **fails before the fix
and passes after**. Not a new-feature test: a regression test.

**Flakiness risk.** Digest tests depend on wall-clock (freeze time). The F-CAP-4 eval bar at
exactly ≥90% will oscillate unless the suite is seeded and the case set is fixed. The Teable
integration must stay pinned to a recorded fixture — never a live call in CI.

**Test plan artifact:** written to
`~/.gstack/projects/tetracilin-test_ai_todo/Tetracilin-slice1-feature-plan-test-plan-20260902.md`.

### 4. Performance review

**Indexes.** The gate's count is served by `issue_evidence_links_company_issue_idx` on
`(company_id, issue_id)` — correct. ENG-2's unique index on `(issue_id, external_object_id)`
additionally serves the duplicate check. F-011-3's date-ranged ratio has no supporting index
(Phase 1, 7.1) — deferred to TODOS with a stated trigger, because at one engineer for one week
it scans tens of rows.

**N+1.** The new read paths carry none: the evidence list is one indexed query per issue, and
the digest aggregates in a single grouped query rather than per-card lookups. F-006-1's export
walks every child of a WP — bounded by WP size (tens), and it runs at most once per WP close.

**Memory / payload.** Media is size-capped before fetch, so the largest new in-memory object is
one bounded upload. The LLM call is schema-constrained with a bounded output. Nothing here
holds an unbounded collection.

**Slow paths, p99 at pilot scale.** Capture = one media fetch + one LLM call + two DB writes;
the LLM call dominates at roughly 1-3s. The mirror cron is a ≤5-minute budget with a full scan
(7.2, deferred). The export is the slowest new path and is human-triggered, once per WP.

**Connection pressure.** No new pool: the bridge talks to Paperclip over HTTP (its README is
explicit that it only touches the public API), so Lane C adds no database connections.
Five worktrees each running an embedded Postgres is the real local resource story — ENG-7.

## Implementation Tasks

Synthesized from this review's findings. Each derives from a specific finding above. The first
three block everything else.

- [ ] **T13 (P1, human: ~4h / CC: ~30min)** — ci — Wire `discord-bridge` into `t3-ci`
  - Surfaced by: ENG-1 — outside the pnpm workspace, outside CI; 11 units would merge with a vacuously green gate
  - Files: `.github/workflows/t3-ci.yml` — **separate PR, label `ci`, human-reviewed**
  - Verify: the workflow's own run on the PR
- [ ] **T2 (P1, human: ~2h / CC: ~20min)** — substrate — Recover the stashed evidence WIP onto a pushed branch
  - Surfaced by: CEO 1.1 — 966 lines exist only in a git stash, in a checkout other sessions are stashing
  - Files: `server/src/routes/issues.ts`, `packages/db/src/schema/issue_evidence_links.ts`, `.../issue_attachments.ts`
  - Verify: `pnpm --filter @paperclipai/db build && pnpm -r typecheck`
- [ ] **T1 (P1, human: ~1d / CC: ~1h)** — portability — Register `issue_evidence_links` in the manifest + fidelity counts + a schema registration test
  - Surfaced by: CEO 1.2 — export drops evidence links today; the fidelity report reports clean
  - Files: `packages/shared/src/types/company-portability.ts`, `server/src/services/company-portability.ts`, `server/src/services/export-fidelity.ts`
  - Verify: `npx vitest run server/src/__tests__/company-portability-routes.test.ts server/src/__tests__/schema-registration.test.ts`
- [ ] **T14 (P1, human: ~2h / CC: ~15min)** — schema — Unique index on `(issue_id, external_object_id)`
  - Surfaced by: ENG-2 — concurrent duplicate filings inflate the gate count and the wedge ratio
  - Files: `packages/db/src/schema/issue_evidence_links.ts` · Verify: the evidence-links suite
- [ ] **T3 (P1, human: ~5d / CC: ~4h)** — intake — Build F-004-1/2/3 (job-order intake, clarifications, confidential refusal)
  - Surfaced by: CEO 1.3 — the entry point of the recorder loop had no feature units
  - Files: `discord-bridge/src` · Verify: `cd discord-bridge && npm test`
- [ ] **T8 (P1, human: ~2h / CC: ~20min)** — docs — `Files:` and `Verify:` on every unit
- [ ] **T9 (P1, human: ~1h / CC: ~10min)** — docs — Worktree protocol: add `pnpm install` + `paperclipai worktree init`
- [ ] **T15 (P2, human: ~1h / CC: ~10min)** — schema — `CHECK (source IN ('bot','manual'))` on both evidence tables
- [ ] **T16 (P2, human: ~4h / CC: ~30min)** — evidence — Extract `countEvidenceForIssue`, refactor the gate onto it
- [ ] **T4 (P2, human: ~4h / CC: ~30min)** — evidence — Refuse unlinking the last evidence from a `done` card
- [ ] **T5 (P2, human: ~4h / CC: ~30min)** — evidence — Exact host+path match for git commit evidence
- [ ] **T6 (P2, human: ~4h / CC: ~30min)** — evidence — Dedupe on `(company_id, sha256)`; sniff content-type
- [ ] **T7 (P2, human: ~4h / CC: ~30min)** — capture — Provider-unavailable fallback, fingerprint left clear
- [ ] **T10 (P2, human: ~1h / CC: ~10min)** — docs — Branch base for open-PR dependencies
- [ ] **T11 (P2, human: ~1h / CC: ~10min)** — docs — Resolve `AD-xxx` codes inline
- [ ] **T12 (P2, human: ~4h / CC: ~30min)** — phrases — Write the actual Vietnamese strings
- [ ] **T17 (P3, human: ~1h / CC: ~10min)** — docs — Cap concurrent lane test runs at two per machine

JSONL artifact: `~/.gstack/projects/tetracilin-test_ai_todo/tasks-autoplan-slice1-20260902.jsonl`
(17 rows, written with Node's JSON serializer — `jq` is not installed on this machine).

---

## Outside voices — findings, verified

Codex CLI is not installed (`command -v codex` → not found), so all three voices are
independent Claude subagents with fresh context, tagged `[subagent-only]`. That is the same
model family, not a cross-model read — weight their agreement accordingly.

Each claim below was re-verified against the repo before being absorbed. Two were rejected.

### Verified TRUE and absorbed

**V1 (CEO, DX, Eng — all three, independently) — `feature/evidence-substrate` exists.**
Verified: `git log origin/feature/evidence-substrate` shows 5 commits; `git diff --stat
origin/develop...origin/feature/evidence-substrate` shows 4,885 insertions across 19 files.
Absorbed as 1.1-CORRECTED and the F-000 rewrite. **This review's largest error, caught by the
voices.**

**V2 (DX) — `t3-ci` runs no vitest.** Verified by reading `.github/workflows/t3-ci.yml`
directly. My original ENG-1 quoted `CICD/t3-ci.yml` instead. Absorbed as ENG-1-CORRECTED and
the F-CI-1 rewrite; severity raised to P0 and scope widened from Lane C to all 47 units.

**V3 (Eng) — `source=bot` has no producer, and the branch author deliberately made it so.**
Verified: `server/src/routes/issues.ts:342` on that branch reads
`const HTTP_EVIDENCE_SOURCE: EvidenceSource = "manual";`, used at :8568 and :13341, with a
comment at :288 explaining that every HTTP filing act records the constant, and at :327 that
adding a value to `EVIDENCE_SOURCES` for non-chat automation is the alternative considered.
So the actor-derived scheme my finding 3.3 described is the *superseded draft*.
→ **This changes 3.3.** The finding was "`source=bot` is actor-derived and spoofable". The
committed reality is stronger and different: **nothing writes `bot` at all yet**. The chat
bridge is the sole intended writer and is unbuilt. F-011-2 is therefore not "4 hours to plumb
provenance through existing write paths" — it is "build the only `bot` producer there will
ever be, inside the bridge", and it cannot be tested until F-DM-2 and F-CAP-1 exist.
Re-estimate and re-sequence it into Lane C, not Lane A.

**V4 (CEO) — CRITICAL — the wedge metric is structurally suppressed on the pilot card type.**
Verified against the code and the backlog. `backlog.md:554-560` makes `PC-402` (software /
firmware dev) the Slice-1 pilot card type. `F-402-3` requires ≥1 commit + demo + test report
to close it; `F-402-2` auto-links commits from `PC-xxx` branches as evidence. Auto-linked
commits arrive through the HTTP path, and `HTTP_EVIDENCE_SOURCE` is the constant `"manual"`.
So on the pilot card type, **most evidence rows are commits that count against the bot ratio
no matter how well the bot performs.** An engineer could DM every photo he takes and still
land under the ≥80% band. The pass/iterate/abort decision would be made on a number the
system's own design suppresses.
→ **Decision:** provenance needs a third class. Auto-linked commits, and any other
system-generated filing, are **excluded from both numerator and denominator** of
`wp0_evidence_via_bot` — they are neither a bot capture nor a human re-entry, which is exactly
the distinction the metric exists to measure. Add `system` to `EVIDENCE_SOURCES` (the code
comment at :327 already anticipates this), write the exclusion into F-011-3's query and
F-PILOT-1's band call, and then **re-check whether 15 non-commit evidence items even occur in
a pilot week** — because the min-n rule is what decides whether the band can be called at all.
This is the single highest-value finding of the whole review: without it the pilot produces a
confident, meaningless number.

**V5 (Eng) — F-000's own branch name breaks the auto-linker.** `feature/evidence-substrate`
carries no `PC-xxx`, so the `PC-\d{3}` matcher specified in F-007-3 and F-402-2 finds nothing
on the fork's own substrate branch. Absorbed into F-000's caveat.

**V6 (CEO) — the Lane-A-first rationale as written is falsifiable.** The stated reason
("the bot is not staged ahead of the cards it files against") does not survive the plan's own
current-state table: the shipped gate is satisfiable *today* via `issue_attachments`, so a
photo → attachment capture path files real evidence against real cards with zero of Lane A.
→ **Decision:** the ordering stands but the *reason* is corrected. Lane A goes first because
(a) F-000's branch already exists and blocks on review, not build, and (b) the evidence-link
ledger is what the export, the ratio, and the digest all read. Not because the bot cannot
function without it — it demonstrably could.

**V7 (CEO) — the riskiest hypothesis is tested last.** F-CAP-4's ≥90% Vietnamese card-matching
bar sits at the *pilot-start* gate, behind F-CAP-1 → F-DM-2 → G-2. If Vietnamese structuring
comes in at 70%, that is discovered after most of Lanes A, B and E are built.
→ **Decision:** pull the eval forward. The eval corpus and a bare structuring harness need
neither the DM surface nor the substrate — they need real Vietnamese messages and a prompt.
Add **F-CAP-4a — offline structuring spike**: collect ~30 real-shaped Vietnamese messages,
run the structuring prompt against them, measure card-matching, in Lane C position 1 alongside
F-VERB-0. It is days of work that de-risks weeks, and if it lands at 70% the channel and the
prompt both get revisited before the substrate PR is even reviewed.

**V8 (CEO) — unit count and effort.** 47 F-units + 3 G-gates, not 52; ≈66 person-days human,
≈57 hours CC. Corrected wherever the plan said 52.

### Verified FALSE and rejected

**R1 (DX) — "`feature/evidence-substrate` also carries `.github/workflows/{ci,nightly,
release-prod}.yml` and `CICD/*.md`, so an agent inherits a CLAUDE.md rule violation."**
**Rejected.** `git diff --name-only origin/develop...origin/feature/evidence-substrate`
returns **zero** paths under `.github/` or `CICD/`, and zero for `backlog.md`. The branch is
application code only. The voice appears to have diffed against a different base — probably
the dirty worktree or `main` rather than `origin/develop`. F-000 says so explicitly so the
claim does not propagate.

**R2 (CEO, partial) — "persona mismatch: the pilot runs `PC-402`, a desk-bound software-dev
card, while the demand evidence is a field engineer with photos."**
**Not rejected on the facts — the facts check out** (`backlog.md:554-560` marks PC-402 the
Slice-1 pilot; `roadmap.md:31-36` grounds the thesis in field capture). **Rejected as an
auto-decision**: this argues the owner should change a pilot decision they made deliberately,
which is a User Challenge, not a taste call. It goes to the Final Gate as **UC-1**, with the
owner's original direction as the default.

## Dual-voice consensus tables

Codex CLI absent → the Codex column is N/A everywhere (not CONFIRMED). A single critical
finding from one voice is flagged regardless of consensus rules.

**CEO**

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Premises valid? | DISAGREE (P-f false; Lane-A rationale falsifiable) | N/A | fixed — 1.1-CORRECTED, V6 |
| 2. Right problem to solve? | DISAGREE (persona vs pilot card type) | N/A | → **UC-1** at the gate |
| 3. Scope calibration correct? | DISAGREE (47 units / ≈66 person-days for a 1-week pilot) | N/A | partly fixed (9 units re-scoped to review); residue → UC-1 |
| 4. Alternatives explored? | DISAGREE (riskiest hypothesis tested last) | N/A | fixed — F-CAP-4a spike |
| 5. Competitive/market risks? | not raised | N/A | N/A (single voice) |
| 6. 6-month trajectory sound? | AGREE | N/A | flagged-confirmed (single voice) |

**DX**

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Getting started < 5 min? | DISAGREE | N/A | fixed — DX-6 worktree protocol |
| 2. Naming guessable? | DISAGREE | N/A | fixed — DX-5 unit index |
| 3. Error messages actionable? | DISAGREE | N/A | fixed — DX-7 real strings |
| 4. Docs findable & complete? | DISAGREE (current-state table factually wrong) | N/A | fixed — 1.1-CORRECTED |
| 5. Upgrade path safe? | DISAGREE (`t3-ci` runs no tests) | N/A | fixed — F-CI-1 raised to P0 |
| 6. Dev environment friction-free? | DISAGREE | N/A | fixed — DX-6 |

**Eng**

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Architecture sound? | AGREE with reservations | N/A | 5/5 plan claims verified TRUE against code |
| 2. Test coverage sufficient? | DISAGREE (CI runs none of it) | N/A | fixed — F-CI-1 |
| 3. Performance risks addressed? | AGREE at pilot scale | N/A | flagged-confirmed |
| 4. Security threats covered? | PARTIAL | N/A | 3.1/3.2 stand; 3.3 superseded by V3 |
| 5. Error paths handled? | AGREE | N/A | flagged-confirmed |
| 6. Deployment risk manageable? | DISAGREE (F-000 premise false) | N/A | fixed — F-000 rewritten |

## Completion summary

```
+====================================================================+
|         /autoplan — FEATURE DECOMPOSITION REVIEW SUMMARY           |
+====================================================================+
| Mode                 | SELECTIVE EXPANSION (autoplan override)     |
| Approach             | C (decomposition + roadmap completeness)    |
| System audit         | concurrent session churning the checkout;   |
|                      | 2 stashes; hottest file on critical path    |
| Step 0               | 7 premises; 2 found FALSE (P-f, P-g)        |
| Sec 1  (Arch)        | 8 issues (1 CRITICAL live bug, 1 self-error)|
| Sec 2  (Errors)      | 22 codepaths mapped, 0 GAPS after amendment |
| Sec 3  (Security)    | 4 issues, 0 High after amendment            |
| Sec 4  (Data/UX)     | 13 edge cases, 2 gaps found and closed      |
| Sec 5  (Quality)     | 2 issues (EVIDENCE_SOURCES home, npm/pnpm)  |
| Sec 6  (Tests)       | full diagram; 6 regression tests specified  |
| Sec 7  (Perf)        | 3 items, 2 deferred with stated triggers    |
| Sec 8  (Observ)      | 2 gaps (fidelity report lies; 1 counter)    |
| Sec 9  (Deploy)      | 3 risks; migration ordering corrected       |
| Sec 10 (Future)      | reversibility 4/5; 4 debt items watched     |
| Sec 11 (Design)      | SKIPPED — no UI scope                       |
| DX passes 1-8        | overall 6/10 → 8/10; 8 findings             |
+--------------------------------------------------------------------+
| NOT in scope         | 8 items, each with rationale                |
| What already exists  | 13 rows, all code-verified (5 corrected)    |
| Error/rescue registry| 22 codepaths, 0 CRITICAL GAPS               |
| Failure modes        | 15 rows, 0 CRITICAL GAPS                    |
| TODOS proposed       | 4 items                                     |
| Implementation tasks | 17 (JSONL on disk)                          |
| Test plan artifact   | on disk                                     |
| Outside voices       | 3 Claude subagents; Codex unavailable       |
| Voice findings       | 8 verified TRUE, 2 rejected on evidence     |
| Self-corrections     | 2 major (F-000 premise, t3-ci description)  |
| Lake Score           | 9/10 chose the complete option              |
| Diagrams produced    | 4 (lanes, evidence flow, arch, test map)    |
| Stale diagrams found | 1 (backlog.md:700-727, flagged not fixed)   |
| Unresolved decisions | 2 → Final Gate (UC-1, T-1)                  |
+====================================================================+
```

## Phase 4 — Final Gate decisions (owner, 2026-09-03)

| # | Item | Owner decision | Applied |
|---|---|---|---|
| G1 | Gate verdict (D1) | **Approve as-is** — all auto-decisions stand | ✓ |
| G2 | UC-1 pilot card type (D2) | **Keep `PC-402`, fix the metric.** The owner's direction stands: the review's persona argument is noted but the owner knows who will actually engage for a pilot week. The metric defect is fixed instead of the pilot | ✓ `system` provenance class added to F-011-1, F-011-3, F-PILOT-1 |
| G3 | T-1 phrase-table i18n (accepted with D1) | **Keep WP-0-scoped.** Generalizing `F-VERB-0` into an i18n surface for all engineer-facing messages stays deferred — borderline blast radius, not needed by the pilot | ✓ recorded in NOT-in-scope |
| G4 | Plan file placement (D3) | **Write to `docs/designs/` now**, accepting the concurrent-session risk | ✓ |

**Residual risk the owner accepted at G2, stated plainly:** `PC-402`'s evidence is commits,
demos and test reports. With `system` rows excluded, the pilot's n counts only photo/chat and
manually-filed evidence on software-dev cards. If fewer than 15 such items occur in a week the
band is uncallable — the min-n rule catches that honestly rather than producing a confident
wrong number, but it means the pilot may end with "extend the window" instead of a verdict.
The pre-pilot sanity check in F-PILOT-1 exists to surface that **before** the week is spent.

**Final Gate status: APPROVED (owner, 2026-09-03).**

## Post-gate amendment (2026-09-03) — second round of outside-voice findings

The three voices returned longer reports after the gate closed. Everything below was
re-verified against the repo before being absorbed. Nothing here reverses a gate decision;
these are defects in the plan, fixed in place. Two of them determine whether the pilot can
produce a number at all, so they are called out first.

### A1 — CRITICAL — nothing can write `source='bot'`, so the wedge metric is structurally zero

Verified: `server/src/routes/issues.ts:342` on `feature/evidence-substrate` is
`const HTTP_EVIDENCE_SOURCE: EvidenceSource = "manual";`, applied unconditionally at :8568 and
:13341. Commit `e6ca51e8` states the reasoning: **every agent API key reports
`actorType === "agent"`, and the Discord bridge authenticates on its own routes** — so deriving
provenance from the actor class would over-count bot adoption. The author rejected the
actor-derived scheme deliberately and correctly.

Consequence: there is no code path that writes `bot` today, so `wp0_evidence_via_bot` evaluates
to **0 by construction**, and `F-PILOT-1`'s ≥80% / 50-79% / <50% band call has no input.

This supersedes finding 3.3, which analysed the superseded stash draft and reached the opposite
conclusion ("actor-derived and spoofable, accepted for the pilot"). The shipped design is not
spoofable; it simply has no producer yet.

→ **`F-011-2` is rewritten as a design unit, not a plumbing unit.** The question it must answer:
*how does the WP-0 bridge authenticate such that its filings are distinguishable from every
other agent actor?* Options are a dedicated bridge credential with its own actor identity, a
signed per-filing marker, or a bridge-only route. Until it is answered `F-PILOT-1` cannot run.
Re-estimated from `human: 4h` to **≥1 day**, moved ahead of `F-DIGEST-1` on the critical path,
and it now belongs to Lane C (the bridge), not Lane A.

### A2 — CRITICAL — the metric has no denominator outside the database

`F-PILOT-1` computes `bot / (bot + manual)` from rows **inside Paperclip**. Evidence that never
reaches Paperclip at all is invisible to the denominator. So the system can report **100% while
capturing 3 of 30 real artifacts** — a perfect score for a product nobody is using. The metric
measures the split among recorded evidence, not the capture rate, and the wedge thesis is about
the capture rate.

→ **Add `G-0` — a one-week manual baseline before any build.** The PM tallies, on paper, how
many evidence artifacts a pilot engineer actually produces in a week. That count becomes the
denominator; `bot` rows become the numerator. Without it a passing pilot proves nothing. This
is a gate, not a unit: it runs in parallel with `G-1`/`G-2` and costs the PM a notepad.

### A3 — HIGH — `n = 15` cannot separate the bands it is used to call

At a true rate of 0.65, `P(≥12 of 15) ≈ 13%` — a false pass. At a true rate of 0.80,
`P(≥12 of 15) ≈ 65%`, so **35% false fail** on a plan where <50% triggers *abort the channel*.
Calling that "mechanical" converts sampling noise into a strategic reversal. It compounds:
week 1 is the novelty week, and this project's own evidence records the Discord bridge losing
to Zalo *the week it shipped* — decay is the observed failure mode, and a one-week window is
exactly the window that hides it.

→ **The band is demoted to a tripwire, and `F-PILOT-2` is promoted to the pass/fail gate.** The
plan already calls the CTO retrieval test "the actual value test" and then declined to gate on
it. Either pre-register `n ≥ 40`, or run two weeks and call the band on week 2. Records that
cannot be retrieved and used are not institutional memory, and that judgement does not degrade
at small n.

### A4 — HIGH — the evidence gate cannot be turned on

Verified: `evidenceGateEnabled` appears in exactly three places — the column definition
(`packages/db/src/schema/companies.ts:35`) and two reads (`server/src/services/issues.ts:7876`,
`:7880`). **No route, service, CLI verb, or UI control writes it.** So §9.2's "enable the flag
for the pilot company" and its stated rollback "disable the flag" both mean hand-written SQL
against production Postgres.

→ **Add `F-GATE-1` to Lane A**: a company-settings PATCH (or a `paperclipai` verb) that toggles
the flag, with an activity-log entry. It gates the pilot and appeared in none of the 47 units.
The rollback path the plan leans on in §9.2 is not executable until it exists.

### A5 — HIGH — the stated critical path omits three cross-lane edges

`F-DM-2`'s DM auth gate needs the Discord↔Paperclip identity mapping built by `F-003-1`
(Lane E, 3 days), and `F-CAP-3`'s server-side write-target validation needs it too. `F-001-2`
depends on `F-VERB-0`, crossing Lane C into Lane A. §B.7's diagram shows none of these.

→ `F-003-1` moves to day 0 alongside `F-VERB-0`. The critical path is restated:
**`F-003-1` ∥ `G-2` → `F-DM-2` → `F-CAP-1`**, with `F-011-2` (A1) now on it as well.

### A6 — HIGH — the riskiest hypothesis has no corpus and no early test

`F-CAP-4`'s ≥90% Vietnamese card-matching bar needs a corpus of real-shaped Vietnamese
messages. The plan never names its source. The realistic source is the PM's existing Zalo
threads, which needs consent and an export — an external dependency with lead time that appears
in no gate.

→ **Add `G-0b`** (obtain ~50 real messages, de-identified, day 0) and **`F-CAP-4a`**, a day-1
throwaway spike: DM handler plus one LLM call that *prints* the card it would file to and
writes nothing. About a day, and it can kill or reshape the plan before a migration is written.

### A7 — MEDIUM — unit granularity vs PR granularity is stated twice, contradictorily

The Part B convention line and `B.0.1`'s PR-batch column both assert one unit = one branch =
one PR; §B.6's batching table puts 6 units on the substrate PR, 5 on capture, 3 on providers,
3 on intake. Both readings are compliant as written.
→ **The unit is the *issue* granularity; the batch is the *PR* granularity. `B.0.1` is
authoritative.** `B.0.1` additionally gains `Status | Branch | PR` columns so an agent can tell
whether a dependency is unstarted, open, or merged — the plan told agents to branch from an
open dependency's branch without saying how to find it. One line is added on
`git rebase --onto develop <old-base-sha>` for when a squash-merge rewrites a stacked base.

### Retracted by its author

The DX voice retracted its claim that `feature/evidence-substrate` carries
`.github/workflows/*` and `CICD/*`: it had diffed against a **local** `develop` (`51fc2dbd`,
five commits behind `origin/develop` and predating the hard-fork commit `5b6db306`), which
made files already on origin appear as branch additions. Re-run against origin it is 19 files,
+4,885/-2, nothing under `.github/`, `CICD/`, `deploy/`, `backlog.md`, or `TODOS.md`. This
review's rejection of that claim (R1) stands, and the Eng voice independently confirmed zero
hits.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (via /autoplan) | 10 proposals: 7 accepted, 2 deferred, 1 → taste; 1 CRITICAL live bug found |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | UNAVAILABLE | Codex CLI not installed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (via /autoplan) | 7 issues; 0 critical gaps; test plan artifact on disk |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | SKIPPED | no UI scope |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | CLEAR (via /autoplan) | score 6/10 → 8/10; TTHW unbounded → <5 min |

**CROSS-MODEL:** not available — Codex CLI absent. All three outside voices were independent
Claude subagents (`[subagent-only]`): fresh context, same model family. Install `@openai/codex`
for an actual cross-model read. The voices still caught two errors this review made on its own
evidence, which is the argument for running them even same-family.

**VERDICT:** CEO + ENG + DX CLEARED — pending the Final Gate. Two decisions are the owner's:
UC-1 (pilot card type vs the demand persona) and T-1 (phrase table as a general i18n surface).
First actions, in order: **G-0** (manual baseline week — the metric has no denominator without
it, A2), **F-CI-1** (make CI run tests), **F-000** (open the PR for
`feature/evidence-substrate`), **F-011-2** (design the `bot` producer — nothing can write it
today, A1), **F-GATE-1** (the evidence gate cannot currently be switched on, A4).

NO UNRESOLVED DECISIONS
