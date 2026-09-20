# New-user onboarding QA report (2026-09-20)

## Setup

- Instance `qa-onboarding`: fresh embedded Postgres, authenticated/private mode, loopback only.
- Started with `pnpm dev --bind custom --bind-host 127.0.0.1` and `BETTER_AUTH_SECRET=paperclip-dev-secret`.
- `PAPERCLIP_SELECTABLE_ADAPTER_TYPES` was **not** set. Code: branch `fix/ui-adapter-picker-selectable` on top of `065d768e`.
- Browser: gstack `browse`. Evidence files: `%TEMP%/qa-evidence/` (screenshots 01-29).
- Users: A = `qa.alice@example.test`, B = `qa.bob@example.test`. Company: "QA Company Alpha" (prefix `QAC`).

## Result by step

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | A signs up, signs out, signs in | PASS | 01, 02, 04. `POST /api/auth/sign-in/email` 200, lands on `/onboarding` |
| 2a | Onboarding: company, mission, agent name | PASS after fix (Bug 2) | 07. Wizard reached "Chief of staff" |
| 2b | Adapter grid offers Claude Code; picking it does not 422 | PASS | 08, 10. `GET /api/adapters` returns `selectable`: `claude_local,hermes_gateway`. `POST agent-hires` 201 (was 422). Environment check "Passed" |
| 2c | New Agent dialog grid not empty; preset works | PASS | 13. Grid shows Claude Code. `/agents/new?adapterType=claude_local` opens |
| 2d | Claude agent runs | BLOCKED (host) | All 3 runs `failed`: `Failed to spawn agent command ...\claude-agent-acp.cmd` (Windows). Not in this repo (`acpx` package) |
| 2e | `hermes_gateway` | PARTIAL | Create without config: 422 "apiBaseUrl and secret-backed apiKey are required". Placeholder https URL: check fails with `hermes_gateway_health_unreachable` (ENOTFOUND). Plain http remote: `hermes_gateway_plain_http_remote_denied`. **Not verified end to end** (no real gateway or key was used) |
| 3 | B joins A's company by invite link | PASS | 14, 15. Invite created by A (`POST /companies/:id/invites`, role operator). B signed up on the invite page and landed on the company dashboard. `GET /api/companies` for B returns only "QA Company Alpha" |
| 4a | Create project, create task | PASS | Project "Onboarding QA Project", task QAC-2 |
| 4b | Edit dossier, revision increments | PASS | 16. rev 1 -> rev 3, text saved |
| 4c | Status todo -> in progress -> in review | PASS | 17. `in_progress` needs an assignee (422 otherwise, toast). After "Assign to me": `in_progress`, then `in_review` |
| 4d | Add evidence | PASS | 18. Attachment listed, and the dossier Evidence log gained an entry automatically |
| 4e | Schedule the task | PASS | 19. Drag to 2 PM. `GET /scheduled-issues`: QAC-2 `2026-09-20T07:15:00Z`, 30 min |
| 4f | Daily routine appears in today's tasks | PASS after fix (Bug 3) | 24, 25, 29. Routine "Daily evening check" generated QAC-4 by itself. Today shows it at 19:00 |
| 5 | Finish task with evidence, other user reviews | PASS | 26-28. A set B as reviewer. B commented, then `PATCH status=done` with a comment. Final: `status=done`, `executionState=completed`, `lastDecisionOutcome=approved` |

## Bugs found

| # | Bug | Where | Status |
|---|---|---|---|
| 1 | Onboarding and New Agent showed adapters that 422, or an empty grid | `server/src/routes/adapters.ts`, `ui/src/components/OnboardingWizard.tsx`, `NewAgentDialog.tsx`, `pages/NewAgent.tsx`, `adapters/metadata.ts` | Fixed earlier on this branch (server advertises `selectable`; UI filters on it; empty-state text) |
| 2 | Wizard restarts at step 1 after "Confirm mission" when a saved draft exists (2 of 2 repros) | `ui/src/components/OnboardingWizard.tsx` (outer gate, `if (rawBlob !== undefined && companiesQuery.isFetching) return null`). Creating the company invalidates the companies query. The gate then unmounted the inner wizard, which restarted from a stale draft | **Fixed**: the gate now applies only before the first mount (`innerMountedRef`). Verified in the browser. No unit test added (component needs heavy mocks) |
| 3 | Scheduling routines never created tasks on their own. Only the manual "Run" button did | `server/src/services/scheduling.ts` (`generateDueIssues*`), no caller on a timer | **Fixed**: new `generateDueIssuesForActiveCompanies()` and a throttled (5 min) sweep in `server/src/index.ts` next to the external-object sweep. Test added. Verified live (server log: "scheduling-routine sweep created due tasks") |
| 4 | First real user on an authenticated instance cannot onboard: sign-up gives "No company access" and `/api/adapters` 403. The bootstrap invite path was closed because the database already had an admin (`local-board`, from an earlier `local_trusted` start) | `bootstrapStatus: ready` | Not fixed. Test workaround: insert `instance_admin` for A in `instance_user_roles`. `paperclipai auth bootstrap-ceo --force` also needs a `config.json`, which `pnpm dev` does not create |
| 5 | Claude agent run fails on Windows: `Failed to spawn agent command ...claude-agent-acp.cmd` | third-party `acpx` (not in repo) | Not fixed. Needs `shell: true` or the `.exe` shim on Windows |
| 6 | Routine form has no timezone control. Routines default to `UTC`, so "18:00" is 01:00 next day for a UTC+7 user and the task is not in Today | Scheduling Routines form | Not fixed |
| 7 | A reviewer moving the task to Done without a comment gets a 422 (toast only). There is no Approve button | `issue-execution-policy.ts:789`, `IssueDetail` | Not fixed (by design, but hard to discover) |

## Files changed in this run

- `ui/src/components/OnboardingWizard.tsx` (Bug 2; the temporary trace logs were removed)
- `server/src/services/scheduling.ts`
- `server/src/index.ts`
- `server/src/__tests__/scheduling-service.test.ts`
- `docs/qa/2026-09-20-new-user-onboarding-report.md` (this file)

Earlier on the same branch (not this run): `server/src/routes/adapters.ts`, `ui/src/api/adapters.ts`, `ui/src/adapters/metadata.ts`, `ui/src/adapters/use-disabled-adapters.ts`, `NewAgentDialog.tsx`, `pages/NewAgent.tsx`, related tests, `docs/deploy/agent-adapters.md`.

## Checks run

- `npx vitest run` on 10 files (OnboardingWizard x4, NewAgentDialog, NewAgent, metadata, adapter-routes, scheduling-service, scheduling-routes): 82 passed.
- `pnpm --filter @paperclipai/ui typecheck`, `pnpm --filter @paperclipai/server typecheck`, `pnpm check:token-gates`: clean.

## Remaining gaps

- `hermes_gateway` was not tested end to end. It needs a real gateway URL (https, tailnet) and a secret-backed key. See `docs/deploy/agent-adapters.md`.
- The Claude agent cannot run on this Windows host (Bug 5), so "agent replies to a task" was not verified.
- Bugs 4, 6 and 7 need a decision. Bug 4 in particular blocks a real first user on any fresh authenticated deployment.
- CI does not run server suites before merge; run `scheduling-service.test.ts` locally (done here) before merging.
