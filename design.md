---
id: T3-DESIGN
role: design
status: ACTIVE
owner: tetracilin
siblings: [roadmap.md, backlog.md]
updated: 2026-09-01
---

# T3 Company OS — Architecture Notes

This file is one of the three fork-owned source-of-truth (SSoT) documents, together with
[`roadmap.md`](roadmap.md) (identity, user stories, horizons) and [`backlog.md`](backlog.md)
(incremental work packages). This one records the architecture the roadmap and backlog
assume. Design record: `docs/designs/t3-company-os-ssot.md`.

> The **UI design language** (tokens, component rules, `check:token-gates`) is a separate
> concern and lives at [`doc/design/DESIGN-UI.md`](doc/design/DESIGN-UI.md).

## Control plane + adapters

The core is upstream Paperclip's control plane: company-scoped projects, issues
(single-assignee, atomic checkout), approvals, budgets, activity logging, heartbeats and
wakeups. Agent runtimes attach through adapter packages (`packages/adapters/*`); the
fork's field agents run through the `hermes-gateway` adapter. Domain bindings for T3's
business process are fixed by the K6 domain map
(`docs/migration/test-ai-todo-domain-map.md`) — no new tables without cause.

## Two-surface model

- **Conversation captures.** Chat is where work arrives: job orders, evidence photos,
  clarifications, "brief me". The agent structures what arrives into cards, dossier
  entries, and evidence links. Field users never fill forms.
- **The board plans.** The Paperclip board (and its Teable mirror for office staff) is
  where WPs, sequencing, approvals, and review live — the wide-screen, at-the-desk
  surface.

## Two-tier plugin integration

- **Tier 1 (default for most tools):** file store + version control with viewing —
  drawings, PDF, docx/xlsx. The v1 workflow is download → edit in the native desktop
  tool → re-upload with version notation. Unglamorous, general, ships first. FreeCAD,
  KiCad, Figma, and email all enter at Tier 1.
- **Tier 2 (edit-in-app, adopted per tool):** WOPI/LibreOffice is shipped; next
  candidates are Penpot, Excalidraw, and draw.io. A tool earns Tier 2 only after Tier 1
  demonstrates demand.

## Chat-bridge abstraction

One abstraction, multiple channel instances. The **Discord bridge is the shipped first
instance**; **WhatsApp is the second**, built to the same shape (message intake →
agent → card/evidence/dossier actions → confirmations back into chat). Channel choice is
a deployment concern, not an architectural one — the four bot verbs (capture, re-brief,
PM digest, tabular records) sit above the bridge. The language boundary is implemented
at the agent's **system prompt**: engineer-facing conversation is Vietnamese; code,
prompts, docs, and agent internals stay English. Captured content stays verbatim
Vietnamese (it is evidence); structure is English. Confidential (defense/B2G) projects
are never onboarded to chat bots at all — their evidence path is the NAS drop folder,
with cards carrying path references only; bot-side refusal is defense-in-depth, not the
control.

## Teable — system of records for tabular data

Flat tabular data (OEM catalogs, BOM line items, design-dossier sections) lives in
Teable. Cards link Teable rows as external objects (provider `teable`). Two distinct
capabilities, kept separate in the backlog: **PC-005** mirrors cards one-directionally
Paperclip → Teable (board GUI for office staff); **PC-010** gives agents direct tabular
read/write (filing an OEM row or BOM item into Teable and linking it), with its own
write-conflict policy, schema mapping, and an explicit allowlist of agent-writable
bases/tables.

## gbrain memory

gbrain (github.com/garrytan/gbrain) is the memory plane. First use: memory source for
the re-brief verb — what this engineer did, decided, and left open. Whether it grows
into a full knowledge plane is an open question in `roadmap.md` (NEXT horizon).

## Company skill repo

Company-wide skills are versioned, reviewed, and rolled out from a skill repository,
using the hermes-agent workspace pattern (`doc/HERMES_GATEWAY_ONBOARDING.md`) as the
template: an agent's workspace assembles identity, skills, and secrets per run. The
versioning/review/rollout mechanics need their own spec (open question in `roadmap.md`).

## Self-development pipeline

Feedback → Claude Code → staging → nightly CI/CD is a first-class subsystem, because
adoption at this company historically died on buggy, slow-to-adapt tools.

- **Charter:** consolidation, bugfixes, and user-feedback adaptation only — no
  autonomous feature invention — until the wedge metric (`backlog.md`
  `wp0_evidence_via_bot`) is green.
- **Health metrics:** merged auto-PRs vs. regressions/rollbacks vs. engineer-facing
  usage improvements, reviewed at 60 days.
