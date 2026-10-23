# Upstream adapter fixes and AI-credentials (Connections) import: design

Date: 2026-10-23
Status: DRAFT for owner review (nothing implemented)
Sub-project 1 of 3. Siblings (specs to follow): BYO-key onboarding, documents (WOPI + agent edits).

## 1. Intent

The owner wants the agent runtimes (Claude Code CLI, Hermes gateway, Hermes local, process, http) to run on
the official, tested upstream adapters, and wants users to bring their own Claude, Codex or other coding
harness credentials instead of relying on keys pre-set on the host.

What the owner said: use upstream's tested adapters instead of "my own development"; let users bring their own keys.
Assumptions (please correct):
- "Official" means upstream `paperclipai/paperclip` code under its MIT licence, imported under the fork's
  feature-driven import rule in `CLAUDE.md` (minimum files, fork wins on conflict, provenance in the PR body).
- Success means: the adapters carry upstream's bug fixes and tests, and a user can run an agent on a credential
  they supplied, with no key silently taken from the host.

## 2. Findings

### 2.1 The adapters are already upstream's, not fork-built
The five adapters came from upstream at the fork point `233c12f0` (2026-08-20). The fork's whole adapter diff is
22 files, +241/-80. The real gap is upstream drift since then (upstream master `c5ca29db`, 2026-10-23):

