---
id: T3-BACKLOG
role: backlog
status: ACTIVE
owner: tetracilin
siblings: [roadmap.md, design.md]
updated: 2026-09-01
title: T3 Backlog — master business process as user-story specs
project: Business Optimizer / T3 PM-IDE (WP-T3-PMIDE-MVP-001)
repo: tetracilin/test_ai_todo (hard fork of paperclipai/paperclip; work lands on main)
sources:
  - 3-part master-process swimlane diagrams (Viet, 2026-08)
  - INFRA-DESIGN-v1 Patch Set 003 (AD-031..AD-037)
  - Fork domain map docs/migration/test-ai-todo-domain-map.md (K6, owner-approved 2026-08-22)
  - packages/shared/src/constants.ts (APPROVAL_TYPES/STATUSES), packages/db/src/schema/external_objects.ts
  - Design record docs/designs/t3-company-os-ssot.md (SSoT restructure + WP-0 wedge, 2026-09-01)
artifact: https://claude.ai/code/artifact/0283a384-e748-4885-8f1f-78c0b2735e46
metrics:
  wp0_evidence_via_bot: ">=80%"        # pass band; 50-79% iterate one more week; <50% after 1 week = abort, revisit channel decision
  wp0_pilot_scope: "1 engineer + 1 PM, 1 week"
  pc003_onboarding_minutes: "<=30"
  pc005_teable_mirror_latency_minutes: "<=5"
  selfdev_autopr_health_review_days: "60"
---

# T3 Backlog

This file is one of the three fork-owned source-of-truth (SSoT) documents, together with
[`roadmap.md`](roadmap.md) (identity, user stories, horizons) and [`design.md`](design.md)
(architecture notes). This one carries the incremental work packages. Acceptance metrics
live in the single file-level `metrics:` map in the frontmatter above — not in per-WP
blocks.

Master business process (Pre-sales → Design → Procurement → Implement & Integration → FAT)
mapped to user-story specs for the Paperclip fork. 34 PC-xxx stories + PC-010, 6 epics,
plus WP-0 (the four-verb chat bot).

**Rules for agents working from this file:**
- Story IDs `PC-xxx` are canonical. Branches for a story are named `PC-xxx-*` (commits auto-link as evidence, see PC-007/PC-402).
- Do NOT invent new tables. Every binding below is an existing Paperclip service per the K6 domain map. (One sanctioned exception: `issue_evidence_links` — gate decision T3, 2026-09-02.)
- Confidential (defense/B2G) content never enters chat bridges (Discord/WhatsApp) or this repo (AD-021, C16). NAS drop folder only; cards carry path references.
- When a story is filed as a GitHub issue, record the issue number next to its ID here.

## Process → Paperclip mapping

| In the swimlane diagram | In Paperclip | Notes |
|---|---|---|
| Contract / customer system | `projects` | One project per contract (per opportunity in pre-sales) |
| Process phase | parent `issues` with label `WP` | WPs are parent issues via `parent_id` (K6 rule — no work_packages table) |
| Process step / job order | child `issues` | Statuses: backlog, todo, in_progress, in_review, blocked, done, cancelled |
| Phê duyệt diamond | `approvals` type `request_board_approval` | "No" loop = `revision_requested` status |
| Yellow/brown document box | `issue_attachments` / `external_objects` | The AD-032 evidence set |
| Evidence providers | `external_objects.provider_key` | `minio` (NAS bucket + sha256), `git` (commit), `teable` (row), `nas` (confidential path reference only) |
| "Section N fibery" refs | `external_objects` provider `teable` | Fibery retired (AD-022); sections live as Teable rows |
| Timeline lane (12mo / 1–3mo) | `issue_scheduling` | Max one timing row per issue |
| Swimlane actor | `issues.assignee_user_id` | Single assignee; RACI dropped in K6 |
| Dossier (AD-034) | `issue_documents` key `dossier` | Same mechanism as existing `definition-of-done` key |
| Red annotations | Open questions OQ-1..OQ-5 | Never silently resolve |

**Actors:** Sale · Giám đốc (Director) · Trưởng nhóm (Team lead) · Kỹ sư cơ khí/điện tử ·
Sourcing · Nhóm hỗ trợ · Phòng hợp đồng · Design UI/UX · Software/Firmware · Document writer ·
Kế toán — plus: engineer's personal agent (`eng-<name>` via `hermes-gateway` adapter), PM/moderator,
CTO, Hermes worker agents as assignees (AD-031).

---

## Epic 0 — Recorder platform (PC-001..010) + WP-0

Slice 1 is staged in two layers (OV-2): **the recorder substrate first** — PC-001
(evidence gate), PC-002 (dossier), PC-004 (intake), PC-007 (evidence linking), PC-011
(evidence provenance/wedge metric) — then
**WP-0, the four-verb chat bot, on top of that substrate**, both inside Slice 1's
one-engineer pilot. The bot is not staged ahead of the cards it files against.
PC-008/009 bridge platform → process in Slice 2.

### Substrate — build first [Slice 1]

#### PC-001 Evidence gate on Done — [CTO] [Slice 1]
As the CTO, I want the `done` transition blocked unless a card has ≥1 linked evidence artifact,
so that unrecorded work cannot count as finished (AD-032).
1. `PATCH /api/issues/:id` → `done` rejected with actionable error when issue has 0 evidence links (`issue_attachments` or `issue_evidence_links` rows — the gate never counts mention rows; see PC-007 AC7 / gate decision T3).
2. Rejection names accepted evidence types and the chat phrase to file one via the agent.
3. Successful close writes an `activity_log` entry with the evidence count.
4. Enforcement is a server-side transition hook; reconciliation cron that reopens violators is MVP-only (C14).
5. Evidence counts per engineer per WP queryable for WP-close export.
6. The gate sits behind a per-company feature flag (default off until pilot onboarding); disabling the flag restores the old `done` transition without a redeploy — the rollback path. Hook placement *(refined by /autoplan eng review 2026-09-02)*: the gate is enforced at the **single point where the final issue patch is committed** (post-transition, pre-write) — NOT inside `applyIssueExecutionPolicyTransition`, which is a pure function (no DB access) and can itself emit `patch.status="done"`. `done` is producible via at least three route paths (main PATCH, comment-decision approval, restore/relation), so gate tests must exercise ALL of them. *(added by /autoplan CEO review 2026-09-01)*
8. Race safety: the evidence count is read in the same transaction as the status write (no check-then-write window against PC-007 AC6 unlink); the reopen path (done → evidence unlinked → re-done) is explicitly tested. *(added by /autoplan eng review 2026-09-02)*
7. Junk cards (duplicate, obsolete, created by mistake) are closed as `cancelled`, which the gate does not block — the intended escape; the rejection message says so. No per-card gate override exists, deliberately. *(added by /autoplan DX review 2026-09-01)*
- Binding: `issues.status`, `activity_log`, `issue_attachments`, `issue_evidence_links` (new, gate T3), `server/src/services/issue-execution-policy.ts`

#### PC-002 Dossier document on every card — [Engineer] [Slice 1]
As an engineer, I want my agent to maintain a dossier on every card, so that job order,
clarifications, and scope changes are recorded without me writing them up (AD-034).
1. Every intake-created card has `issue_documents` key `dossier`, sections: Job order · Clarifications · Evidence log · Scope changes · Related Teable rows.
2. Scope-change entries timestamped by the agent and mirrored as issue comments.
3. Scope-change timestamps queryable — the CTO's replanning-latency signal.
4. Dossier renders in card UI and exports cleanly as markdown.
5. One example dossier is checked in as a fixture (doubles as the export test fixture) so
   its consumers — the agent, the export, the CTO retrieval test — share one concrete
   shape, including how a chat-message-id ↔ card correlation line reads. *(added by /autoplan DX review 2026-09-01)*
- Binding: `issue_documents("dossier")`, `issue_comments`, `activity_log`

#### PC-004 Job-order intake via chat — [Engineer] [Slice 1]
As an engineer, I want to forward a job order to my agent and get a card back, so that every job
order becomes a recorded card with zero form-filling.
1. Forwarded message → issue with title, description, seeded dossier, assignee = engineer, project resolved (or triage label).
2. Agent replies with card link and asks clarifying questions; answers land in dossier Clarifications.
3. Confidential content refused with NAS drop-folder instructions; nothing stored (AD-021, C16).
4. Re-forwarding does not duplicate cards (idempotency fingerprint).
- Binding: chat bridge (Discord DM — pilot channel per gate decision 2026-09-02; WhatsApp/Zalo per later WP), `POST /api/companies/:id/issues`, `issue_documents("dossier")`

#### PC-007 Evidence linking via agent — [Engineer] [Slice 1]
As an engineer, I want to hand my agent a file or link and have it filed as evidence, so that
passing the gate costs one chat message.
1. Chat file → NAS MinIO evidence bucket + linked with SHA-256 (provider `minio`).
2. Git commit URL/hash verified against fork remotes and linked (provider `git`); branches `PC-xxx` auto-link commits.
3. NAS confidential path recorded as path reference only — no bytes leave NAS (provider `nas`).
4. Teable row URL links as provider `teable`.
5. Every linkage appends one line to dossier Evidence log.
6. Mis-filed evidence noticed later has a correction path: unlink/move (chat phrase + UI
   action) writes an `activity_log` entry and a dossier correction line — never a silent
   deletion. *(added by /autoplan DX review 2026-09-01)*
7. **Evidence-link write path** *(added by /autoplan eng review 2026-09-02 — code
   inspection found no direct issue↔external_object linkage; the only existing one is
   `external_object_mentions`, a text-detection table with `objectId` nullable and
   `onDelete: SET NULL` — dangling rows must never satisfy the PC-001 gate)*: a
   first-class evidence-link mechanism is an explicit deliverable of this story.
   **Mechanism DECIDED (gate T3, 2026-09-02): a new `issue_evidence_links` table** —
   the "no new tables **without cause**" rule's exception applies (this is cause); the
   mention-rows alternative was rejected for its SET-NULL/detector semantics. The gate
   query counts only `issue_evidence_links` rows (and attachments), and static evidence rows must sit
   cleanly in the external_objects refresh machinery (liveness=unknown, no resolver-error
   spam) — one test.
- Binding: `external_objects`, `issue_attachments`, NAS MinIO (storage plane, AD-028)

