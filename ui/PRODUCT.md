# Product

<!-- impeccable:product-schema 1 -->

Scope: the board UI (`ui/`). Durable product truth for design work on this surface. The
fork's SSoT trio (`roadmap.md`, `backlog.md`, `design.md` at the repo root) stays
authoritative; this file condenses what design decisions need from it. Upstream
Paperclip's product definition (`technical-spec/product/PRODUCT.md`) is the substrate, not
the identity.

## Platform

web

## Users

Primary users of the board, in no fixed order (confirmed 2026-10-23):

- **Founder-operator.** Runs the whole company OS: agents, skills, budgets, process
  templates, company export/import. Sets the operating system up again for each new
  project or organization.
- **PM as orchestrator.** Works at the desk. Reviews the daily digest of filed evidence
  and cards blocked on missing evidence, corrects cards, sequences work packages,
  approves. Reviews, corrects and briefs; the system does the recording.
- **Field engineer.** Mostly works through the chat bot (Vietnamese), but sometimes opens
  the board directly, **on a phone, on site**: the current card, its dossier, open evidence
  gaps, the next task.

The CTO/reviewer role (closing WPs, querying dossiers and evidence) exists in the
roadmap. It was not confirmed as a primary board user.

## Product Purpose

T3 Company OS is a personal company operating system. It is plugin-first, agent-native
and portable. Its job is to turn messy contract-engineering execution into institutional
memory at near-zero data-entry cost. Agents structure, file, summarize and brief, so
nobody in the field fills a form.

Success, for the current wedge: in a one-week pilot with one engineer and one PM, at
least 80% of evidence items arrive through the bot without the PM re-entering them (bands
and abort criterion in `backlog.md`).

## Positioning

It is not a PM tool. **Conversations capture, the board plans.** Chat is where work
arrives: job orders, evidence photos, clarifications, "brief me". The board is where work
packages, sequencing, approvals and review live. Execution becomes a queryable record
(dossier per card, evidence index, activity) as a side effect of doing the work. It is
not a separate reporting chore. The whole company (agents, skills, memory, templates)
travels with the founder.

When this identity and upstream Paperclip's "control plane for autonomous AI companies"
framing disagree, **T3 Company OS wins**. Upstream concepts (companies, agents,
heartbeats, budgets, approvals) are the substrate.

## Operating Context

- **Two surfaces.** Chat (the Discord bridge has shipped; WhatsApp is the target) and the
  board. Field input reaches the board through agents, not forms. The board is used at
  the desk by the PM and founder, and on a phone on site by engineers.
- **Mirror.** Teable mirrors board data for office staff (self-hosted).
- **Recorder substrate.** Evidence gate on Done (PC-001), a dossier document on every
  card (PC-002: Job order · Clarifications · Evidence log · Scope changes · Related
  Teable rows), job-order intake (PC-004), evidence linking (PC-007).
- **Files.** Tier 1: download, edit in the native desktop tool, re-upload with a version
  note (drawings, PDF, docx/xlsx). Tier 2 edit-in-app is adopted per tool
  (WOPI/LibreOffice has shipped).
- **Deployment.** Self-hosted. Staging and production are login-gated
  (`authenticated` mode) on a private tailnet.

## Capabilities and Constraints

- **Language.** The board UI is **Vietnamese by default**; English is secondary (the
  `ui/src/i18n` locales include `vi` and `en`; the code default is still `en`). Captured
  content stays verbatim Vietnamese because it is evidence. Structure, code, prompts and
  docs stay English. Layouts must hold up with Vietnamese string lengths and diacritics.
- **Mobile.** The surfaces field engineers touch (card, dossier, evidence, next task)
  must work as mobile web on a phone. Mobile web stays `web`; there is no native app.
- **Confidential projects.** Defense/B2G projects are never onboarded to chat bots. Their
  evidence arrives through a NAS drop folder, and cards carry path references only.
- **Tokens only.** `ui/src/components/**` and `ui/src/pages/**` use only tokens from
  `ui/src/index.css`, enforced by `pnpm check:token-gates`. Structural design rules live
  in `technical-spec/designs/DESIGN-UI.md`.
- **Data model.** Domain bindings follow the K6 domain map
  (`technical-spec/fork/migration/test-ai-todo-domain-map.md`); no new tables without
  cause.
- **Terminology.** Card (issue), work package (WP), dossier, evidence, evidence gate,
  job order, re-brief, PM digest.

## Brand Commitments

- Name: **T3 Company OS** (a hard fork of Paperclip). Positioning language comes from
  `roadmap.md`.
- Brand values (color, type, iconography) are **intentionally unspecified**. Per
  DESIGN-UI.md they are being redesigned and will land only as token values. Do not
  hardcode or invent them.

## Evidence on Hand

- The demand evidence in `roadmap.md` is qualitative and observed: an engineer used chat
  unprompted to submit evidence, and the PM became a manual data-entry assistant.
  Engineers need a re-brief at every task start.
- There are no pilot results, metrics, customers or testimonials yet. Do not fabricate
  any.

## Product Principles

1. **Capture costs nothing.** If a field user would have to fill a form, the design is
   wrong. Agents structure; humans review and correct.
2. **The record builds itself.** Every card carries its dossier and evidence; who did
   what, with what evidence, is visible without a separate reporting step.
3. **Re-brief on entry.** Anyone opening a card should see the current state, open
   evidence gaps and the next action first.
4. **Plan on the board, capture in conversation.** Do not turn the board into a chat app.
   Do not make field work depend on the board.
5. **Portable and plugin-first.** Company state exports and imports. Special surfaces
   live in plugins, not in the core.

## Accessibility & Inclusion

WCAG 2.2 AA (confirmed 2026-10-23). Vietnamese is the primary UI language, and on-site
phone use is a real context (outdoor glare, one hand, interruptions).
