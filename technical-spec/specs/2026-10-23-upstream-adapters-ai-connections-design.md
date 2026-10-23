# Upstream adapter fixes and AI-credentials (Connections) import: design

Date: 2026-10-23
Status: DRAFT for owner review (nothing implemented). Owner decisions 2026-10-23: onboarding UI is fork-built; http security fix skipped for now; #14970 in scope. Eng review 2026-10-23 applied (decisions D1-D17 in section 5).
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
Order set by the eng review (D13): tests that pin current behaviour land before the changes they protect.

- ~~`fix/http-adapter-boundary-hardening`~~ (`9dd6526b47`): **skipped for now** (owner decision). Risk recorded in 4.6. Per `CLAUDE.md` a human performs the cherry-pick when it is revisited.

1. `feature/adapter-test-lanes`: add `adapter-hermes-gateway`, `hermes` and other fork packages to the vitest lanes
   (step 3 of `technical-spec/designs/nightly-slow-tests-analysis.md`); add characterization tests for
   `server/src/adapters/process` (0 today) and `http` (1). Also in this PR:
   - hide `http` from the production selectable adapter list (`server/src/adapters/builtin-adapter-types.ts`) until the
     skipped hardening lands (D3);
   - fix the http timeout contract: `index.ts:19` documents `timeoutSec` but `execute.ts:10` reads `timeoutMs` with a
     default of 0 (no timeout). Accept `timeoutSec`, keep `timeoutMs` for compatibility, default to 30 s, test all three (D16).
2. `feature/claude-local-upstream-fixes`: `cc549691a1`, `082423000e`, `1ead554bd1`, `dffc2b3ca1`, `3b4b270650`, quota
   classification (`f447990d77`, `d54b750111`, `300a89ec13`), acpx stall handling (`938a441944`, `4b766b8729`, `3935e300dd`),
   model refreshes (`cab4263dc9`, `dfdfc8664e`, `5128b4f323`), with matching upstream tests. Keep #165. Re-test #129.
3. `feature/hermes-upstream-fixes`: `abbd88007f`, `ed0c6958f8`, `2145925f71`, `4b8ec588f3`; keep `hermes-home.ts`.
4. `feature/ai-connections-foundation`: the portable core from 2.3, all listed files (D2). Migration regenerated with
   `pnpm db:generate` as the next fork number (additive only). Existing agents are untouched until they adopt a
   connection. The whole path sits behind an instance setting that is **off by default** until sub-project 2 ships
   the UI (D8). Must meet 4.4 and 4.5.
5. `feature/custom-model-providers`: upstream #14970 (`9f7057e122`), **in scope** (owner decision), after PR 4. Relevant
   to #124 (Hermes needing OpenRouter). Same step-0 rule: take only self-contained hunks. Must include the egress guard
   in 4.4 (D1), because a user-supplied base URL otherwise forwards a stored key to any host.

PR 1 lands first. PRs 2 and 3 then proceed in parallel; 4 and 5 follow in order.

### 4.2 Constraints
- Every adapter commit is checked for imports from Runner, Connections-intents, identities or observability; if present, only the self-contained hunk is taken.
- `adapter-utils` is shared: diff the fork's version at the fork point against upstream before taking acpx fixes.
- Server changes need `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` then the relevant `npx vitest run server/src/__tests__/<file>.test.ts` locally, because t3-ci runs no server tests.
- No changes to `.github/workflows/`, `deploy/` in these PRs.
- **Stop rule (D14).** Stop and ask the owner before continuing if the throwaway port needs any file from
  connection intents, native runtime or device login, more than 10 files beyond the list in 2.3, or more than 2 new
  npm dependencies. In particular, confirm `local-ai-login.ts` and `local-ai-credentials.ts` do not import
  `device-login-service.ts` (D2). Hitting the rule is the trigger for reconsidering approach C.
- **Provenance (D15).** Each PR appends its upstream sha, upstream path, fork path, PR and date to
  `technical-spec/fork/upstream-imports.md`, and its body lists every new npm dependency with `pnpm audit` output.

