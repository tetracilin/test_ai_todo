# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
## Read 'Backlog.md' for context 
'Backlog.md' at the repo root is the high level planning written by a product owner with confirmation from human user. The file list out the structure of the software. 

## Read `AGENTS.md` first

`AGENTS.md` at the repo root is the canonical contributor guide (repo map, core engineering
rules, DB change workflow, API/auth expectations, UI expectations, PR requirements, definition of done). Everything there applies to Claude Code sessions too — this file adds command references and architecture context that complement it, without repeating it.

Also read, in order, before non-trivial changes: `doc/GOAL.md`, `doc/PRODUCT.md`,
`doc/SPEC-implementation.md` (the concrete V1 build contract), `doc/DEVELOPING.md`,
`doc/DATABASE.md`.

## Fork identity

This repo (`tetracilin/test_ai_todo`) is the T3 AI Todo fork of `paperclipai/paperclip`. Fork work
integrates on `integration/paperclip`; `main` stays the preserved legacy application until an
explicit human cutover. Keep `upstream` pointed at `https://github.com/paperclipai/paperclip.git`,
follow `doc/UPSTREAM-SYNC.md`, and preserve `LICENSE`/`NOTICE` when copying upstream code. Never
force-push `integration/paperclip` or `main`.

## Commands

Package manager is pnpm (`packageManager: pnpm@9.15.4`), Node 20+. This is a pnpm workspace
(`pnpm-workspace.yaml`): `server`, `ui`, `cli`, and everything under `packages/*` (including
`packages/adapters/*` and `packages/plugins/*`).

```sh
pnpm install          # install workspace deps
pnpm dev               # full dev, API+UI, watch mode — API at http://localhost:3100 (UI served by API in dev middleware mode)
pnpm dev:once          # full dev without file watching, auto-applies pending local migrations
pnpm dev:server        # server only
pnpm dev:mobile        # build UI once, serve prebuilt bundle on :3101 (proxies /api -> :3100)
pnpm dev:list          # list this repo's managed dev runner
pnpm dev:stop          # stop it
pnpm build             # build all workspace packages
pnpm typecheck         # pnpm -r typecheck across the workspace
pnpm storybook         # UI Storybook on :6006 (config under ui/storybook/)
```

Leave `DATABASE_URL` unset in dev — the server auto-starts an embedded PostgreSQL instance
persisted at `~/.paperclip/instances/default/db`. Reset it with `rm -rf ~/.paperclip/instances/default/db && pnpm dev`.

### Tests

```sh
pnpm test              # cheap default: Vitest only, via scripts/run-vitest-stable.mjs (sharded/serialized to avoid embedded-PG contention)
pnpm test:watch        # vitest watch mode
```

Vitest is configured as a multi-project workspace (`vitest.config.ts`) covering `server`, `ui`,
`cli`, and each package under `packages/*`/`packages/adapters/*`/`packages/plugins/*`. To run a
single test file or a narrower slice, call vitest directly rather than the stable-run wrapper:

```sh
npx vitest run path/to/file.test.ts        # single file, from repo root
npx vitest run path/to/file.test.ts -t "test name"   # single test by name
pnpm --filter @paperclipai/server exec vitest run src/some.test.ts
pnpm --filter @paperclipai/db test          # package-scoped test script, where defined
```

Browser suites are opt-in, not part of `pnpm test` — run them only when the change touches that
surface, or when explicitly verifying CI/release flows:

```sh
pnpm test:e2e            # Playwright, tests/e2e
pnpm test:release-smoke  # Playwright, tests/release-smoke
pnpm test:storybook-visual   # Linux/Ubuntu-only pixel baselines; see doc/DEVELOPING.md
```

