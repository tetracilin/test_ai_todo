# Contributing

## Setup

```bash
npm install
cd discord-bridge && npm install && cd ..
```

## Testing

This repo is tested at three layers. Every feature or bugfix PR must add or
update tests at the layer(s) the change touches:

| Layer | Tooling | Where | Covers |
| --- | --- | --- | --- |
| Unit | Vitest + Testing Library (jsdom) | `**/*.test.{ts,tsx}` next to the source file; `discord-bridge/src/**/*.test.ts` | Pure logic (services, hooks), components, discord-bridge modules |
| Integration | Vitest (node) + Supertest | `integration/**/*.test.ts` | `server.cjs` HTTP behavior, discord-bridge's Paperclip API client against an in-process stub |
| E2E | Playwright | `e2e/**/*.spec.ts` | User-facing journeys through the built app |

Run them:

```bash
npm run typecheck        # tsc --noEmit
npm run test:unit        # vitest (jsdom)
npm run test:integration # vitest (node) against integration/
npm run test:e2e         # playwright, builds + serves the app first
npm test                 # test:unit + test:integration

cd discord-bridge && npm test
```

### What to add, by change type

- **Pure logic change** (a service, a hook, a reducer): add/update a unit test next to the file, e.g. `services/csvService.ts` → `services/csvService.test.ts`.
- **New/changed HTTP behavior** (`server.cjs`, discord-bridge's Paperclip client): add/update an integration test under `integration/` or `discord-bridge/src/lib/*.contract.test.ts`.
- **UI-visible change** (a new view, a changed user flow): add/update an e2e spec under `e2e/`, covering the golden path plus at least one edge case (validation error, empty state, etc).
- **Config/docs/deploy-only change**: no test required — see the exemption below.

### PR requirements

- Every PR description must include a `## Test plan` section naming what was tested and how.
- Use the PR template checklist (unit / integration / e2e) to mark what applies.
- CI enforces this with `npm run check-tests` (`scripts/check-tests.mjs`): it diffs your branch against `main`, and fails if a changed source file under `src`-equivalent trees (`components/`, `hooks/`, `services/`, `context/`, `integration/`, `e2e/`, `discord-bridge/src/`, plus root `server.cjs`/`App.tsx`/etc.) has no matching test change in the same subtree.
- **Exemption**: if a PR genuinely has no testable surface (dependency bump, docs, CI config, formatting), put `[skip-test-check]` plus a one-line reason in the PR description and the guard will pass anyway.

### Planning-stage convention

When planning a feature (a Paperclip issue plan, a design doc), include a
**Tests** section stating which layer(s) the change will touch and which
files will gain or update tests, before implementation starts. This applies
to both human and agent contributors.
