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
- Do NOT invent new tables. Every binding below is an existing Paperclip service per the K6 domain map.
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
(evidence gate), PC-002 (dossier), PC-004 (intake), PC-007 (evidence linking) — then
**WP-0, the four-verb chat bot, on top of that substrate**, both inside Slice 1's
one-engineer pilot. The bot is not staged ahead of the cards it files against.
PC-008/009 bridge platform → process in Slice 2.

### Substrate — build first [Slice 1]

#### PC-001 Evidence gate on Done — [CTO] [Slice 1]
As the CTO, I want the `done` transition blocked unless a card has ≥1 linked evidence artifact,
so that unrecorded work cannot count as finished (AD-032).
1. `PATCH /api/issues/:id` → `done` rejected with actionable error when issue has 0 evidence links (attachment or evidence-provider external object).
2. Rejection names accepted evidence types and the chat phrase to file one via the agent.
3. Successful close writes an `activity_log` entry with the evidence count.
4. Enforcement is a server-side transition hook; reconciliation cron that reopens violators is MVP-only (C14).
5. Evidence counts per engineer per WP queryable for WP-close export.
- Binding: `issues.status`, `activity_log`, `issue_attachments`, `external_objects`

#### PC-002 Dossier document on every card — [Engineer] [Slice 1]
As an engineer, I want my agent to maintain a dossier on every card, so that job order,
clarifications, and scope changes are recorded without me writing them up (AD-034).
1. Every intake-created card has `issue_documents` key `dossier`, sections: Job order · Clarifications · Evidence log · Scope changes · Related Teable rows.
2. Scope-change entries timestamped by the agent and mirrored as issue comments.
3. Scope-change timestamps queryable — the CTO's replanning-latency signal.
4. Dossier renders in card UI and exports cleanly as markdown.
- Binding: `issue_documents("dossier")`, `issue_comments`, `activity_log`

#### PC-004 Job-order intake via chat — [Engineer] [Slice 1]
As an engineer, I want to forward a job order to my agent and get a card back, so that every job
order becomes a recorded card with zero form-filling.
1. Forwarded message → issue with title, description, seeded dossier, assignee = engineer, project resolved (or triage label).
2. Agent replies with card link and asks clarifying questions; answers land in dossier Clarifications.
3. Confidential content refused with NAS drop-folder instructions; nothing stored (AD-021, C16).
4. Re-forwarding does not duplicate cards (idempotency fingerprint).
- Binding: chat bridge (Discord shipped, WhatsApp per WP-0), `POST /api/companies/:id/issues`, `issue_documents("dossier")`

#### PC-007 Evidence linking via agent — [Engineer] [Slice 1]
As an engineer, I want to hand my agent a file or link and have it filed as evidence, so that
passing the gate costs one chat message.
1. Chat file → NAS MinIO evidence bucket + linked with SHA-256 (provider `minio`).
2. Git commit URL/hash verified against fork remotes and linked (provider `git`); branches `PC-xxx` auto-link commits.
3. NAS confidential path recorded as path reference only — no bytes leave NAS (provider `nas`).
4. Teable row URL links as provider `teable`.
5. Every linkage appends one line to dossier Evidence log.
- Binding: `external_objects`, `issue_attachments`, NAS MinIO (storage plane, AD-028)

### WP-0 — four-verb chat bot (on top of the substrate) [Slice 1]

The wedge delivery vehicle: a **WhatsApp evidence-and-briefing bot** — the second
instance of the chat-bridge abstraction whose first instance (Discord) is shipped (see
`design.md`). It reuses the substrate above: PC-004 intake, PC-007 evidence linking,
PC-002 dossiers, with PC-003 onboarding as the entry step. Four verbs:

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

**Fallback and abort criterion:** if WhatsApp Business API access is blocked or metered
beyond budget, the pilot runs on the shipped **Discord** bridge and WhatsApp re-scopes
to a later work package. Discord is a technical fallback, not a proven adoption path
(field behavior already routed around it once): the pilot carries an explicit abort
criterion — **if after one week <50% of evidence arrives via the bot, stop and revisit
the channel decision** rather than pushing adoption uphill. Pass/iterate/abort bands
live in the frontmatter `metrics:` map (`wp0_evidence_via_bot`).

