---
id: T3-ROADMAP
role: roadmap
status: ACTIVE
owner: tetracilin
siblings: [backlog.md, design.md]
updated: 2026-09-01
---

# T3 Company OS — Roadmap

This file is one of the three fork-owned source-of-truth (SSoT) documents, together with
[`backlog.md`](backlog.md) (incremental work packages) and [`design.md`](design.md)
(architecture notes). This one carries identity, high-level user stories, and horizons.
Design record: `docs/designs/t3-company-os-ssot.md`. The upstream Paperclip roadmap is
not tracked in this fork: this is a hard fork with an independent roadmap.

## Identity

A **personal company operating system**: plugin-first, agent-native, and portable — it
travels with the founder to any project or organization. Its job is converting messy
contract-engineering **execution into institutional memory** at near-zero data-entry
cost. It is not a PM tool: the board plans, but conversations capture — agents
structure, file, summarize, and brief, so nobody in the field ever fills a form.

This repo is a hard fork of `paperclipai/paperclip` (control plane for AI-agent
companies) with a fully independent roadmap; upstream changes arrive only as one-way
selective cherry-picks at the owner's discretion.

### Why this exists (demand evidence)

- A field engineer, unprompted, used a chat client to submit evidence and ask
  clarifications, then recruited the PM as a human assistant for data entry. The PM
  orchestrated, reviewed, and summarized evidence upward to the CTO. The organization
  manually invented the missing product feature — the strongest possible demand signal.
- Engineers plan like memoryless agents: they need re-briefing at every task start. The
  re-brief is an unbuilt feature with observed demand.
- Prior commercial self-hosted tools at the company died because they were too buggy and
  adapted too slowly — adoption is fragile, which is why the self-development pipeline
  (feedback → Claude Code → staging → nightly) is first-class, under a
  consolidation/bugfix charter (see `design.md`).

## High-level user stories

- **Engineer on the move** — "I forward a job order, a photo, or a question to my agent
  in chat (Vietnamese) and it becomes a card, filed evidence, or an answer — I never
  fill a form, and when I start a task the agent re-briefs me: current card, open
  evidence gaps, next task."
- **PM as orchestrator** — "I receive a daily digest of evidence filed and cards blocked
  on missing evidence, instead of doing manual data entry and writing the summary
  myself. I review, correct, and brief — the system does the recording."
- **CTO** — "Closing a work package exports dossiers, activity, and an evidence index;
  who did what, with what evidence, is queryable — the performance record builds
  itself and replanning latency is measurable."
- **Founder as portable operator** — "The whole company — agents, skills, memory,
  process templates — exports and imports, so my operating system goes with me to
  wherever I set up the next project."

## Horizons

### NOW — the wedge

The recorder loop with one engineer, reached through a chat evidence-and-briefing bot:

- **Recorder substrate**: evidence gate on Done, dossier on every card, job-order
  intake, evidence linking (backlog stories PC-001, PC-002, PC-004, PC-007).
- **WP-0 four-verb chat bot** on top of the substrate — capture, re-brief, PM digest,
  tabular records (Teable read/write, PC-010). Target platform WhatsApp; the shipped
  Discord bridge is the technical fallback. Engineer-facing conversation is Vietnamese
  (system-prompt layer); code, prompts, and docs stay English.
- Wedge metric: ≥80% of evidence items arrive via the bot without PM re-entry in a
  one-week, one-engineer + one-PM pilot (bands and abort criterion in `backlog.md`).

### NEXT

- **Tier-1 file plugins** — file store + version control with viewing for drawings,
  PDF, docx/xlsx; v1 workflow is download → edit in native desktop tool → re-upload
  with version notation.
- **gbrain memory** — memory source for re-briefs first; knowledge-plane depth is an
  open question.
- **Company skill repo** — company-wide skills that version, review, and roll out
  (hermes-agent pattern as the template).

### FUTURE

- **Tier-2 edit-in-app integrations** per tool (WOPI/LibreOffice shipped; candidates:
  Penpot, Excalidraw, draw.io).
- **LLM adapter expansion** across more runtimes/providers.
- **Email** as a capture/notification channel (enters at Tier 1).
- **FreeCAD / KiCad / Figma** integrations (enter at Tier 1 first).