For normal issue-sized work, run the smallest relevant check (a single test file, or one
package's typecheck/test) rather than repo-wide typecheck/build/test. Before a PR-ready hand-off,
or when a change is broad, run the full check:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

### Database

```sh
pnpm db:generate        # generate a Drizzle migration (compiles packages/db first; drizzle.config.ts reads dist/schema/*.js)
pnpm db:migrate         # apply migrations
pnpm -r typecheck       # validate compile after schema edits
```

Data-model workflow: edit `packages/db/src/schema/*.ts` → export new tables from
`packages/db/src/schema/index.ts` → `pnpm db:generate` → `pnpm -r typecheck`.

### UI design tokens

`ui/src/components/**` and `ui/src/pages/**` must use only tokens from `ui/src/index.css` (no hex,
raw px, arbitrary Tailwind bracket values, or raw `font-size`/`fontSize`, outside the documented
allowlist). `DESIGN.md` is the source of truth. Run before committing UI changes:

```sh
pnpm check:token-gates
```

## Architecture

Paperclip is a Node.js/Express API server plus a React/Vite UI that orchestrates teams of AI
agents ("agent employees") for a company. In dev, the server serves the UI itself in Vite
middleware mode from the same origin (`:3100`).

**Workspace layout** (see `AGENTS.md` §3 for the authoritative list):

- `server/` — Express REST API and orchestration services. `server/src/routes/*` are thin HTTP
  handlers; `server/src/services/*` hold the actual domain logic (agents, approvals, budgets,
  heartbeats/wakeups, company portability, secrets, decision queues, workspaces, etc.). Base API
  path is `/api`.
- `ui/` — React + Vite board UI. `ui/src/pages/*` are route-level screens, `ui/src/api/*` are the
  typed API clients consumed by pages/components, `ui/src/components/*` are shared UI pieces.
- `packages/db/` — Drizzle schema (`src/schema/*.ts`, one file per table), migrations
  (`src/migrations/`), and DB client/runtime helpers. This is the single source of truth for the
  data model.
- `packages/shared/` — cross-cutting types, constants, API path constants, and validators
  imported by both `server` and `ui` so contracts stay in sync.
- `packages/adapters/*` — one package per agent runtime (`claude-local`, `codex-local`,
  `cursor-local`, `cursor-cloud`, `grok-local`, `kimi-local`, `opencode-local`, `pi-local`,
  `hermes`, `hermes-gateway`, `openclaw-gateway`). `packages/adapter-utils/` holds shared adapter
  plumbing. `server/src/adapters/` is where the server registers and invokes these at runtime;
  `cli/src/adapters/` is the CLI-side counterpart for local/process/HTTP adapter invocation.
- `packages/plugins/` — the instance-wide plugin system (`sdk`, example plugins, sandbox
  providers). Plugins extend Paperclip out-of-process rather than by forking core.
- `packages/skills-catalog/` and `packages/teams-catalog/` — app-shipped, checked-in catalogs
  (`catalog/bundled|optional/<category>/<slug>/{SKILL,TEAM}.md` + a generated `catalog.json`
  manifest). Server/CLI read the generated manifest at request time, they do not crawl the
  filesystem. Regenerate the manifest in the same commit as any catalog edit
  (`pnpm --filter @paperclipai/skills-catalog build:manifest`, same pattern for teams-catalog).
- `cli/` — the published `paperclipai` CLI: setup/onboarding, `doctor`, `configure`, worktree
  management, and agent-facing client commands (issues, agents, dashboards) via `paperclipai
  <noun> <verb>`.
- `skills/` — Paperclip's own runtime/operational skills (distinct from the shipped app catalog
  under `packages/skills-catalog`).
- `.agents/skills/` and `.claude/skills/` — skills for AI contributors working *on* this repo
  itself (release process, PR gardening, doc maintenance, etc.) — not shipped to end users.

**Core domain model** (control-plane invariants, see `AGENTS.md` §5 for the full list): everything
is company-scoped and company boundaries are enforced at the route/service layer; issues use a
single-assignee model with atomic checkout (no double-work); governed actions go through approval
gates; budgets auto-pause agents on hard-stop; mutating actions are activity-logged. Agents run on
DB-backed heartbeats/wakeups (scheduled + event triggers like assignment or @-mention), with
workspace resolution, secret injection, and skill loading happening per run.

**Changing a contract**: because `packages/db` → `packages/shared` → `server` → `ui` form a
dependency chain, a schema or API behavior change typically touches all four layers — update DB
schema/exports, shared types/constants/validators, server routes/services, and UI API
clients/pages together (`AGENTS.md` §5.2).

**Local instance state** lives outside the repo, under `~/.paperclip/instances/default/`
(`config.json`, `.env`, embedded Postgres `db/`, `data/storage`, `data/backups`, `logs/`,
`secrets/master.key`, per-agent `workspaces/<agent-id>/`). `PAPERCLIP_HOME` /
`PAPERCLIP_INSTANCE_ID` override the root/instance id. Git-worktree-based dev instances get their
own isolated instance under `~/.paperclip-worktrees/` via `paperclipai worktree init` — never point
two servers at the same embedded Postgres data directory.

## gstack

For all web browsing in this project, use the `/browse` skill from gstack. Never use the
`mcp__claude-in-chrome__*` tools directly.

Other gstack skills available: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`,
`/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`,
`/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`,
`/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`,
`/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`,
`/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`,
`/unfreeze`, `/gstack-upgrade`, `/learn`.

## Agent-authored PRs and artifacts

Every PR (human or AI) must fill in `.github/PULL_REQUEST_TEMPLATE.md` in full, including a
"Thinking Path" (see `CONTRIBUTING.md` for the expected style) and a "Model Used" section. See
`AGENTS.md` §§10–11 for the required sections and definition of done.

When a task produces a user-inspectable deliverable file, follow the artifact upload workflow in
`doc/AGENT-ARTIFACTS.md` (prefer `skills/paperclip/scripts/paperclip-upload-artifact.sh`) rather
than leaving it only as a local workspace path — see `AGENTS.md` §5.6.
