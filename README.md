# T3 Project Management Tool

A fork of [Paperclip](https://github.com/paperclipai/paperclip) — a control plane for AI-agent
companies — adapted into a project-management tool where humans and agent collaborators work
together inside the same task/issue workflow, with scheduling (routines, calendar, today view,
inbox triage) as a first-class capability.

This fork was forked wholesale from the Paperclip baseline (see `AGENTS.md`, `doc/GOAL.md`,
`doc/PRODUCT.md`, `doc/SPEC-implementation.md` for the inherited architecture and conventions),
then extended with scheduling features ported from the `test_ai_todo` prototype app. See
`doc/SCHEDULING-FEATURE-BREAKDOWN.md` for the feature-by-feature port plan and status.

## Setup

- Node.js 20+
- pnpm 9+
- PostgreSQL (see `doc/DATABASE.md`)

```sh
pnpm install
pnpm dev
```

This starts the API server (`http://localhost:3100`) with the UI served in dev middleware mode.