#### PC-011 Evidence provenance & wedge metric — [CTO] [Slice 1] *(added by /autoplan CEO review 2026-09-01)*
As the CTO, I want every evidence row to record how it arrived, so that the wedge metric
`wp0_evidence_via_bot` is queried from the system instead of hand-tallied (design-record
OV-5 — the pilot's pass/iterate/abort bands are unmeasurable without this).
1. Evidence provenance is **per filing act, not per object** *(reconciled with gate T3, 2026-09-02)*: the `source text NOT NULL DEFAULT 'manual'` (`bot` | `manual`) column lives on `issue_evidence_links` (the link row IS the filing act — one object can be bot-linked on one card and manually linked on another) and on `issue_attachments`. No column on `external_objects`. Additive, backward-compatible migrations; a headline metric queries real columns, not JSONB.
2. Bot-filed evidence (PC-007 via chat) writes `source=bot`; UI/API-filed evidence defaults to `manual`.
3. The ratio bot/(bot+manual) over a date range is queryable per engineer and per WP — one query answers the pilot band (≥80% pass / 50–79% iterate / <50% abort).
4. The ratio is included in the PM digest (WP-0 verb 3) and the WP-close export (PC-006).
- Binding: `issue_attachments`, `issue_evidence_links` (new, gate T3), `activity_log`

### WP-0 — four-verb chat bot (on top of the substrate) [Slice 1]

**Channel decision (owner, /autoplan Final Gate 2026-09-02): the pilot runs
Discord-only.** The wedge delivery vehicle is a **Discord DM evidence-and-briefing
bot** — the conversational verb pipeline built channel-agnostically on the shipped
Discord transport (see the honest-delta note below: the DM/capture surface is new work
even on Discord). **WhatsApp re-scopes to a later work package**, taken up only after
the four verbs prove out in the pilot; the channel comparison (WhatsApp vs Zalo OA —
usage check, API capability/cost snapshots, the 2026-10-01 per-message AI-reply billing
change) runs as a post-pilot input to that decision. It reuses the substrate above:
PC-004 intake, PC-007 evidence linking, PC-002 dossiers, with PC-003 onboarding as the
entry step.

> **Honest delta note** *(added by /autoplan DX review 2026-09-01)*: the shipped Discord
> bridge is a **slash-command + notification transport** (`/paperclip task create`,
> Guilds intent only, explicitly no message-content intent — see
> `discord-bridge/README.md`). Conversational capture (free-form Vietnamese messages,
> photos, an LLM in the loop) is **not shipped on any channel**. WP-0 therefore builds
> the channel-agnostic conversational verb pipeline once, on the Discord DM surface —
> the pilot's delivery vehicle (gate decision 2026-09-02) — with message-content/DM
> handling added to the Discord side. A later WP binds the WhatsApp (or Zalo) transport
> to the same pipeline; the WhatsApp webhook dev story (recorded fixtures vs tunnel)
> belongs to that WP. "Discord is shipped" is true of the transport and its server
> contracts (actor resolution, idempotency, outbox), not of capture.

Four verbs:

1. **Capture** — photo/message → agent structures into `{card, evidence_type, caption}`,
   confirms in one line, correction path included ("wrong card? reply the number").
2. **Re-brief** — "brief" (or proactive at task checkout): current card, open evidence
   gaps, next task.
3. **PM digest** — daily summary to PM/CTO: evidence filed, cards blocked on missing
   evidence — replacing the PM's manual summary.
4. **Tabular records** — agent files structured data (an OEM row, a BOM item) into
   Teable and links the row on the card (provider `teable`) — delivered by PC-010.

**Language boundary:** all four verbs talk to engineers in **Vietnamese**; code,
prompts, docs, and agent internals stay **English** — the switch lives in the agent's
system prompt. Captured content (captions, clarifications, evidence descriptions) stays
**verbatim Vietnamese** (it is evidence, never machine-translated at capture);
structure (card titles, dossier section headers, story IDs) is English; the agent may
add an English one-line gloss on filing.

**Confidential content — structural control (OV-9):** per C16, confidential
(defense/B2G) projects are **never onboarded to chat bots at all** — their engineers use
the NAS drop-folder path exclusively. Bot-side refusal (PC-004 AC3: refuse with NAS
instructions, store nothing) is defense-in-depth against accidental sends on
non-confidential projects only, because refusal fires after content has already
transited the chat platform's servers.

**Pilot protocol** *(added by /autoplan CEO review + outside voice, 2026-09-01)*:
- **Pre-build gates:** (a) the PM observation session (design-record Assignment) is DONE
  before WP-0 build starts — her workflow is the bot's spec; (b) the Discord
  privileged-intent request (message content / DM) is filed immediately — external lead
  time on the pilot's critical path now that Discord IS the pilot channel; (c) the PM's
  and CTO's Discord accounts are linked as digest recipients (verb 3 DMs them daily —
  nobody's AC otherwise).
- **The Discord DM surface IS the pilot build** *(gate decision 2026-09-02 — the former
  "Stage 0 smoke" is now the delivery vehicle itself)*. **Honest sizing *(/autoplan eng
  review)*: this is a real feature, not glue** — the shipped bridge (~718 lines, Guilds
  intent, slash-commands + outbox) has no message handler, DM path, or media path.
  Pilot-surface ACs: (a) message-content/DM privileged-intent request filed first
  (external lead time); (b) DM auth gate — DMs from unlinked Discord users are ignored
  (anyone can DM a bot); (c) media fetch path; (d) its own DM-surface tests. Budget
  ≈1 week; the conversational verb pipeline is channel-agnostic — a later WhatsApp (or
  Zalo) work package binds a second transport to it.
- **Measurement validity:** the band evaluation (`wp0_evidence_via_bot`) requires a
  minimum n of 15 evidence items — below that, extend the window rather than call the
  band. The band call is mechanical: the PC-011 query output decides; no judgment call.
- **PM engagement signal:** PM reads/acts on the digest ≥4 of 5 pilot days — championship
  is tested, not assumed.
- **Retrieval test (the actual value test):** at pilot end, the CTO answers 3 real
  questions from dossiers/WP-close export alone. Records that cannot be retrieved and
  used are not institutional memory.

**Known risk and abort criterion** *(reframed by gate decision 2026-09-02)*: Discord is
not a proven adoption path — field behavior already routed around it once (the Zalo
observation). That is now the pilot's explicit second question, cleanly separated from
the verb question by the accuracy bar (op AC7's ≥90% card matching distinguishes "the
verbs failed" from "the channel failed"). The abort criterion stands: **if after one
week <50% of evidence arrives via the bot, stop and run the channel comparison
(WhatsApp Business vs Zalo OA — usage, API capability, cost incl. the 2026-10-01
per-message AI-reply billing)** rather than pushing adoption uphill. Pass/iterate/abort
bands live in the frontmatter `metrics:` map (`wp0_evidence_via_bot`).

**Operational acceptance criteria** *(added by /autoplan CEO review 2026-09-01 — the
zero-silent-failures set. Channel re-scope, gate decision 2026-09-02: WhatsApp-specific
items — AC1's webhook signature/raw-body mechanics, AC4's 24h-window/template handling,
AC12's Meta per-message billing, **AC8's WhatsApp-outage/template-rejection/phone-remap
runbook rows, and AC9's webhook-retry framing** — activate with the later WhatsApp work
package; their channel-generic intent applies to the Discord DM pilot now: DM auth gate
in place of webhook signatures, no proactive-window constraint on Discord, LLM spend
governed by the existing budgets subsystem / AD-037 `max_turns`, pilot runbook rows for
**Discord gateway outage/disconnect and Discord-account relink**, and AC9's
persist-and-replay guarantee holding across gateway disconnects.)*:
1. Webhook security: the WhatsApp (and any future channel) webhook endpoint verifies the
   platform signature (`X-Hub-Signature-256` with app secret) **computed over the RAW
   request body** (JSON re-serialization breaks the HMAC — the raw-body middleware
   ordering is a named implementation constraint), rejects unsigned payloads with 401,
   and 200-acks + logs malformed ones (platform retry storms otherwise). The endpoint —
   this fork's first internet-facing surface (Discord uses the gateway, not a webhook) —
   carries a rate limit and a body-size cap; media fetched from Meta passes a
   content-type allowlist before landing in the evidence bucket. Secrets go through the
   existing server secrets service (named secret refs). *(hardening added by /autoplan eng review 2026-09-02)*
2. LLM structuring fallback: when the structuring output is malformed, empty, or a
   refusal — re-prompt once, then file the raw message as an unstructured capture on a
   triage-labeled card and tell the engineer in one line. Capture is never silently lost.
   Capture architecture *(refined by /autoplan eng review 2026-09-02)*: capture is a
   deterministic bridge-side pipeline with exactly **one bounded, schema-constrained LLM
   structuring call** — full `eng-<name>` agent sessions (max_turns=150) are reserved for
   re-brief and clarification turns, so a photo never spins an agent loop (cost, latency,
   and head-of-line blocking at 17-staff scale). Message pairing: a media message and a
   following text from the same sender within a short window (photo first, caption next —
   the common field pattern) form ONE capture; an engineer with zero open cards routes to
   the triage card explicitly.
3. Message content is data, not instructions: captured captions/clarifications are filed
   verbatim and never executed as agent directives. Enforcement is server-side, not
   prompt-side *(refined by /autoplan eng review 2026-09-02)*: whatever the LLM output
   names, the write target is validated against PC-003 AC2 scoping (assignee/creator)
   and the PC-010 allowlist before any write — an injected "file to card #999" fails at
   the API, not in the prompt. The op-AC7 eval suite includes adversarial Vietnamese
   injection cases.
4. Outbound-window handling: proactive sends (re-brief, digest) that fall outside the
   WhatsApp 24-hour window use an approved template or queue until the window reopens —
   a runtime behavior, not just a policy note.
5. Digest reliability: digest delivery failure raises an operator alert (a silent missing
   digest is the failure mode that recreates the PM's manual summary); an empty day still
   sends a one-line "no evidence filed today" so absence is visible.
6. Adoption-drop alarm: engineer usage metrics are instrumented with an alarm when
   captures/day falls below the pilot baseline (design-doc DoD item, now owned here).
7. Vietnamese structuring eval set: a small checked-in eval suite exercises the capture
   verb on real-shaped Vietnamese messages (diacritics, emoji-only, photo-with-caption,
   photo-then-caption-seconds-later, forwarded-of-forwarded, adversarial injection
   attempts) and gates prompt changes. Passing bar: **≥90% correct-card
   matching** on the eval set before pilot start; the live mis-file rate is tracked so a
   50–79% band outcome can be diagnosed as a channel problem vs an accuracy problem.
8. Runbook deliverable: one named home — `doc/WP0-OPERATIONS.md` — carries all WP-0
   runbooks as its TOC, a pilot-start gate deliverable: WhatsApp outage, template
   rejection, media-fetch failure, **agent-runtime-down response, MinIO/NAS outage,
   Teable outage during PC-005 sync, digest-alert response, secrets rotation, and
   phone-number remap (engineer changes number/device — relink procedure)**. The
   engineer's realistic manual fallback ("hand it to the PM", who files via UI with
   `source=manual`) is written down, not implicit.

*(Op ACs 9–12 added by /autoplan DX review + outside voice, 2026-09-01)*:

9. Capture survives agent downtime: the bridge persists inbound messages independently
   of agent availability and replays them on recovery (webhook retries only cover
   webhook-down, not agent-down behind a live webhook). Downtime >15 min sends one
   automated Vietnamese status message per affected engineer; pilot-day downtime is
   logged so the band call can discount it. The MinIO-failure reply states *who* retries
   ("mình sẽ thử lại trong 5 phút" vs "gửi lại giúp mình"), and a failed capture clears
   its idempotency fingerprint so an engineer resend is never dropped as a duplicate.
10. Canonical Vietnamese phrase table: verb → phrase + accepted aliases, one checked-in
    artifact imported by BOTH the agent system prompt and error-message templates — a
    rejection can never name a phrase the bot doesn't answer to. Includes a help verb
    ("trợ giúp") returning the table, and the bot's 4-line Vietnamese first message to a
    newly linked engineer. The table is the PC-003 quickstart appendix. Gate rejections
    (PC-001 AC2) reaching the engineer via the agent are relayed as one Vietnamese line
    naming the card and the filing phrase.
11. Alert routing is named: all operator alerts (digest failure, adoption drop, webhook
    error-rate) land in one channel the maintainer demonstrably watches daily; the
    digest-failure alert is tested end-to-end (fires → seen) before pilot start.
12. WhatsApp spend control: from 2026-10-01 Meta bills service replies sent by AI agents
    *inside* the 24-hour window per-message — every bot confirmation is billable, not
    just proactive templates. The bot's channel spend runs under the existing budgets
    subsystem with a hard cap + alarm; per-pilot-week cost is reported in the PM digest.

#### PC-010 Agent tabular read/write to Teable — [Engineer/PM] [Slice 1 · WP-0 verb 4]

> **Pilot staging (gate decision T2, 2026-09-02):** Slice 1 ships the **append-only
> subset** — writes create new rows in ONE allowlisted table, reads per AC5, row linked
> per AC4, **and the AC6 write-attribution marker (dedicated bot account — cheap and
> required in Slice 1: PC-005's conflict flagging also ships in Slice 1 and must never
> fire on the bot's own rows)**. The full machinery (multi-table allowlist framework,
> per-table schema maps, update-with-conflict policy of AC2/AC3) moves to **Slice 2**,
> where PC-203 needs it anyway. Rationale: largest new-code surface in Slice 1, least coupled to the wedge
> metric. ACs 2/3/6 below are the Slice-2 spec, kept here so the pilot subset is built
> toward them.
As an engineer, I want my agent to read and write Teable rows directly (an OEM catalog
row, a BOM line item, a dossier section), so that structured data is filed into the
system of records from chat, not typed in later. PC-005 stays one-directional card
mirroring; this story is the separate, bidirectional tabular capability.
1. An explicit allowlist declares which Teable bases/tables are agent-writable; writes outside it are refused with an actionable message.
2. Schema mapping is declared per table (agent field → Teable column, types validated); unmappable payloads are rejected, never partially written.
3. Write conflict policy: agent writes never overwrite newer human edits — a conflicting write is surfaced on the card as a conflict comment for human resolution (last-writer-wins is not acceptable for human edits). Mechanism: read-before-write with row `lastModifiedTime` compare; on mismatch the write is withheld and the conflict comment links both versions. *(mechanism added by /autoplan CEO review 2026-09-01)*
4. Every write links the created/updated row on the originating card as an external object (provider `teable`) and appends one dossier Evidence-log line.
5. Reads let the agent answer "what's in table X for Y" in chat without granting write scope.
6. Write attribution, shared with PC-005 *(added by /autoplan eng review 2026-09-02)*: agent and mirror writes carry an attribution marker (dedicated bot account or marker field) so PC-005's "Teable-side edits flagged as conflicts" never fires on PC-010's own writes, and PC-010's `lastModifiedTime` compare never trips on PC-005 mirror writes. Known limitation, accepted at pilot scale: compare-then-write has a race window (no cross-system transaction); the conflict comment is the recovery, not prevention.
- Binding: `external_objects(provider=teable)`, Teable REST, `issue_documents("dossier")`, `activity_log`

### Supporting platform [Slice 1]

#### PC-003 Personal agent onboarding — [Engineer] [Slice 1]
As an engineer, I want a personal agent in chat bound to my Paperclip identity, so that the
recorder works for me instead of me working for it (AD-033).
1. Hermes profile `eng-<name>` registered through existing `hermes-gateway` adapter as an `agents` row.
2. Chat user ↔ Paperclip user mapping; agent acts only on cards where that engineer is assignee or creator.
3. `max_turns` defaults to 150 (AD-037 spend governor).
4. Onboarding splits into three deliverables *(split by /autoplan DX review 2026-09-01)*:
   (a) a one-time **environment pre-provisioning runbook** (Discord bot app +
   privileged intents + token secret, Hermes gateway, secrets — explicitly outside the
   30-minute clock; Meta app/template items move to the later WhatsApp WP); (b) a **per-engineer
   runbook** with numbered steps whose acceptance evidence is a *timed dry-run on a fresh
   engineer* recorded next to the `pc003_onboarding_minutes` metric — the clock starts at
   "engineer's chat account known" and stops at "first capture confirmed"; (c) a
   **one-page Vietnamese engineer quickstart** (~5 min: link your Discord, DM the bot a
   job order, type "brief"). The hermes join flow's board-approval step is pre-approved/
   batched for `eng-<name>` profiles so onboarding cannot stall on an absent approver.
- Binding: `packages/adapters/hermes-gateway`, `agents`, chat bridge (Discord DM — pilot channel per gate decision 2026-09-02; WhatsApp/Zalo per later WP), `doc/HERMES_GATEWAY_ONBOARDING.md`

#### PC-005 Teable row sync — [PM] [Slice 1]
As the PM, I want cards mirrored into Teable rows, so that the Teable board stays the GUI for the
17 office-software staff (AD-022, AD-027).
1. Card create/status/assignee changes propagate to base "Tecotec CN" within 5 minutes.
2. Teable row linked on the card as external object (provider `teable`).
3. Direction Paperclip → Teable for MVP; Teable-side edits flagged as conflicts, never overwritten. (Agent-authored Teable writes are PC-010, not this story.)
4. Sync failures surface in activity log and retry with backoff.
- Binding: `external_objects(provider=teable)`, Teable REST, Hermes cron

#### PC-006 WP-close export to T3-wiki — [CTO] [Slice 1]
As the CTO, I want closing a WP to export dossiers, activity, and evidence index to the wiki repo,
so that the system loop runs on records, not recollection (AD-034).
1. Closing a parent issue labeled `WP` generates a markdown bundle: per-card dossier, activity summary, evidence index (links, hashes, counts), scope-change timeline.
2. Bundle committed to `Tecotec-JSc/T3-wiki`; confidential = NAS path references only, never content (AD-026).
3. CTO notified in chat with commit link within 24h of close.
4. Export refuses while any child is neither `done` nor `cancelled`.
5. One example export bundle (per-card dossier + evidence index + scope-change timeline)
   is checked in as a fixture — the evidence-index schema is specified by example, and
   the CTO retrieval test runs against this shape. *(added by /autoplan DX review 2026-09-01)*
- Binding: `issues(parent, label=WP)`, `activity_log`, git push T3-wiki

### Bridge to process [Slice 2]

#### PC-008 Master-process template — [PM] [Slice 2]
As the PM, I want a new contract instantiated as a project with phase WPs and stage cards from a
template, so that the master process is the default shape of work.
1. Template creates 5 phase WPs (Pre-sales · Design · Procurement · Implement & Integration · FAT) as parent issues, with this backlog's stage cards beneath each.
2. Each stage card carries checklist + required-evidence list in its dossier.
3. `issue_scheduling` seeded from phase timeboxes (pre-sales ≈12mo, design 1–3mo).
4. Template versioned in the fork repo; applies idempotently.
- Binding: `projects`, `issues(parent_id)`, `issue_scheduling`

#### PC-009 Approval gates for Phê duyệt diamonds — [Director] [Slice 2]
As the Director, I want every Phê duyệt diamond recorded as an approval, so that who approved
what, when, is never reconstructed from memory.
1. Gate cards create `approvals` type `request_board_approval` linked via `issue_approvals`.
2. "No" = `revision_requested` with note; reopens the loop-back card exactly as the diagram routes.
3. Customer approvals recorded by Sale on the customer's behalf with email/minutes as evidence — customers are never Paperclip users.
4. Downstream stage cards blocked via `issue_relations(type=blocks)` until gate approved.
- Gates: #1 khái toán/báo giá · #2 proposal · #3 hồ sơ thầu · #4 design
- Binding: `approvals`, `issue_approvals`, `issue_relations`

---

## Epic 1 — Pre-sales (PC-101..107) [Slice 3, timeline ≈12 months]

Gợi ý → meeting → danh mục đề xuất → đề cương chi tiết → proposal → đấu thầu → hợp đồng.
Defense/confidential opportunities stay OUT until C16 is resolved.

### PC-101 Opportunity intake & first meeting — [Sale]
As Sale, I want a customer gợi ý to open an opportunity with a meeting card, so that pre-sales
work is recorded from first contact.
1. Opportunity project (or parent card) created; meeting card (1) lists attendees from both sides.
2. Customer đề cương / mục tiêu chung filed into dossier when received.
3. Meeting minutes linked before close.
- Evidence: meeting minutes, customer đề cương

### PC-102 Danh mục đề xuất & báo giá — [Trưởng nhóm]
As the Team lead, I want the proposal-catalog card (2) to carry its full artifact set, so that
gate #1 judges a complete package.
1. Cannot close without equipment list + quotation linked.
2. Khái toán, datasheets, solution description linked as produced.
3. Gate #1 (customer, recorded by Sale) per PC-009; "No" loops to Director.
- Evidence: danh mục thiết bị, khái toán, datasheet, mô tả giải pháp, báo giá

### PC-103 Đề cương chi tiết — [Trưởng nhóm]
As the Team lead, I want the detailed-outline card (3) built from the customer's objectives, so
that scope is written before proposal effort is spent.
1. Outline document ("gồm có gì") is the closing evidence.
2. Customer clarifications captured in dossier, not private chat threads.
- Evidence: đề cương chi tiết

### PC-104 Liên hệ với hãng — [Kỹ sư]
As an engineer, I want vendor contact (4) recorded on its own card, so that vendor quotes and
datasheets are evidence, not inbox archaeology.
1. Vendor correspondence + received quotes/datasheets filed by the agent.
2. Outcomes feed PC-102's artifact set.
- Evidence: vendor thread, vendor quote

### PC-105 Proposal build: concept → TSKT → proposal — [Trưởng nhóm + Kỹ sư]
As the Team lead, I want the proposal built through its real sub-steps, so that gate #2 sees the
concept chain, not just the final PDF.
1. Sub-cards: tham khảo hệ thống tương tự · dựng concept · tìm OEM · làm prototype · trao đổi với OEM · làm TSKT · viết proposal.
2. Cannot pass gate #2 without Proposal + BOM ver0 linked; TSKT + thuyết minh kỹ thuật linked as produced.
3. Sourcing's BUC (Business Use Case) is a required sibling artifact.
- Evidence: proposal, catalog, thuyết minh kỹ thuật, BOM ver0, TSKT, BUC

### PC-106 Đấu thầu — [Sale]
As Sale, I want the bid recorded with its dossier and outcome, so that win/loss and reasons
accumulate as data.
1. Hồ sơ thầu is closing evidence; gate #3 approval per PC-009.
2. Outcome (win/loss + reason) recorded on close — feeds win-rate analytics.
- Evidence: hồ sơ thầu

### PC-107 Hợp đồng — [Sale + Giám đốc]
As the Director, I want the contract card to capture the points T3 must hold for legal backup, so
that phòng pháp chế has a record, not a rumor.
1. Signed hợp đồng is closing evidence.
2. Dossier records contract key points (scope per OQ-1).
3. Approval unlocks the Design WP (issue_relations block released).
- Evidence: hợp đồng (signed), contract key-points note

---

## Epic 2 — Design (PC-201..205) [Slice 2, timeline 1–3 months]

### PC-201 BOM ver n lifecycle — [Trưởng nhóm]
As the Team lead, I want every BOM revision filed with a version label, so that "which BOM did we
buy against" always has one answer.
1. Each BOM ver n attached with version; latest flagged.
2. Revision rationale = one dossier line per version.
- Evidence: BOM ver n (each)

### PC-202 BUC & PUC — [Giám đốc + Trưởng nhóm]
As the Director, I want BUC and PUC as evidence-gated cards, so that business and product cases
exist in writing before detail design.
1. Viết BUC (Director) and Viết PUC (Team lead) are separate cards; each closes only with its document linked.
- Evidence: BUC, PUC

### PC-203 Design dossier sections 1–6, 8 → Teable — [Trưởng nhóm]
As the Team lead, I want one card per design-dossier section with its Teable row as evidence, so
that the design record lives in the system of record.
1. Cards: S1 Mục tiêu bối cảnh · S2 Phạm vi công việc · S3 Block diagram · S4 REQ Specification · S5–6 Risk & decision · S8 Procedure/FAT.
2. Each closes with Teable row linked (provider `teable`) plus rendered doc where one exists.
3. Diagram's "fibery" refs are migrated references — no Fibery writes.
- Evidence: Teable rows S1–S6+S8, block diagram, REQ spec

### PC-204 Wiring diagram & thiết kế cơ khí — [Kỹ sư cơ khí/điện tử]
As a mech/electronics engineer, I want design cards gated on drawings, so that the internal design
gate reviews artifacts, not descriptions.
1. Wiring-diagram card closes with diagram + BOM contribution linked.
2. Mech-design card closes with BOM, 3D, 2D linked.
3. Gate #4 "No" reopens the mech-design card per the diagram loop.
- Evidence: wiring diagram, BOM, 3D, 2D

### PC-205 Chốt & handover thiết kế — [Giám đốc]
As the Director, I want design freeze/handover as an approval that assembles the handover package
from linked evidence, so that Implement & Integration receives one complete dossier (red note 5).
1. Freeze requires gate #4 approved and PC-201..204 evidence complete; handover package = auto-assembled evidence index.
2. Receiving card "Nhận chuyển giao thiết kế chi tiết" created and acknowledged by its assignee.
3. Dossier structure/approval authority follow OQ-2 decision.
- Evidence: handover package (index)

---

## Epic 3 — Procurement (PC-301..305)

The most evidence-native part of the process (B1–B5 already mandates media). Diagram note
"Quá sơ sài" → epic finalizes only after OQ-3.

### PC-301 PO qua phòng hợp đồng — [Sourcing] [Slice 2]
As Sourcing, I want the PO request recorded with its ĐNĐH, so that the contract-department
handoff is traceable.
1. ĐNĐH document is closing evidence; PO references the BOM version it buys against (PC-201).
2. Trade terms / delivery / storage / payment fields follow OQ-3.
- Evidence: ĐNĐH

### PC-302 Nhận hàng B1–B5 checklist — [Sourcing + Kỹ sư] [Slice 2]
As Sourcing, I want the goods-receipt card to demand B1–B5 evidence, so that vendor disputes are
settled by our records.
1. B1: packaging condition photos (rách, móp méo, ẩm ướt).
2. B2: unboxing photos/video + model & quantity check.
3. B3: CO, CQ, vendor test report scans.
4. B4: technical inspection photos/video (ngoại quan, test nguồn, kết nối).
5. Cannot reach `done` without B1–B4; B5 (vendor issue log) required only when an issue arises.
- Evidence: B1 photos, B2 video/photos, B3 CO·CQ·test report, B4 test media, B5 issue log

### PC-303 Mua hàng từ BOM — [Nhóm hỗ trợ / Sourcing] [Slice 3]
As Sourcing, I want purchases tied to the BOM lines they fulfil, so that cost actuals reconcile
against BOM ver n.
1. Purchase cards reference BOM version + lines; hoá đơn, phiếu thu, phiếu xuất kho linked before close.
- Evidence: hoá đơn, phiếu thu, phiếu xuất kho

### PC-304 Đề nghị thanh toán → Kế toán — [Sourcing + Kế toán] [Slice 3]
As Sourcing, I want payment requests and settlement recorded, so that the money trail closes on
the same card chain as the goods.
1. Đề nghị thanh toán = request evidence; giấy giao nhận tiền closes the chain.
- Evidence: đề nghị thanh toán, giấy giao nhận tiền

### PC-305 Theo dõi hàng về — [Sourcing] [Slice 3]
As Sourcing, I want incoming-goods status visible on procurement cards, so that engineers see
arrival dates without asking.
1. Status updates from phòng hợp đồng land as comments/status on the PO card; expected dates in `issue_scheduling`.

---

## Epic 4 — Implement & Integration (PC-401..406)

Red boxes in diagram part 3 (assembly, wiring, tests, integration, manual) = weakest current
records; they gain the most from the gate.

### PC-401 Vẽ UI/UX — [Design UI/UX] [Slice 2]
As the UI/UX designer, I want my card to close on the Figma link, so that design handoff is a
recorded artifact.
1. Figma URL linked as external object; handoff to SW/FW additionally requires flow spec per OQ-4.
- Evidence: UI/UX on Figma

### PC-402 Dev software / firmware — [Software/Firmware] [Slice 1 · PILOT]
As a software engineer, I want my dev card to auto-collect commits and require a complete brief
before I start, so that "no flowchart, only UI" never reaches a coder again (red note).
1. Cannot enter `in_progress` without a linked brief (flowchart / REQ spec / PUC reference).
2. Commits on branches `PC-xxx` auto-link as evidence (provider `git`).
3. Close requires ≥1 commit + demo + test report linked.
4. THIS IS THE SLICE 1 PILOT CARD TYPE — the first engineer's real job orders run through it end-to-end.
- Evidence: git commits, demo, test report

### PC-403 Gửi bản vẽ đi gia công — [Kỹ sư cơ khí] [Slice 2]
As a mechanical engineer, I want fabrication send-out and QC recorded, so that supplier quality
issues are arguable with photos, not memory.
1. Sent drawing package linked; QC checklist + inspection photos linked on return.
- Evidence: drawing package, QC checklist, photos

### PC-404 Lắp ráp · đi dây · test điện — [Kỹ sư cơ khí/điện tử] [Slice 2]
As an engineer, I want assembly, wiring, and power/connectivity tests as evidence-gated cards, so
that the physical build has the same record discipline as code.
1. Three cards (lắp phần cơ khí · đi dây · test thông điện và kết nối), each closing with photos/video and test report where applicable.
- Evidence: build photos/video, test report

### PC-405 Tích hợp hệ thống — [Software/Firmware] [Slice 2]
As the integration owner, I want integration to close on its test report, so that FAT starts from
a verified baseline.
1. Integration test report linked; blocks FAT card until done.
- Evidence: integration test report

### PC-406 Viết manual — [Document writer] [Slice 2]
As the document writer, I want the manual card fed by linked design evidence, so that the manual
is written from the dossier, not interviews.
1. Manual linked before close; source references list the evidence objects used.
- Evidence: manual

---

## Epic 5 — FAT & close (PC-501..502)

### PC-501 FAT — [All implement lanes] [Slice 2]
As the Team lead, I want FAT run against the S8 procedure with its report as closing evidence, so
that acceptance is a record, not a ceremony.
1. FAT card blocked until PC-405 closes; executes S8 procedure (PC-203).
2. FAT report linked; customer sign-off recorded as approval per PC-009.
3. FAT close is the trigger condition for phase WP close (PC-006 export).
- Evidence: FAT report

### PC-502 CTO close loop & performance record — [CTO] [Slice 3]
As the CTO, I want per-engineer evidence counts and scope-change timelines in every WP-close
export, so that the performance record builds itself (AD-032).
1. Export includes evidence count + dossier completeness per engineer per WP.
2. Scope-change timeline shows first-signal timestamps — the replanning-latency metric.
3. Pay linkage explicitly OUT of scope until a separate announced decision — the record accrues from Slice 1, the consequence does not.

---

## Open questions

| ID | Question | Blocks | Owner |
|---|---|---|---|
| OQ-1 | Contract points T3 must capture for legal backup; contract types; management rigor per work level | PC-107 final AC | Giám đốc + phòng hợp đồng |
| OQ-2 | Design dossier structure, approval authority, handover format (red note 5) | PC-205 final AC | Viet |
| OQ-3 | Procurement "quá sơ sài": trade terms, physical receipt, storage, payment | Epic 3 finalization | Sourcing + phòng hợp đồng |
| OQ-4 | Is a flowchart mandatory for every SW card; UI/UX vs nguyên lý split or merge | PC-401/402 | Viet + SW lead |
| OQ-5 | Process after FAT (SAT, delivery, installation, warranty)? Needs Epic 6 if yes | scope boundary | Viet |
| C13 | **RE-DECIDED (owner, /autoplan gate 2026-09-02): the pilot runs Discord-only** — the Discord DM surface is the wedge delivery vehicle; WhatsApp re-scopes to a later work package taken up after the four verbs prove out. The second-channel decision (WhatsApp Business vs Zalo OA) is made post-pilot on recorded evidence: pilot-human channel usage, API capability/cost snapshots, and the 2026-10-01 Meta per-message AI-reply billing change. Prior basis (2026-09-01): Discord + WhatsApp for stability/integration support; Zalo excluded on those grounds — that exclusion is now re-examined in the post-pilot comparison rather than assumed | WP-0 channel choice | PM |
| C14 | Evidence gate needs real transition hook; cron fallback MVP-only | PC-001 AC4 | t3-backend |
| C16 | Confidential cards excluded from MVP; confidential projects never onboarded to chat bots (structural control, see WP-0) | defense work entering backlog | Viet |

**Readings to verify** (interpretations of the diagrams): ĐNĐH = đề nghị đặt hàng; PUC = Product
Use Case; red-filled step boxes = weakly-recorded steps; gate #3 approved by customer/tender
authority, recorded by Sale; Nhóm hỗ trợ owns Mua hàng in part 2.

## Sequencing

| Slice | Stories | Gate to advance |
|---|---|---|
| Slice 0 (infra) | kvm8 stabilise — 2 stacks, 1 Caddy, UFW, NAS backups | AUDIT-KVM8-001 D-items closed |
| Slice 1 — 1 engineer | Substrate first: PC-001, 002, 004, 007, 011 → then WP-0 (four verbs, incl. PC-010) on top → supporting PC-003, 005, 006 + PC-402 (pilot) | One real job order end-to-end through the gate; `wp0_evidence_via_bot` band met (≥80% pass, <50% after 1 week = abort/revisit channel — measured via PC-011); usable WP-close export |
| Slice 2 — engineering phases | PC-008, 009, 201..205, 301, 302, 401, 403..406, 501 | OQ-2/3/4 decided; C14 hook landed |
| Slice 3 — whole org | PC-101..107, 303..305, 502 | Sale/Sourcing/Kế toán onboarded; C16 resolved before defense work enters |

## Filing status

Per /spec Phase 5 (pending owner confirmation): each PC-xxx files as a GitHub issue on
`tetracilin/test_ai_todo` (dedupe verified clean 2026-09-01 — only Dependabot bumps open).
Record issue numbers here as they are filed.

| Story | Issue # | Filed |
|---|---|---|
| PC-001 | [#41](https://github.com/tetracilin/test_ai_todo/issues/41) | 2026-09-02 |

---

<!-- /autoplan review addendum — scope: WP-0 / Slice 1. Restore point: ~/.gstack/projects/tetracilin-test_ai_todo/main-autoplan-restore-20260901-234309.md -->

## /autoplan Review Addendum (2026-09-01) — WP-0 / Slice 1

> **SUPERSEDED-IN-PART (2026-09-02):** the phase sections below are the review's
> historical record. Where they read as forward-looking instructions (Deployment §9's
> "start WhatsApp template approval immediately", worktree lane D "WhatsApp bridge",
> WhatsApp chaos tests, the "null-objectId rows never count" test line), the **Phase 4
> gate decisions govern**: the pilot is Discord-only, WhatsApp items belong to a later
> WP, the pre-build external dependency is the Discord privileged-intent request, and
> the evidence-link tests target `issue_evidence_links` FK/delete semantics instead of
> mention-row exclusions.

Scope reviewed: substrate (PC-001, 002, 004, 007, + new 011), WP-0 four verbs incl.
PC-010, supporting PC-003/005/006, PC-402 pilot. Mode: SELECTIVE EXPANSION (CEO phase).
Codex CLI unavailable this run — all outside voices are Claude subagents `[subagent-only]`.

### What already exists (verified in code)

| Sub-problem | Existing code | Reused? |
|---|---|---|
| Chat bridge shape | `discord-bridge/` (commands, health, config, lib) | Yes — WhatsApp mirrors it |
| Evidence links | `packages/db/src/schema/external_objects.ts` (free-text `provider_key`, company/provider indexes) + `issue_attachments` | Yes |
| Dossier mechanism | `issue_documents` free-text `key` column | Yes — key `dossier` needs no schema change |
| Done-transition hook point | `server/src/services/issue-execution-policy.ts` + `applyIssueExecutionPolicyTransition` (has test file) | Yes — PC-001 AC6 |
| Intake idempotency | `issue_create_idempotency_keys` table | Yes — PC-004 AC4 |
| Approval gate type | `request_board_approval` in `packages/shared/src/constants.ts:688` | Yes (Slice 2) |
| Agent runtime | `packages/adapters/hermes-gateway` | Yes — PC-003 |
| Proactive re-brief trigger | heartbeats/wakeups event triggers (assignment/checkout) | Yes — WP-0 verb 2 |
| Secrets | server secrets service, named secret refs (commit d35f4b7a) | Yes — WhatsApp/Teable creds |
| Teable REST client | **none** (only false-positive grep hit "ga**teable**") | New build — PC-005/PC-010; write it as a shared service module, Slice 2 (PC-203) reuses it |
| Evidence `source` provenance | **none** — no source field on evidence rows | New — PC-011 (was the plan's measurement gap) |

### NOT in scope (deferred, with rationale)

- Zalo channel — settled decision (C13, stability/integration grounds).
- Chat-bridge package extraction *before* the WhatsApp build — taste decision at gate; recommend extracting during the second-instance build (rule of three, avoid refactor-before-value).
- Offline/NAS bulk-import tooling for confidential projects — outside blast radius; TODOS candidate.
- Pay linkage to performance records — explicitly out until a separate announced decision (PC-502 AC3).
- Epics 1–5 stories — later slices, unchanged by this review.

### Dream state delta

```
CURRENT                          THIS PLAN                        12-MONTH IDEAL
Discord bridge shipped but       Recorder substrate + four-verb   Every phase (pre-sales→FAT)
field routed around it; PM   →   bot; evidence self-files; PM  →  evidence-gated on cards;
does manual data entry; no       digest automates the summary;    Teable records GUI; gbrain
evidence gate; docs now SSoT     gate enforces records            re-briefs; self-dev loop live
```
The plan builds the substrate every later epic depends on — moves directly toward the ideal.

### Architecture (system diagram)

```
 Engineer (Vietnamese, WhatsApp/Discord)          PM/CTO
      │  photos, messages, "brief"                  ▲ daily digest
      ▼                                             │
 ┌───────────────┐   webhook (sig-verified)  ┌──────┴────────┐
 │ WhatsApp Cloud │ ─────────────────────▶   │  chat bridge  │  (2nd instance of
 │ API / Discord  │ ◀─────────────────────   │  wa-bridge /  │   discord-bridge shape)
 └───────────────┘   replies, confirms       │ discord-bridge│
                                             └──────┬────────┘
                                                    ▼
                                          ┌──────────────────┐
                                          │ hermes-gateway    │  eng-<name> agent
                                          │ agent (PC-003)    │  max_turns=150
                                          └──────┬───────────┘
                （structuring, four verbs）        │ REST /api
      ┌──────────────┬───────────────┬───────────┼──────────────┐
      ▼              ▼               ▼           ▼              ▼
  issues (cards) issue_documents issue_attach. external_objects activity_log
  + evidence gate  ("dossier")    (media)     (minio|git|teable|nas
  (PC-001, policy                              + source bot|manual PC-011)
   service + flag)                                   │
                                                     ▼
                                             ┌──────────────┐
                       PC-005 mirror cron ──▶│ Teable REST   │◀── PC-010 agent R/W
                       (one-way, conflicts   │ (system of    │    (allowlist + schema map
                        flagged)             │  records)     │     + read-before-write)
                                             └──────────────┘
```

### Evidence-gate state machine (PC-001)

```
        backlog → todo → in_progress → in_review ──────────┐
                                          │                ▼
                                          │  PATCH → done  │
                                          ▼                │
                              [flag off?] ── yes ──▶ done (legacy path)
                                          │ no
                                          ▼
                              evidence links ≥ 1 ?
                                   │yes        │no
                                   ▼           ▼
                                 done      409 + named evidence types
                              (+activity      + chat phrase to file one
                               log count)     (card stays in_review)
   Invalid transitions (any → done skipping gate) prevented by: single hook in
   issue-execution-policy service — no route-level bypass path.
```

### Capture data flow (WP-0 verb 1) — four paths

```
 WA media msg ─▶ sig verify ─▶ media fetch ─▶ LLM structure ─▶ file evidence ─▶ confirm 1-line
     │              │              │               │                │               │
 nil: text-only  fail: 401     expired URL:    malformed/refusal: MinIO fail:    wrong card:
 capture w/o     log+drop      retry, then     re-prompt once →   retry backoff, reply number →
 media OK        (alert on     ask "gửi lại    unstructured       tell engineer  re-file
 empty msg:      error-rate)   ảnh giúp mình"  capture on triage  "chưa lưu được"
 polite ignore                                 card + tell user
 dup msg/media: idempotency fingerprint (existing table) + media sha256 → no dup card
```

### Error & Rescue Registry (Section 2)

| Codepath | What can go wrong | Rescued? | Rescue action | User sees |
|---|---|---|---|---|
| WA webhook intake | Invalid signature | Y (op AC1) | 401, log, error-rate alert | Nothing (attacker) |
| WA webhook intake | Malformed payload | Y (op AC1) | 200-ack + log | Nothing |
| WA webhook intake | Duplicate delivery | Y (PC-004 AC4) | Idempotency fingerprint | Same card link again |
| Media fetch | URL expired / fetch fail | Y (S4) | Retry; then ask resend | "gửi lại ảnh giúp mình" |
| LLM structuring | Malformed JSON / empty / refusal | Y (op AC2) | Re-prompt once → unstructured triage capture | One-line notice |
| MinIO upload | Timeout / unavailable | Y | Retry w/ backoff, then notify | "chưa lưu được, thử lại" |
| Evidence gate | 0 evidence on done | Y (AC1-2) | 409 + types + chat phrase | Actionable rejection |
| Teable write (PC-010) | 429 / timeout | Y | Backoff retry | Nothing (transparent) |
| Teable write (PC-010) | Schema mismatch | Y (AC2) | Reject whole write | Actionable refusal |
| Teable write (PC-010) | Conflict w/ human edit | Y (AC3) | Withhold + conflict comment | Conflict comment on card |
| PM digest cron | Send failure | Y (op AC5) | Operator alert | PM told via alert path |
| Proactive send | Outside 24h window | Y (op AC4) | Template or queue | Delayed but delivered |
| Agent runtime down | Capture unprocessed | PARTIAL | Bridge health check + alarm (op AC6) | Bot silent — alarm fires |

No remaining unrescued GAP rows; "agent runtime down" is the watch item (alarm-covered, not user-visible in chat).

### Failure Modes Registry

| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| Webhook | Sig fail / malformed | Y | unit | n/a | Y |
| Capture | LLM bad output | Y | eval suite (op AC7) | 1-line notice | Y |
| Capture | Media loss | Y | integration | resend ask | Y |
| Gate | False rejection (evidence exists) | Y | unit on policy svc | 409 w/ reason | Y |
| Gate | Flag misconfig | Y | unit | legacy behavior | Y |
| Digest | Silent non-delivery | Y (alert) | integration | alert | Y |
| Teable | Partial write | Y (AC2 reject-whole) | unit | refusal msg | Y |
| Pilot metric | Untracked provenance | Y (PC-011) | query test | digest ratio | Y |

0 CRITICAL GAPS (all rows rescued + user-visible or alarmed + logged).

### Test map (Section 6)

- New codepaths → tests: webhook intake (unit + supertest integration), structuring
  prompt (Vietnamese eval suite, op AC7), evidence gate (extend
  `issue-execution-policy.test.ts`), digest (integration + empty-day case), Teable client
  (mocked unit + 1 recorded integration), idempotency (unit incl. media sha256),
  provenance ratio query (unit).
- 2am-confidence test: E2E forwarded message → card + dossier + evidence link + gate passes.
- Hostile QA: 50MB video, long diacritic captions, emoji-only, forwarded-of-forwarded,
  two engineers sharing a phone, card number reply out of range.
- Chaos: WhatsApp down 2h (Meta webhook retries cover; runbook op AC8), Teable down during
  digest.
- Flakiness: digest tests must freeze time; recorded Teable integration pinned to fixture.

### Observability (Section 8)

Metrics: `wp0_evidence_via_bot` ratio (PC-011), captures/day, structuring-failure rate,
digest delivery success, gate rejection count. Alerts: adoption-drop (op AC6), digest
failure (op AC5), webhook error-rate. Debuggability: WA message id ↔ card id correlation
lives in the dossier Evidence-log line (PC-007 AC5). Runbooks per op AC8.

### Deployment & rollout (Section 9)

Additive migration (PC-011 source column) → deploy → onboard 1 engineer (natural canary)
→ enable gate flag for pilot company only → bot verbs live. Rollback: disable flag;
deregister webhook. Start WhatsApp template approval immediately (external lead time —
the Assignment in the design record).

### Long-term (Section 10)

Reversibility 4/5 (additive + flagged). Debt watch: second bridge instance without
extraction (taste decision at gate); Teable client must be a shared service module (Slice
2 reuse). 1-year legibility: SSoT trio + design record + this addendum.

### Decision Audit Trail

<!-- AUTONOMOUS DECISION LOG -->

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | Pre | Enable cross-project learnings config | Mechanical | P6 | Was already `true`; no change needed | — |
| 2 | CEO 0A | Accept all 5 design-record premises + WP-0 premises | Mechanical | P6 | Already cross-model challenged in office-hours; evidence-backed; no clearly-wrong premise | Re-litigating settled decisions |
| 3 | CEO 0C-bis | Approach B (plan as written: substrate → WhatsApp bot, Discord fallback) | **Taste** → gate | P1,P5 | Completeness 9/10; C (extract bridge abstraction first) is 10/10 but refactor-before-value | A (Discord-only, 6/10) |
| 4 | CEO 0D | Add PC-011 evidence provenance story | Mechanical | P1,P2 | DoD metric unmeasurable without it; in blast radius, <1d CC | Hand-tallying the pilot metric |
| 5 | CEO 0D | Add WP-0 operational ACs 1–8 | Mechanical | P1 | Zero-silent-failures directive; each traces to a named failure mode | Deferring to implementation |
| 6 | CEO 0D | Defer NAS bulk-import tooling to TODOS | Mechanical | P2,P3 | Outside blast radius | Building now |
| 7 | CEO S1 | Evidence gate lives in issue-execution-policy service, feature-flagged | Mechanical | P4,P5 | Single hook beats per-route guards; flag = rollback path | Route-level check |
| 8 | CEO S1 | PC-010 conflict mechanism = read-before-write + lastModifiedTime compare | Mechanical | P5 | AC stated policy without mechanism; explicit beats clever | Optimistic locking via ETag (Teable API lacks it) |
| 9 | CEO S4 | Empty-day digest still sends one line | Mechanical | P1 | Absence must be visible (silent-failure rule) | Skip silent |
| 10 | CEO S10 | Teable client as shared service module | Mechanical | P4 | PC-203 (Slice 2) reuses it | Inline in agent code |
| 11 | CEO voice F2 | Stage 0 Discord verb-smoke before WhatsApp build | Mechanical | P1,P6 | Decouples verb-hypothesis from channel-hypothesis at near-zero cost (bridge already shipped) | Coupled single pilot |
| 12 | CEO voice F3 | PM observation hard-gates WP-0 build; PM engagement signal (digest ≥4/5 days) | Mechanical | P1 | Enforces the design record's own pre-code Assignment; tests championship instead of assuming it | Assuming PM champion |
| 13 | CEO voice F4 | Band evaluation min-n=15 + mechanical band call + CTO retrieval test | Mechanical | P1 | 1 engineer × 1 week can flip bands on 2–3 items; retrieval is the actual value test | Hand-called bands on tiny n |
| 14 | CEO voice F7 | ≥90% correct-card eval bar + live mis-file tracking | Mechanical | P1,P5 | Accuracy is verb 1's hard problem; a number makes "iterate" diagnosable | Unquantified eval gate |
| 15 | CEO voice F1/F10 | C13 evidence pre-step (channel usage check + Zalo OA snapshot) — decision unchanged | Mechanical | P6 | A decided row must carry its basis; 1-hour cost | Reopening C13 unilaterally |
| 16 | CEO voice F5 | PC-010 full machinery vs append-only pilot subset | **Taste** → gate | P1 vs P3 | Largest new-code surface, least metric-coupled; but prior review held Slice 1 scope | Auto-deciding a held-scope reversal |
| 17 | CEO voice F8 | Competitive/moat section → task + TODOS (roadmap.md edit deferred to owner) | Mechanical | P3 | Real competitor is status quo + generic assistants; moat is the system, not the bot. Sibling-SSoT edit is outside this plan file | Editing roadmap.md unilaterally |
| 18 | CEO voice F6 | Tecotec-first vs portability-first doctrine | **Challenge** → gate | — | Premise-1 hard constraint vs backlog's company-specific bindings; only the owner can pick the default winner | Auto-deciding identity doctrine |
| 19 | CEO voice F1 | WhatsApp-first channel bet contradicts the plan's strongest demand evidence (Zalo) | **Challenge** → gate | — | Targets owner decision C13; single-model (Codex absent) — user context may settle it | Auto-reversing an owner decision |

### CEO Dual Voices — Consensus Table

Codex CLI not installed → `[subagent-only]` run; Codex column N/A (not CONFIRMED).

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Premises valid? | DISAGREE (F1 channel, F3 PM-champion) | N/A | → gate items UC1/UC2; F3 fixed by amendment |
| 2. Right problem to solve? | AGREE | N/A | flagged-confirmed (single voice) |
| 3. Scope calibration correct? | DISAGREE (F2, F5) | N/A | F2 fixed by Stage-0 amendment; F5 → taste T2 |
| 4. Alternatives sufficiently explored? | DISAGREE (F1, F2) | N/A | Partially fixed (Stage 0, C13 evidence step); residue → UC1 |
| 5. Competitive/market risks covered? | DISAGREE (F8) | N/A | → task + TODOS (roadmap.md owner edit) |
| 6. 6-month trajectory sound? | AGREE (substrate reusable under every channel outcome) | N/A | flagged-confirmed (single voice) |

Single-voice critical finding F1 flagged regardless of consensus rules → Final Gate.

### CEO Completion Summary

```
+====================================================================+
|            MEGA PLAN REVIEW — COMPLETION SUMMARY (CEO)             |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION (autoplan override)     |
| System Audit         | clean tree on main; no TODOS.md (created);  |
|                      | prior CEO review 2026-09-01 HOLD_SCOPE      |
| Step 0               | premises accepted (2 queued as challenges); |
|                      | Approach B; PC-011 + op ACs accepted        |
| Section 1  (Arch)    | 3 issues found (gate placement, PC-010      |
|                      | mechanism, agent-down SPOF)                 |
| Section 2  (Errors)  | 13 error paths mapped, 0 GAPS remaining     |
| Section 3  (Security)| 3 issues found, 1 High (unsigned webhook)   |
| Section 4  (Data/UX) | 9 edge cases mapped, 0 unhandled            |
| Section 5  (Quality) | 1 issue (shared provider-key constants)     |
| Section 6  (Tests)   | Diagram produced, 2 gaps (evals, chaos)     |
| Section 7  (Perf)    | 0 issues (pilot scale; indexes verified)    |
| Section 8  (Observ)  | 3 gaps found (alarm, digest alert, runbook) |
| Section 9  (Deploy)  | 2 risks flagged (flag rollout, template     |
|                      | approval lead time)                         |
| Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
| Section 11 (Design)  | SKIPPED (no UI scope)                       |
+--------------------------------------------------------------------+
| NOT in scope         | written (5 items)                           |
| What already exists  | written (11 rows, code-verified)            |
| Dream state delta    | written                                     |
| Error/rescue registry| 13 codepaths, 0 CRITICAL GAPS               |
| Failure modes        | 8 total, 0 CRITICAL GAPS                    |
| TODOS.md updates     | 2 items (NAS import; competitive section)   |
| Scope proposals      | 5 proposed, 2 accepted, 1 deferred,         |
|                      | 1 rejected, 1 → gate (taste)                |
| CEO plan             | written + spec-reviewed (7/10 → fixes       |
|                      | applied, re-review pending)                 |
| Outside voice        | ran (claude subagent; codex unavailable)    |
| Lake Score           | 9/10 recommendations chose complete option  |
| Diagrams produced    | 3 (system arch, gate state machine,         |
|                      | capture data flow w/ shadow paths)          |
| Stale diagrams found | 0 (no prior ASCII diagrams in touched files)|
| Unresolved decisions | 4 → Final Gate (UC1, UC2, T1, T2)           |
+====================================================================+
```

## Phase 2 — Design Review: SKIPPED (no UI scope detected; 1 grep match was the
false positive "form-filling". PC-002 AC4 rides the existing issue-documents card UI.)

## Phase 2.5 — DX Review (mode: DX POLISH, `[subagent-only]`)

### Developer Persona Card

```
TARGET DEVELOPER PERSONA (composite — this product's "developers")
==================================================================
Who:       (1) the AI agent (hermes `eng-<name>`) consuming the verb interface and
           REST bindings; (2) the solo fork maintainer deploying/onboarding/operating;
           (3) the field engineer, Vietnamese chat only (end user, not developer)
Context:   internal tool, 1 maintainer, 1-engineer pilot; competitor is the status quo
           (send it to the PM on Zalo = zero-friction, zero-structure)
Tolerance: engineer: one chat message, or they route around the bot (proved once);
           maintainer: 2am-runbook standard
Expects:   agent: consistent phrases + structured errors it can relay; maintainer:
           one doc home; engineer: the bot speaks first and Vietnamese
```

### Developer Empathy Narrative (maintainer, first onboarding — pre-amendment)

I open backlog.md. PC-003 says onboarding takes <30 min "documented as a runbook" — the
runbook doesn't exist yet. I open doc/HERMES_GATEWAY_ONBOARDING.md: pip install, two
distinct keys with a "do not reuse" warning, an invite in the board UI, a board-approval
step that stalls if the approver is at lunch, a one-time key claim. That's the agent
side only — nothing tells me how the engineer's WhatsApp number links to their Paperclip
user, or what the bot says first. I would have discovered the missing phrase table at
the worst time: writing the gate rejection message that promises "the chat phrase to
file one." *(Post-amendment: PC-003's three-way split + op AC10's phrase SSoT close
exactly these holes.)*

### Competitive DX Benchmark

| Tool | TTHW | Notable DX choice | Source |
|---|---|---|---|
| Status quo (Zalo → PM) | 0 min | zero onboarding, zero structure — the real competitor | field observation |
| Stripe / Vercel / Firebase | 30s–3min | reference gold standards | dx-hall-of-fame |
| WhatsApp Business API (any bot) | days–weeks setup | template approval lead time; from 2026-10-01 in-window AI-agent replies billed per-message | sleekflow.io, blueticks.co pricing guides |
| THIS PLAN | ≤30 min/engineer (timed dry-run) + ~5 min engineer quickstart | zero-command capture (photo = verb) | backlog.md PC-003/WP-0 |

Target tier: per-interaction parity with the status quo (one chat message), onboarding
≤30 min measured, engineer-side ≤5 min. Magical moment: forward a photo → "đã lưu vào
thẻ #123 ✓" one-line Vietnamese confirmation — delivered first via the Stage-0 Discord
smoke (lowest-effort vehicle, doubles as the demo).

### Developer Journey Map (post-amendment)

| Stage | Developer does | Friction points | Status |
|---|---|---|---|
| 1. Discover | internal — PM/CTO introduce the bot | first-message spec (op AC10) | fixed |
| 2. Install | maintainer: pre-provisioning runbook (Meta app, templates, secrets) | was mixed into the 30-min claim | fixed (PC-003a) |
| 3. Hello World | engineer linked, first capture confirmed | timed dry-run evidence; approval-stall | fixed (PC-003b, batched approvals) |
| 4. Real Usage | four verbs daily | phrase SSoT, help verb, agent-down replay | fixed (op AC9/10) |
| 5. Debug | maintainer at 2am | one runbook home + named alert channel | fixed (op AC8/11) |
| 6. Upgrade | prompt changes; migrations | eval-gated prompts (≥90% bar); additive migrations; flag rollback | ok |

### First-Time Developer Confusion Report → all 5 confusion points addressed
(runbook nonexistence → PC-003 split; phrase invention → op AC10; who-retries ambiguity
→ op AC9; alert-to-nowhere → op AC11; junk-card gate trap → PC-001 AC7.)

### DX Scorecard

```
+====================================================================+
|              DX PLAN REVIEW — SCORECARD                            |
+====================================================================+
| Dimension            | Score  | Prior  | Trend  |
| Getting Started      |  8/10  | (5 pre-amendment) | ↑ |
| API/CLI/SDK          |  8/10  | (6)    | ↑      |
| Error Messages       |  9/10  | (7)    | ↑      |
| Documentation        |  8/10  | (5)    | ↑      |
| Upgrade Path         |  8/10  | (8)    | =      |
| Dev Environment      |  8/10  | (7)    | ↑      |
| Community            |  6/10  | (6)    | = (internal tool; n/a-adjusted, no action) |
| DX Measurement       |  9/10  | (8)    | ↑      |
+--------------------------------------------------------------------+
| TTHW                 | ≤30 min/engineer (measured) + ~5 min quickstart |
| Competitive Rank     | n/a-internal (parity with zero-friction status quo per interaction) |
| Magical Moment       | designed — via Stage-0 Discord smoke demo    |
| Product Type         | Platform/API, AI-agent-primary               |
| Mode                 | DX POLISH                                    |
| Overall DX           |  8/10  | (6 initial)  | ↑                    |
+====================================================================+
| DX PRINCIPLE COVERAGE: Zero Friction covered · Learn by Doing       |
| covered (Stage-0 demo) · Fight Uncertainty covered (13-path         |
| registry + phrase SSoT) · Opinionated + Escape Hatches covered      |
| (PC-007 AC6 unlink, PC-001 AC7 cancelled-path, manual fallback)     |
| · Code in Context covered (fixtures) · Magical Moments covered      |
+====================================================================+
```

### DX Implementation Checklist

```
[x] TTHW target defined and measured (timed dry-run, pc003_onboarding_minutes)
[x] Environment setup split from per-engineer onboarding
[x] First run produces meaningful output (one-line Vietnamese confirmation)
[x] Magical moment delivered via Stage-0 Discord smoke
[x] Every error message: problem + cause + fix (13-path registry + op AC9/10 relay rules)
[x] Verb phrases: canonical table, single source, help verb, first message
[x] Docs: one runbook home (doc/WP0-OPERATIONS.md) + quickstart + fixtures
[x] Examples: dossier + export bundle fixtures checked in
[x] Upgrade: eval-gated prompts, additive migrations, flag rollback
[x] Works in CI: eval suite + policy tests extend existing vitest workspace
[x] Alert routing named and tested end-to-end before pilot
[x] Spend control: budgets-subsystem cap for per-message billing (Oct 2026 change)
[ ] Community channel — n/a (internal, 1 maintainer)
```

### DX Dual Voices — Consensus Table

Codex CLI not installed → `[subagent-only]`; Codex column N/A.

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Getting started <30min credible? | DISAGREE (as spec'd) | N/A | fixed — PC-003 split + timed dry-run |
| 2. Naming guessable? | DISAGREE (1 of 4 verbs phrased) | N/A | fixed — op AC10 phrase SSoT |
| 3. Error messages actionable? | AGREE w/ reservations (2 paths) | N/A | fixed — op AC9 + relay rule |
| 4. Docs findable & complete? | DISAGREE | N/A | fixed — runbook home + fixtures |
| 5. Upgrade path safe? | AGREE | N/A | flagged-confirmed |
| 6. Dev environment friction-free? | AGREE mostly | N/A | fixed — webhook dev-story line |

Session-side independent findings (not from the voice): shipped Discord bridge has no
message-content intent → conversational capture is new on every channel (honest delta
note added to WP-0); WhatsApp 2026-10-01 in-window AI-reply billing → op AC12 spend cap.

### DX Decision Audit Trail rows

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 20 | DX F1 | PC-003 split: pre-provisioning / per-engineer timed / VN quickstart | Mechanical | P1,P5 | <30 min was an assertion; hermes flow contradicts it; clock now defined | Unmeasured claim |
| 21 | DX F2/F3 | Phrase SSoT + help verb + first message (op AC10) | Mechanical | P4,P5 | Error messages must never name phrases the bot doesn't answer to | Per-message improvisation |
| 22 | DX F4/C | Agent-down persist+replay, downtime status msg, who-retries wording, fingerprint clear (op AC9) | Mechanical | P1 | Silent bot in pilot week corrupts the wedge metric and adoption | Alarm-only |
| 23 | DX F5/F6 | Runbook home doc/WP0-OPERATIONS.md + named, tested alert channel (op AC8/11) | Mechanical | P5 | Alert to an unwatched channel is a silent failure in costume | Homeless runbooks |
| 24 | DX F7 | Dossier + export fixtures (PC-002 AC5, PC-006 AC5) | Mechanical | P1 | The retrieval test needs a concrete shape; fixtures double as test fixtures | Schema by prose |
| 25 | DX F8 | Evidence unlink/move (PC-007 AC6) + cancelled-path note (PC-001 AC7) | Mechanical | P1 | Post-hoc corrections existed nowhere; junk cards forced flag-off or junk evidence | Append-only forever |
| 26 | DX (session) | Honest delta note: conversational capture unshipped on all channels | Mechanical | P5 | discord-bridge README: Guilds intent only, no message content | Leaving "shipped" claim |
| 27 | DX (session) | Op AC12 spend cap under budgets subsystem (Oct 2026 billing change) | Mechanical | P2 | In-window AI-agent replies become per-message billable; budgets exist | Unbounded spend |
| 28 | DX | Verb interaction model: natural language + canonical phrases (hybrid) | Mechanical | P6 | Zero-command capture stays; phrases give the relayable, documentable surface | Keyword-only commands |

**Phase 2.5 summary:** DX overall 6→8/10. TTHW ≤30 min measured + ~5 min engineer-side.
Claude subagent: 8 findings, all absorbed as spec-level amendments. 0 taste decisions,
0 user challenges from this phase.

## Phase 3 — Eng Review (`[subagent-only]`, reviewed the FINAL amended plan)

### Test coverage diagram (all paths are planned-new; each named test is now a plan requirement)

```
CODE PATHS                                            USER FLOWS
[+] evidence gate (commit-point hook)                 [+] Recorder loop
  ├── [PLAN unit] flag on/off × evidence 0/1            ├── [PLAN →E2E] job order → card → evidence
  ├── [PLAN unit] ALL 3 done-paths (PATCH,               │   → done gate passes (the 2am test)
  │    comment-decision, restore)                        ├── [PLAN e2e] wrong-card correction reply
  ├── [PLAN unit] cancelled never blocked                ├── [PLAN e2e] junk card → cancelled path
  └── [PLAN unit] TOCTOU race + reopen/re-done          └── [PLAN e2e] agent-down → replay → confirm
[+] evidence-link write path (PC-007 AC7)             [+] Onboarding
  ├── [PLAN unit] null-objectId rows never count        └── [PLAN manual-E2E] timed dry-run ≤30min
  └── [PLAN unit] liveness=unknown, no resolver spam  [+] Digest
[+] webhook intake                                      ├── [PLAN int] delivery + empty day
  ├── [PLAN unit] raw-body HMAC, 401 unsigned           └── [PLAN int] failure → alert seen
  ├── [PLAN unit] rate limit, body cap                [+] PC-010 Teable
  └── [PLAN int] dup delivery + fingerprint-clear       ├── [PLAN unit] allowlist refusal, schema reject
[+] capture pipeline (ONE bounded LLM call)             ├── [PLAN unit] conflict withheld + comment
  ├── [PLAN →EVAL] ≥90% card matching (VN suite,        └── [PLAN unit] attribution: no self-conflict
  │    + injection + photo-then-caption cases)        LLM/prompts: [→EVAL] all prompt changes gated
  ├── [PLAN unit] fallback → triage capture
  └── [PLAN unit] pairing window, zero-open-cards
COVERAGE TARGET: 100% of the above written WITH the feature code, not after.
```

### Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| A. Substrate server-side (gate, PC-011 migration, link path, unlink) | server/, packages/db/, packages/shared/ | — |
| B. Conversational pipeline + Stage 0 (capture, verbs, phrases) | discord-bridge/, packages/adapters/hermes-gateway/ | A (files against substrate APIs) |
| C. Teable client service (PC-005/PC-010) | server/src/services/ (new module) | — |
| D. WhatsApp bridge | whatsapp-bridge/ (new) | B (reuses pipeline) |
| E. Docs/runbooks/fixtures | doc/, test fixtures | A–D shape them |

Lanes: launch **A + C** in parallel worktrees (both touch server/src/services — different
files, coordinate); then **B**; then **D**; **E** rides along each. Conflict flag: A and C
share server/src/services/ — keep modules separate or sequence.

### Eng Dual Voices — Consensus Table

Codex CLI not installed → `[subagent-only]`; Codex column N/A.

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| 1. Architecture sound? | AGREE w/ reservations (2 reuse claims false in detail) | N/A | fixed by amendments; evidence-link mechanism → taste T3 |
| 2. Test coverage sufficient? | DISAGREE (all-done-paths, race, reopen, DM surface, injection evals) | N/A | fixed — all added to plan + test artifact |
| 3. Performance risks addressed? | AGREE at pilot / DISAGREE at 10x | N/A | fixed — bounded single-LLM-call capture AC |
| 4. Security threats covered? | PARTIAL (raw-body HMAC, rate limit, media types, DM auth, server-side scope) | N/A | fixed — op AC1/AC3 hardening + Stage-0 ACs |
| 5. Error paths handled? | AGREE (registry strongest part) | N/A | flagged-confirmed |
| 6. Deployment risk manageable? | AGREE | N/A | flagged-confirmed |

### Eng Decision Audit Trail rows

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 29 | Eng 1 | Evidence-link write path is an explicit deliverable; mechanism → gate | **Taste T3** → gate | P5 | Only existing linkage is `external_object_mentions` (SET NULL, detector-driven) — wrong ledger semantics for a gate; "no new tables *without cause*" has cause | Auto-picking table vs mentions |
| 30 | Eng 2 | Gate at the single patch-commit point; tests on all 3 done-paths | Mechanical | P5 | Pure policy fn can't query; 3 paths produce done in a 13k-line route | "Extend the policy service" wording |
| 31 | Eng 3 | Same-transaction evidence count; reopen/re-done test | Mechanical | P1 | Unlink (PC-007 AC6) opened a TOCTOU window on the gate | Check-then-write |
| 32 | Eng 4 | Capture = one bounded schema-constrained LLM call; agent sessions for re-brief only | Mechanical | P3,P5 | Full agent session per photo = cost/latency/head-of-line at 17 staff | Agent-loop-per-capture |
| 33 | Eng 5 | Server-side scope enforcement vs injection + adversarial VN eval cases | Mechanical | P1 | Prompt-side "content is data" is policy, not control | Prompt-only mitigation |
| 34 | Eng 6 | Webhook hardening: raw-body HMAC, rate limit, body cap, media content-type allowlist | Mechanical | P1 | First internet-facing endpoint of the fork | Sig-only |
| 35 | Eng 7 | Stage-0 honest sizing (≈1 week) + mini-ACs (privileged intent, DM auth, media, tests) | Mechanical | P5 | Shipped bridge is ~718 lines, no message/DM/media handling | "3 days of glue" |
| 36 | Eng 8 | PC-005/PC-010 shared write-attribution AC; race window documented as accepted | Mechanical | P4 | Mirror and agent writes would flag each other as conflicts forever | Unattributed writes |
| 37 | Eng 9 | Photo-then-caption pairing window + eval case; zero-open-cards → triage explicit | Mechanical | P1 | The common field pattern arrives as two unordered webhook events | Caption-less mis-files |
| 38 | Eng 10/11 | Liveness no-spam test; phone-remap runbook entry | Mechanical | P1 | Static evidence rows enter refresh machinery; numbers change | Ignore |

### Eng Completion Summary

```
+====================================================================+
|                ENG PLAN REVIEW — COMPLETION SUMMARY                |
+====================================================================+
| Step 0 (Scope)       | scope held (P2, never reduce); bindings     |
|                      | code-verified; 2 reuse claims corrected     |
| Section 1 (Arch)     | 4 issues (link mechanism, gate placement,   |
|                      | capture architecture, Stage-0 delta)        |
| Section 2 (Quality)  | 2 issues (PC-011 column spec, attribution)  |
| Section 3 (Tests)    | Diagram produced; 6 gap classes added to    |
|                      | plan + test artifact; eval scope: VN suite  |
|                      | + injection + pairing (gates all prompts)   |
| Section 4 (Perf)     | 1 issue (bounded LLM call); indexes verified|
| Outside voice        | claude subagent, 11 findings (3H/6M/2L),    |
|                      | 9 absorbed, 1 → taste T3, 1 confirmed-ok    |
| Test plan artifact   | ~/.gstack/projects/tetracilin-test_ai_todo/ |
|                      | Tetracilin-main-eng-review-test-plan-       |
|                      | 20260902-000500.md                          |
| Failure modes        | registry updated, 0 CRITICAL GAPS           |
| Worktree lanes       | A+C parallel → B → D (E rides along)        |
| Unresolved decisions | 1 new (T3) + 4 carried → Final Gate         |
+====================================================================+
```

**Phase 3 summary:** Codex: unavailable. Claude subagent: 11 findings — 9 absorbed as
amendments, 1 taste decision (T3 evidence-link mechanism), 1 noted-accepted (Teable race
window). Consensus: 2/6 confirmed, 4 disagreements fixed by amendment.

## Phase 4 — Final Gate decisions (owner, 2026-09-02)

| # | Item | Owner decision | Applied |
|---|---|---|---|
| 39 | Gate verdict (D2) | Approve as-is | ✓ |
| 40 | UC1 channel bet (D3) | **Discord-only pilot** — Discord DM surface is the wedge vehicle; WhatsApp → later WP; post-pilot channel comparison (WhatsApp vs Zalo OA) recorded on C13 | ✓ WP-0 rewritten, C13 re-decided, op-AC re-scope note, TODOS entry, decision e668af61 |
| 41 | UC2 doctrine (D4) | Tecotec-first + portability floor (no company-id hardcoding + export works); owner adds the sentence to roadmap.md | ✓ TODOS entry, decision 69643552 |
| 42 | Taste T1 (D5) | Extract chat-bridge package during the second-channel build, not before | ✓ decision a101631b |
| 43 | Taste T2 (D5) | PC-010 append-only single-table subset in Slice 1; full machinery Slice 2 | ✓ PC-010 staging note |
| 44 | Taste T3 (D5) | New `issue_evidence_links` table (rule's without-cause exception) | ✓ PC-007 AC7 resolved |

Post-gate Eng re-run (coherence pass on the amended plan): see below.

### Post-gate Eng re-run (coherence pass, 2026-09-02)

Claude subagent delta review of the amended plan: **8 propagation misses found (1 high,
5 medium, 2 low), all fixed in place** — PC-001 AC1/binding retargeted to
`issue_evidence_links` (the HIGH: it still specified the rejected external-objects
count); file-rule line 40 gained its sanctioned exception; PC-011 provenance moved to
per-link placement (`issue_evidence_links` + `issue_attachments`, none on
`external_objects`); PC-003 pre-provisioning re-itemized for Discord; honest-delta note
de-staled; PC-010 pilot subset now includes the AC6 attribution marker (PC-005 ships in
the same slice); op-AC re-scope note extended to AC8/AC9 with Discord runbook analogs;
PM/CTO digest-recipient linking added as pre-build gate (c); superseded-in-part banner
added to the addendum; test-plan artifact corrected. Checks Q2 (pilot protocol on
Discord) and Q3 (append-only verb 4) came back SATISFIED. Verdict after fixes:
**COHERENT**.

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 45 | Eng re-run | Apply all 8 propagation fixes | Mechanical | P5 | Each was a one-to-two-line consistency fix executing decisions the owner already made at the gate | Leaving contradictions |
| 46 | Eng re-run | Attribution marker (bot account) pulled into Slice-1 PC-010 subset | Mechanical | P1 | PC-005 conflict flagging ships in the same slice; disjointness assumption is fragile | "Tables are disjoint" assertion |

**Final Gate status: APPROVED (owner, 2026-09-02).**

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 2 | CLEAR (via /autoplan) | 5 proposals: 2 accepted, 1 deferred, 1 rejected, 1 resolved at gate; 0 critical gaps |
| Codex Review | `/codex review` | Independent 2nd opinion | 2 | issues absorbed (subagent-only — Codex CLI not installed) | CEO 10 + DX 8 + Eng 11 + re-run 8 findings; all absorbed or gate-resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | CLEAR (via /autoplan; incl. post-gate coherence re-run) | 11 issues + 8 propagation fixes; 0 critical gaps; test plan artifact on disk |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | SKIPPED | no UI scope |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | CLEAR (via /autoplan) | score 6/10 → 8/10; TTHW unmeasured → ≤30 min measured |

**CROSS-MODEL:** not available this run — Codex CLI absent; all outside voices were independent Claude subagents (`[subagent-only]`). Install `@openai/codex` for cross-model coverage.

**VERDICT:** CEO + ENG + DX CLEARED — APPROVED at the /autoplan Final Gate (2026-09-02); ready to implement. Pilot: Discord-only (gate decision); first external dependency: Discord privileged-intent request.

NO UNRESOLVED DECISIONS