#### PC-010 Agent tabular read/write to Teable — [Engineer/PM] [Slice 1 · WP-0 verb 4]
As an engineer, I want my agent to read and write Teable rows directly (an OEM catalog
row, a BOM line item, a dossier section), so that structured data is filed into the
system of records from chat, not typed in later. PC-005 stays one-directional card
mirroring; this story is the separate, bidirectional tabular capability.
1. An explicit allowlist declares which Teable bases/tables are agent-writable; writes outside it are refused with an actionable message.
2. Schema mapping is declared per table (agent field → Teable column, types validated); unmappable payloads are rejected, never partially written.
3. Write conflict policy: agent writes never overwrite newer human edits — a conflicting write is surfaced on the card as a conflict comment for human resolution (last-writer-wins is not acceptable for human edits).
4. Every write links the created/updated row on the originating card as an external object (provider `teable`) and appends one dossier Evidence-log line.
5. Reads let the agent answer "what's in table X for Y" in chat without granting write scope.
- Binding: `external_objects(provider=teable)`, Teable REST, `issue_documents("dossier")`, `activity_log`

### Supporting platform [Slice 1]

#### PC-003 Personal agent onboarding — [Engineer] [Slice 1]
As an engineer, I want a personal agent in chat bound to my Paperclip identity, so that the
recorder works for me instead of me working for it (AD-033).
1. Hermes profile `eng-<name>` registered through existing `hermes-gateway` adapter as an `agents` row.
2. Chat user ↔ Paperclip user mapping; agent acts only on cards where that engineer is assignee or creator.
3. `max_turns` defaults to 150 (AD-037 spend governor).
4. Onboarding one engineer takes <30 min and is documented as a runbook.
- Binding: `packages/adapters/hermes-gateway`, `agents`, chat bridge (Discord shipped, WhatsApp per WP-0)

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
| C13 | **DECIDED (2026-09-01):** supported channels are Discord + WhatsApp, chosen for stability and integration support (Zalo excluded on those grounds). Per-engineer channel variance remains open — WP-0's abort criterion is the check | WP-0 channel choice | PM |
| C14 | Evidence gate needs real transition hook; cron fallback MVP-only | PC-001 AC4 | t3-backend |
| C16 | Confidential cards excluded from MVP; confidential projects never onboarded to chat bots (structural control, see WP-0) | defense work entering backlog | Viet |

**Readings to verify** (interpretations of the diagrams): ĐNĐH = đề nghị đặt hàng; PUC = Product
Use Case; red-filled step boxes = weakly-recorded steps; gate #3 approved by customer/tender
authority, recorded by Sale; Nhóm hỗ trợ owns Mua hàng in part 2.

## Sequencing

| Slice | Stories | Gate to advance |
|---|---|---|
| Slice 0 (infra) | kvm8 stabilise — 2 stacks, 1 Caddy, UFW, NAS backups | AUDIT-KVM8-001 D-items closed |
| Slice 1 — 1 engineer | Substrate first: PC-001, 002, 004, 007 → then WP-0 (four verbs, incl. PC-010) on top → supporting PC-003, 005, 006 + PC-402 (pilot) | One real job order end-to-end through the gate; `wp0_evidence_via_bot` band met (≥80% pass, <50% after 1 week = abort/revisit channel); usable WP-close export |
| Slice 2 — engineering phases | PC-008, 009, 201..205, 301, 302, 401, 403..406, 501 | OQ-2/3/4 decided; C14 hook landed |
| Slice 3 — whole org | PC-101..107, 303..305, 502 | Sale/Sourcing/Kế toán onboarded; C16 resolved before defense work enters |

## Filing status

Per /spec Phase 5 (pending owner confirmation): each PC-xxx files as a GitHub issue on
`tetracilin/test_ai_todo` (dedupe verified clean 2026-09-01 — only Dependabot bumps open).
Record issue numbers here as they are filed.

| Story | Issue # | Filed |
|---|---|---|
| (none yet) | — | — |