### 4.3 Testing
- Imported upstream tests run green in their packages; fork tests that exist today still pass.
- `ai-connections.test.ts` and `ai-legacy-compatibility.test.ts` ported with the core; they prove legacy agents keep working.
- PR 4 tests the flag both ways: with it off, behaviour is identical to today.
- Manual: a Claude Code run on a non-Windows host (#123), Hermes Gateway end to end (#122).
- **Windows gate (D9).** A Windows run after PR 2 (#129) is a merge gate for PR 2 and PR 4, with the run log or
  screenshot in the PR body.

Per-PR acceptance (D9), measured against the owner's 11-step user-flow test:

| PR | Must hold |
|---|---|
| 1 | All 11 steps unchanged; new lanes green in t3-nightly |
| 2, 3 | All 11 steps unchanged on Claude Code and Hermes agents |
| 4 | Flag off: all 11 steps unchanged. Flag on: an agent runs on a user-supplied key with no host key set |
| 5 | Flag on: a Hermes agent runs through OpenRouter on a user key (#124) |

Failure cases the user must see on the run, each with a named error code and a test (D9):

| Case | Outcome |
|---|---|
| No credential available | Run fails, code `ai_credential_missing`, message names the provider and how to add a key |
| Key invalid or revoked | Run fails, code `ai_credential_rejected`; invalid keys are also refused when saved |
| Hard quota exhausted | Agent paused with the provider's reason |
| OpenRouter out of credit (#124) | Agent paused, message says to top up credits |

A short user and operator how-to (add, rotate, revoke a key) ships with sub-project 2.

### 4.4 Security requirements
- **Egress guard (D1, PR 5).** Before any request carrying a stored key: https only; resolve DNS and block loopback,
  RFC1918, `100.64.0.0/10` (tailnet, including kmv8's `100.103.41.112`) and link-local addresses; do not follow
  redirects to a blocked host; optional instance allowlist; a key is sent only to the host it was saved for.
  Tests cover each range, redirect-to-private and DNS rebinding. The same guard is reused when the http hardening is revisited.
- **Per-run isolation (D4, PR 4).** Every adapter that receives a managed credential gets a per-run HOME or config dir
  and its own environment. claude-local ACP already remaps `CLAUDE_CONFIG_DIR` into a sandbox (`acp.test.ts:555`);
  hermes_local and process must match. Test: agent B's run cannot read agent A's key from env or files.
- **Credential lifecycle (D5, PR 4).** Keys are stored only as secret references through `server/src/services/secrets.ts`
  (`local_encrypted`), never as raw values in grant JSON. Keys are validated when saved. Revoking a key takes effect at
  the next run; runs already started finish. Keys are deleted when their user is removed from the company. Each rule
  has a test. Rotating `secrets/master.key` is an ops TODO.
- **Redaction canary (D6, PR 4).** One table-driven test runs with a canary key and asserts it is absent from the run
  transcript, the activity log, adapter error text and `/api/health`.
- **Authorization matrix (D7, PR 4).** Table-driven route tests cover the matrix below, including cross-company denial.
  The cell values are a proposal: check them against upstream's grant semantics during the port, and the owner confirms them before PR 4 merges.

| Actor | Create grant | Use grant on own agent | Use another user's grant | Revoke |
|---|---|---|---|---|
| Key owner | yes | yes | n/a | yes |
| Board admin (same company) | no | no | only if explicitly permitted | yes |
| Other member (same company) | no | no | only if explicitly permitted | no |
| Agent | no | only its responsible user's default or a permitted grant | no | no |
| Anyone in another company | no | no | no | no |

### 4.5 Runtime behaviour
- **Resolution point (D10).** Credentials are resolved at run start, not inside `claimQueuedRun` (every denying gate
  there cancels the run). A missing or revoked key fails the run with the named code from 4.3. One query per run and no
  cache, so a revoke is immediate. Resolve time is logged.
- **Cost attribution (D11).** Cost events record which connection or grant paid. Budgets keep counting all spend as
  today; a per-payer budget policy is a TODO.
- **Rate limits (D12).** A transient 429 defers the agent's next wake with exponential backoff (cap 30 min, with
  jitter). A hard quota stop pauses the agent with a visible reason. Both are tested; PR 2's quota classification
  tells them apart.
- **Observability (D17).** Activity-log events for credential resolution failure, provider auth error and quota stop,
  with provider and error code, never the key. Covered by the redaction canary.

### 4.6 Risk register
| Risk | Decision | Interim control | Owner | Revisit by |
|---|---|---|---|---|
| http adapter makes unrestricted server-side requests (`server/src/adapters/http/execute.ts:19`): no host check, redirects followed, no default timeout | Upstream fix `9dd6526b47` skipped for now (owner, 2026-10-23) | `http` hidden from the production adapter list (PR 1); timeout default (PR 1) | owner | _owner to set_ |

## 5. Decisions
1. Onboarding UI is fork-built on the ported `/ai-connections` API, not ported from #13248 (decided).
2. http security fix: skipped for now (decided).
3. Custom model providers #14970: in scope, now PR 5 (decided).

Eng review decisions (/plan-eng-review, 2026-10-23):
- D1: custom providers keep scope and must include the egress guard (4.4).
- D2: PR 4 keeps the original file arrangement.
- D3: record the http risk and hide `http` in production (4.6, PR 1).
- D4: per-run credential isolation with a cross-agent test.
- D5: full credential lifecycle.
- D6: redaction canary test.
- D7: authorization matrix with tests.
- D8: instance flag, off by default.
- D9: per-PR acceptance, failure messages, Windows gate.
- D10: resolve credentials at run start.
- D11: record the paying credential; budgets unchanged.
- D12: backoff on 429.
- D13: test lanes first.
- D14: stop rule for approach C.
- D15: provenance manifest and dependency listing.
- D16: fix the http timeout contract in PR 1.
- D17: activity-log events for credential failures.