| Adapter | Upstream commits since fork | Fork-only changes to keep |
|---|---|---|
| claude-local | 58 (24 test files vs the fork's 15) | test fixes (#165) |
| hermes (hermes_local + gateway code) | 17 | `src/shared/hermes-home.ts` (#136), `skills.ts`, `execute.ts` edits |
| hermes-gateway package | 4, build bumps only | nothing to import |
| process | 4, tied to usage checkpointing | none |
| http | 3, one security hardening fix `9dd6526b47` (#12776) | none |

`server/src/adapters/registry.ts` and `builtin-adapter-types.ts` (the fork's selectable list, #73/#118/#140) stay the fork's.

### 2.2 Upstream solved "bring your own key" as AI Connections
Upstream PR #13247 (`47ded8bf97`, merged 2026-09-12) manages AI credentials through the existing connection grants:
per-provider capabilities (Claude, OpenAI, OpenRouter, Grok), credentials stored on grants, the responsible user's
default or an explicitly permitted grant, and **no ambient fallback to host keys** once a credential is managed.
Legacy agents keep their current auth until they explicitly adopt a managed connection. #13248 adds the UI.

### 2.3 Step 0 result: compatibility check (static, against fork `61de3674`)
Present in the fork (good): `connection_grants` / `tool_connections` (`packages/db/src/schema/tool_access.ts`),
`tool-access.ts`, `secrets.ts`, `activity-log.ts`, `access.ts`, `routes/authz.ts`, `adapter_auth_sessions`,
`setup-token-session.ts`, `codex-auth-reconciliation.ts`, `anthropic.json` app definition, the codex-local,
grok-local and opencode-local adapters, `adapter-utils/execution-target`.

Missing in the fork (the integration points of #13247/#13248):
- `server/src/services/connection-intents.ts`, `connection-intent-delivery.ts`, `packages/shared/src/types/connection-intent.ts`
- `server/src/services/native-runtime/*`, `device-login-service.ts`, `packages/paperclip-runner`
- `packages/shared/src/app-definitions/{openai,openrouter,xai}.json`
- UI: `new-agent/AgentProviderConnection.tsx`, `NewAgentSetup.tsx`, `AdapterLoginChrome.tsx`,
  `onboarding/SavedProviderKeySelect.tsx`, `lib/saved-provider-credentials.ts`, `features/connections/ConnectionSetupFlow.tsx`
- Upstream migrations 0235-0275 (the fork's last is 0234); upstream's `0276` cannot be copied.

#13247 modifies existing files (`heartbeat.ts` +55, `routes/agents.ts` +105, `connection-intents.ts`, `tool-access.ts`,
`native-session-executor.ts`) in ways that assume the missing pieces.

Verdict: **partial go.** The self-contained core is portable: roughly 2.7k lines of `ai-connections.ts`,
`ai-connection-runtime.ts`, `connection-credential-bindings.ts`, `local-ai-login.ts`, `local-ai-credentials.ts`,
`routes/ai-connections.ts`, `shared/ai-connections.ts`, `db/schema/ai_connection_defaults.ts`, three provider
app definitions, and their tests. The intents and native-runtime hunks, and #13248's UI, are not portable as-is.
This is a static check; a typecheck of a throwaway port is still the first task of the plan and may add to this list.

## 3. Approaches

A. **Import the core, build the UI fork-side (recommended).** Port the server/shared/db core of #13247 plus the
   self-contained adapter fixes. Skip intents, native runtime and #13248's UI. Build the onboarding step (sub-project 2)
   on the ported `/ai-connections` API. Smallest import that delivers upstream's credential model and keeps the
   "no host fallback" guarantee.
B. **Port the full #13247/#13248 chain with its prerequisites** (connection wizard #10910, intents, native runtime, new-agent UI).
   Closest to upstream, but pulls tens of thousands of lines of unrelated features and breaks the "minimum files" rule.
C. **Skip Connections; extend the fork's user-secrets and setup-token flows.** Least import, most fork-owned code,
   and re-invents what upstream already tested. Fallback if the throwaway typecheck shows A is not viable.

## 4. Design (approach A)

### 4.1 PR series (each from `origin/develop`, one concern each, provenance `Adapted from paperclipai/paperclip@<sha>:<path>`)
1. `fix/http-adapter-boundary-hardening`: upstream `9dd6526b47`. A security fix, so per `CLAUDE.md` a human performs the cherry-pick.
2. `feature/claude-local-upstream-fixes`: `cc549691a1`, `082423000e`, `1ead554bd1`, `dffc2b3ca1`, `3b4b270650`, quota
   classification (`f447990d77`, `d54b750111`, `300a89ec13`), acpx stall handling (`938a441944`, `4b766b8729`, `3935e300dd`),
   model refreshes (`cab4263dc9`, `dfdfc8664e`, `5128b4f323`), with matching upstream tests. Keep #165. Re-test #129.
3. `feature/hermes-upstream-fixes`: `abbd88007f`, `ed0c6958f8`, `2145925f71`, `4b8ec588f3`; keep `hermes-home.ts`.
4. `feature/ai-connections-foundation`: the portable core from 2.3. Migration regenerated with `pnpm db:generate` as the
   next fork number (additive only). Existing agents are untouched until they adopt a connection.
5. `feature/adapter-test-lanes`: add `adapter-hermes-gateway`, `hermes` and other fork packages to the vitest lanes
   (step 3 of `docs/designs/nightly-slow-tests-analysis.md`); add tests for `server/src/adapters/process` (0 today) and `http` (1).
6. Optional, decide later: custom model providers (#14970, relevant to #124 Hermes needing OpenRouter).

The adapter-fix PRs (2, 3) do not depend on 4 and can proceed in parallel.

### 4.2 Constraints
- Every adapter commit is checked for imports from Runner, Connections-intents, identities or observability; if present, only the self-contained hunk is taken.
- `adapter-utils` is shared: diff the fork's version at the fork point against upstream before taking acpx fixes.
- Server changes need `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` then the relevant `npx vitest run server/src/__tests__/<file>.test.ts` locally, because t3-ci runs no server tests.
- No changes to `.github/workflows/`, `deploy/` in these PRs.

### 4.3 Testing
- Imported upstream tests run green in their packages; fork tests that exist today still pass.
- `ai-connections.test.ts` and `ai-legacy-compatibility.test.ts` ported with the core; they prove legacy agents keep working.
- Manual: a Claude Code run on a non-Windows host (#123), a Windows run after PR 2 (#129), Hermes Gateway end to end (#122).

## 5. Open questions for the owner
1. Is approach A acceptable, i.e. is it fine that the onboarding UI is fork-built rather than ported from #13248?
2. Do you want to do the `http` security cherry-pick (PR 1) yourself, as the policy requires, or should I prepare the branch for you to review?
3. Should #14970 (custom model providers) be in scope now?
