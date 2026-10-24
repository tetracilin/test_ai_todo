# Upstream adapter fixes and AI-credentials (Connections) import: design

Date: 2026-10-23
Status: DRAFT, nothing implemented. Reviewed by /plan-eng-review (D1-D17) and /autoplan (CEO, DX, Eng; owner
approved as-is 2026-10-23). This copy folds every accepted requirement into the section it changes; section 5 is
only an index. The owner re-approves this clean copy before PR 1 starts.
Sub-project 1 of 3. Siblings (specs to follow): BYO-key onboarding (sub-project 2, the UI), documents (WOPI + agent edits).

## 1. Intent

The owner wants the agent runtimes (Claude Code CLI, Hermes gateway, Hermes local, process, http) to run on
the official, tested upstream adapters, and wants users to bring their own Claude, Codex or other coding
harness credentials instead of relying on keys pre-set on the host.

What the owner said: use upstream's tested adapters instead of "my own development"; let users bring their own keys.
Assumptions (please correct):
- "Official" means upstream `paperclipai/paperclip` code under its MIT licence, imported under the fork's
  feature-driven import rule in `CLAUDE.md` (minimum files, fork wins on conflict, provenance in the PR body).
- Success means: the adapters carry upstream's bug fixes, and a user can run an agent on a credential they
  supplied, with no key silently taken from the host.
- The selective port keeps upstream's fixes but not upstream's combined test guarantee: upstream's tests cover
  upstream's full set of commits, not this subset. So "carries upstream's tests" is a partial criterion. Every
  ported upstream test either runs unmodified or has its edit and reason recorded in the manifest (4.8).

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
Present in the fork: `connection_grants` / `tool_connections` (`packages/db/src/schema/tool_access.ts`),
`tool-access.ts`, `secrets.ts`, `activity-log.ts`, `access.ts`, `routes/authz.ts`, `adapter_auth_sessions`,
`setup-token-session.ts`, `codex-auth-reconciliation.ts`, `codex-device-login-service.ts` (tested by
`agent-device-login-routes.test.ts`), `anthropic.json` app definition, the codex-local, grok-local and
opencode-local adapters, `adapter-utils/execution-target`, `instance_settings.experimental` (jsonb), `cost_events`.

Missing in the fork (the integration points of #13247/#13248):
- `server/src/services/connection-intents.ts`, `connection-intent-delivery.ts`, `packages/shared/src/types/connection-intent.ts`
- `server/src/services/native-runtime/*`, upstream's general `device-login-service.ts` (the fork has only the
  codex-specific one above), `packages/paperclip-runner`
- `packages/shared/src/app-definitions/{openai,openrouter,xai}.json`
- UI: `new-agent/AgentProviderConnection.tsx`, `NewAgentSetup.tsx`, `AdapterLoginChrome.tsx`,
  `onboarding/SavedProviderKeySelect.tsx`, `lib/saved-provider-credentials.ts`, `features/connections/ConnectionSetupFlow.tsx`
- Upstream migrations 0235-0275 (the fork's last is 0234); upstream's `0276` cannot be copied.

#13247 modifies existing files (`heartbeat.ts` +55, `routes/agents.ts` +105, `connection-intents.ts`, `tool-access.ts`,
`native-session-executor.ts`) in ways that assume the missing pieces.

Verdict: **partial go.** The self-contained core is portable: roughly 2.7k lines of `ai-connections.ts`,
`ai-connection-runtime.ts`, `connection-credential-bindings.ts`, `local-ai-login.ts`, `local-ai-credentials.ts`,
`routes/ai-connections.ts`, `shared/ai-connections.ts`, `db/schema/ai_connection_defaults.ts`, three provider
app definitions, and their tests. PR 4 also touches `packages/db/src/schema/cost_events.ts` (payer column, 4.5).
The intents and native-runtime hunks, and #13248's UI, are not portable as-is. This is a static check; the
throwaway port in 4.2 is the first task and may add to this list.

### 2.4 Existing per-user key bindings
The fork already binds provider keys per user. `secrets.ts:157-186` accepts `secret_ref` and `user_secret_ref`
bindings for `ANTHROPIC_API_KEY`, and binds `CLAUDE_CODE_OAUTH_TOKEN` as a fixed `user_secret_ref`;
`agent-secret-bindings.ts` syncs user-secret declarations per agent; `heartbeat.ts:809` resolves `user_secret_ref`
at run time; `ui/src/pages/secrets/MissingUserSecretsBanner.tsx` surfaces missing secrets. What the fork lacks
compared with upstream: a provider catalogue (OpenAI, OpenRouter, xAI), a default-grant model, and a guaranteed
"no host fallback" (today `claude-local/src/server/acp.ts:700` reads the host `ANTHROPIC_API_KEY`).

## 3. Approaches

A. **Import the core, build the UI fork-side (chosen).** Port the server/shared/db core of #13247 plus the
   self-contained adapter fixes. Skip intents, native runtime and #13248's UI. Build the onboarding step (sub-project 2)
   on the ported `/ai-connections` API. Delivers upstream's credential model and the "no host fallback" guarantee.
B. **Port the full #13247/#13248 chain with its prerequisites** (connection wizard #10910, intents, native runtime, new-agent UI).
   Closest to upstream, but pulls tens of thousands of lines of unrelated features and breaks the "minimum files" rule.
C. **Skip Connections; extend the fork's existing per-user bindings** (`user_secret_ref` for `ANTHROPIC_API_KEY` and
   `CLAUDE_CODE_OAUTH_TOKEN`, see 2.4) and setup-token flows with more providers. Least import; the fork owns
   provider handling. Chosen if the owner's PR-P2 gate or the stop rule (4.2) says so.

**PR-P2 gate (before PR 4 starts).** The owner confirms A over C with the evidence in 2.4. If the owner picks C:
PR 4 is dropped, PR 5 is re-scoped onto `user_secret_ref` bindings (acceptance: a Hermes agent runs through
OpenRouter on a `user_secret_ref` key, #124; the egress guard applies to any request carrying a user-supplied
provider base URL), and the stop rule no longer applies. PRs 1-3 are unaffected either way.

## 4. Design (approach A)

### 4.0 Glossary
- **Connection:** a provider capability (Claude, OpenAI, OpenRouter, xAI), defined by an app definition.
- **Grant:** a stored credential plus the permission to use it. The key itself lives in `secrets.ts`; the grant holds a reference.
- **Adopt / unadopt:** bind an agent to a grant, or remove that binding. Unadopting restores the agent's legacy bindings.
- **Payer:** the grant whose key paid for a run (`cost_events.paid_by_grant_id`).

### 4.1 PR series
Each PR branches from `origin/develop`, carries one theme, and cites provenance as
`Adapted from paperclipai/paperclip@<sha>:<path>`. Tests that pin current behaviour land before the changes
they protect. PR 1 lands first; PRs 2 and 3 then proceed in parallel; PR 2 is a hard prerequisite of PR 4
(its quota classification feeds 4.5); PR 5 follows PR 4.

- ~~`fix/http-adapter-boundary-hardening`~~ (`9dd6526b47`): **skipped for now** (owner decision). Risk in 4.6.
  Per `CLAUDE.md` a human performs the cherry-pick when it is revisited.

**PR 1 `feature/adapter-test-lanes`.** Theme: adapter test coverage and the two http stopgaps those tests cover.
The title names the user-visible http change.
- Add `adapter-hermes-gateway`, `hermes` and other fork packages to the `vitest.config.ts` projects so they run in
  the existing `general-workspaces-b` group (`t3-ci.yml:100`). No workflow change.
- Characterization tests for `server/src/adapters/process` (0 today) and `http` (1 today).
- `http` stopgaps until the hardening lands:
  - hidden from the production selectable list (`builtin-adapter-types.ts`);
  - rejected in authenticated deployment mode at agent create, config PATCH, company-portability import and run
    start, with `adapter_disabled_authenticated_mode`. It still works in `local_trusted` mode; the PR body and
    release notes say so.
- http timeout contract (`index.ts:19` documents `timeoutSec`, `execute.ts:10` reads `timeoutMs` with default 0):
  accept `timeoutSec`; `timeoutMs` wins when both are set; default 30 s; a new write with 0 is rejected; a
  stored legacy 0 is read as the 30 s default with a logged warning. The run summary redacts the URL query string.

| Files | Tests | Verify locally | Merge gates |
|---|---|---|---|
| `vitest.config.ts`, `server/src/adapters/{http,process}/*`, `builtin-adapter-types.ts`, agent create/PATCH/import validation | process characterization; http timeout (sec, ms, both, new 0 rejected, legacy 0); auth-mode rejection on all four paths; query redaction | `pnpm test:run:general --group general-workspaces-b`; `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` then `npx vitest run` on the new server test files | t3-ci green; 11-step flow unchanged (manual, recorded) |

**PR 2 `feature/claude-local-upstream-fixes`.** `cc549691a1`, `082423000e`, `1ead554bd1`, `dffc2b3ca1`, `3b4b270650`,
quota classification (`f447990d77`, `d54b750111`, `300a89ec13`), acpx stall handling (`938a441944`, `4b766b8729`,
`3935e300dd`), model refreshes (`cab4263dc9`, `dfdfc8664e`, `5128b4f323`), with matching upstream tests. Keep #165.
Diff `adapter-utils` at the fork point against upstream before taking the acpx fixes.

| Files | Tests | Verify locally | Merge gates |
|---|---|---|---|
| `packages/adapters/claude-local/*`, `packages/adapter-utils/*` | ported upstream tests (unmodified, or edit + reason in manifest) | `npx vitest run --project @paperclipai/adapter-claude-local` from the repository root (the package has no `test` script); workspace group b | t3-ci green; one Windows run on this branch (#129), log in PR body; 11-step flow unchanged on a Claude Code agent |

**PR 3 `feature/hermes-upstream-fixes`.** `abbd88007f`, `ed0c6958f8`, `2145925f71`, `4b8ec588f3`; keep `hermes-home.ts`.

| Files | Tests | Verify locally | Merge gates |
|---|---|---|---|
| `packages/adapters/hermes*` | ported upstream tests; `hermes-home.test.ts` still passes | workspace group b | t3-ci green; 11-step flow unchanged on a Hermes agent |

**PR 4 `feature/ai-connections-foundation`.** The portable core from 2.3, all listed files, behind the instance
flag (4.5), off by default until sub-project 2 ships the UI. Migration regenerated with `pnpm db:generate` as the
next fork number. It is additive and backward-compatible with the previous release (`CLAUDE.md` "Database
migrations"). Existing agents are untouched until they adopt. Must meet 4.3, 4.4 and 4.5. Ships the operator doc
`technical-spec/fork/ai-connections-operator.md` (flag, grants, adopt/unadopt, rotate, revoke, offboarding, error
table, allowlist, copy-paste request/response examples). `paperclipai doctor` reports the flag state.

| Files | Tests | Verify locally | Merge gates |
|---|---|---|---|
| 2.3 core list, `cost_events.ts`, resolver extension, adopt/unadopt route, child env builder, operator doc, `packages/shared` error constants | all of 4.3 "Tests"; ported `ai-connections.test.ts` and `ai-legacy-compatibility.test.ts` | server suites per 4.2; workspace group b | hello world (4.3) timed in the PR body; flag-off identity; one Windows run on this branch; a human redeploys the previous tag against the migrated schema through t3-release/t3-nightly; owner confirms the D7 matrix values |

**PR 5 `feature/custom-model-providers`.** Upstream #14970 (`9f7057e122`), in scope (owner decision), after PR 4.
Relevant to #124 (Hermes needing OpenRouter). Takes only self-contained hunks. Must include the egress guard (4.4),
because a user-supplied base URL otherwise forwards a stored key to any host.

| Files | Tests | Verify locally | Merge gates |
|---|---|---|---|
| provider config, egress guard module, validation-on-save | every egress case in 4.4; validation-on-save through the guard; save rate limit | server suites per 4.2 | flag on: a Hermes agent runs through OpenRouter on a user key (#124) |

Every PR body has fields for: manifest entries added, new npm dependencies with `pnpm audit` output, Windows run
evidence (where required) and the manual 11-step result.

### 4.2 Constraints
- Every adapter commit is checked for imports from Runner, Connections-intents, identities or observability; if
  present, only the self-contained hunk is taken.
- Server changes need `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` then the relevant
  `npx vitest run server/src/__tests__/<file>.test.ts` locally, because t3-ci runs no server tests.
- No changes to `.github/workflows/` or `deploy/` in these PRs.
- **Throwaway port (first task of PR 4).** Produce a step-0 report with: files needed beyond 2.3, new
  dependencies, how upstream's `ai-connection-runtime.ts` and the `heartbeat.ts` +55 hunk are adapted into the
  fork's `resolveAdapterConfigForRuntime`, whether `local-ai-login.ts` / `local-ai-credentials.ts` need upstream's
  general device-login service (compared against the fork's `codex-device-login-service.ts`), whether a
  company-membership removal path exists (none found by a grep for removeMember/deleteMembership), and the stop-rule result.
- **Stop rule.** Stop and ask the owner before continuing if the port needs any file from connection intents,
  native runtime or upstream's general device login; more than 10 files beyond 2.3; more than 2 new npm
  dependencies; any change to `claimQueuedRun`; or if the upstream runtime cannot be adapted into the fork's
  resolver. Hitting the rule is the trigger for reconsidering approach C.

### 4.3 Testing and acceptance

**Per-PR acceptance**, measured against the owner's 11-step user-flow test (see the tables in 4.1). Until
t3-nightly is green, which needs the kmv8 artifact secrets (TODOS.md, P1, human) and the slow-tests fix, nightly
cannot back an acceptance claim. Each PR records a manual 11-step result in its body instead, and nightly green is
post-merge verification.

**Hello world (PR 4 merge gate, at most 5 commands, timed in the PR body).** The PR names the exact commands:
1. enable `aiConnections` through the existing instance-settings route or CLI (never a DB edit);
2. create a grant with a test key;
3. adopt it on an agent through the adopt route;
4. trigger a wakeup;
5. read the run and see `paid_by_grant_id` set to that grant.

**Error contract.** One table, mirrored by constants in `packages/shared`. HTTP route errors are UPPER_SNAKE; run
error codes are lower_snake. Every message gives the problem, the cause and the fix, never a secret value, and
links an anchor in the operator doc.

| Code | Problem | Likely cause | Fix (user action) |
|---|---|---|---|
| `ai_credential_missing` | adopted agent has no usable grant | grant deleted or never created | add a key for the provider named in the message |
| `ai_connections_disabled` | AI connections are disabled on this instance | flag off | ask an instance admin to enable it; while off, adopted agents are not woken (no failed run per interval) |
| `ai_credential_owner_removed` | grant owner is no longer a member of the company | member removed | ask a board admin to re-assign the agent or adopt another grant |
| `ai_credential_rejected` | provider rejected the key | key invalid or revoked | replace the key; invalid keys are also refused at save |
| `ai_rate_limited` | provider rate limit | too many requests on this grant | none needed; the run shows the retry time; the wakeup API wakes the agent early |
| `ai_quota_exhausted` | hard quota reached | provider quota | agent paused with the provider's reason; raise the quota |
| `ai_credit_exhausted` | OpenRouter out of credit (#124) | balance empty | agent paused; top up credits |
| `AI_CONNECTION_CREDENTIAL_CONFLICT` (409) | adopt or write conflicts with an env key binding | agent still has e.g. an `ANTHROPIC_API_KEY` binding | message names the env key name and where it is bound; remove it, then adopt |
| `adapter_disabled_authenticated_mode` | http adapter not allowed here | authenticated deployment mode | use another adapter; message names the reason and the 4.6 revisit date |

**Tests (PR 4 unless noted).**
- Regression (critical): an unadopted agent, and any agent on a flag-off instance, behaves exactly as today.
- Flag on to off: adopted agents get `ai_connections_disabled`, never a host key, and no failed-run storm.
- Resolution: adopted agent with a valid grant gets env from the grant only. Grant missing →
  `ai_credential_missing`. Owner left the company → `ai_credential_owner_removed`. Revoke during session resume →
  the resume re-resolves and fails. A legacy row holding both an env key binding and a managed connection
  resolves only the managed credential and logs the conflict.
- No ambient fallback: with a host `ANTHROPIC_API_KEY` set and the grant revoked, the run fails and does not use
  the host key; a host credentials file (`~/.claude`, `~/.hermes`) is not read; both on Linux and on Windows.
- Isolation: agent B's run cannot read agent A's key from env or files.
- Session resume: two runs of one adopted agent, where the second passes the saved session id to `--resume`,
  continue the conversation; afterwards the per-run directory is gone and the canary key is absent from the
  agent's session store. Run on Linux and on Windows.
- Lifecycle: invalid key refused at save; rotate (the new secret version is used from the next run); revoke
  (effective next run, running runs finish); offboarding per 4.4.
- Authorization: extend the table in `server/src/__tests__/agent-cross-tenant-authz-routes.test.ts` with every
  cell of the 4.4 matrix, cross-company denial, agent actor adopt/PATCH/hire, and a responsible-user change.
- Conflict: 409 in both directions (env key then adopt; adopt then env key write).
- Rate limit: 10 agents on one grant share one backoff and honour `Retry-After`.
- Redaction canary: a canary key is absent from the run transcript, the activity log, adapter error text,
  `/api/health`, `heartbeat_runs` context/config snapshot columns, stdout/stderr excerpts, server logs and
  session-resume state.
- Cost: `paid_by_grant_id` set on adopted runs; deleting the grant sets it NULL and the label snapshot remains.
- Egress (PR 5): every case listed in 4.4, with a stub DNS resolver (never live DNS).
- Manual: a Claude Code run on a non-Windows host (#123); Hermes Gateway end to end (#122), including a canary
  check of the gateway's logs.

### 4.4 Security requirements
- **Egress guard (PR 5; reused when the http hardening is revisited).** Applies to every server-side request
  carrying a stored key: validation-on-save and any provider request made by the server.
  - https only; `redirect: "manual"`, with each hop re-checked.
  - The validated IP is pinned into the connection (an undici Agent whose connect-time lookup re-checks the address).
  - Blocked: loopback, RFC1918, `100.64.0.0/10` (tailnet, including kmv8's `100.103.41.112`), link-local,
    `0.0.0.0/8`, `169.254.169.254`, IPv6 `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped IPv6, NAT64, and decimal,
    octal or hex IP literals.
  - A key is sent only to the host it was saved for.
  - Instance allowlist: the key and format are documented in the operator doc, with a localhost example for
    development. Adding a private host requires an instance admin and writes an activity-log event. The
    configured hermes-gateway host is an allowlist entry.
  - Subprocess adapters (Claude Code, Hermes) call the provider themselves, so the server cannot see those
    requests. Their provider base URL is validated, and its resolved IP checked, at config write and again at run
    start. A DNS rebind inside the subprocess after that check is a residual risk (4.6).
  - After PR 5, validation-on-save for a custom provider goes through the guard, and save attempts are rate-limited per user.
- **Child environment (PR 4).** For adopted agents the child process env is built from an allowlist, not
  inherited. Provider-key variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `XAI_API_KEY`,
  `CLAUDE_CODE_OAUTH_TOKEN`, the Bedrock and Vertex variables) are stripped unless they come from the grant.
  `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `XDG_CONFIG_HOME` point at a per-run directory, extending the
  existing `CLAUDE_CONFIG_DIR` remap (`acp.test.ts:555`). The per-run directory holds credentials and is deleted
  when the run ends. Session history is kept apart from it, so `--resume` still works:
  - Each agent has a persistent session store under its existing agent workspace. It holds only the adapter's
    session files (for Claude Code, the transcript and session state that `--resume` reads) and never a key, a
    token or a credentials file.
  - At run start the adapter mounts that store into the per-run config directory (a link, or a copy-in and
    copy-out where links are not available, such as some Windows setups). Credential files are written only to
    the per-run directory.
  - At run end the adapter copies session files back to the store and deletes the per-run directory. Files that
    match credential names (for example `.credentials.json`) are never copied back.
  - A revoke does not delete the session store. The next resume re-resolves the credential and fails if the grant
    is revoked (4.3).
  Scope: locally spawned adapters that receive a managed credential (claude-local, hermes_local). hermes-gateway
  receives the credential per request; it must not persist it, and the transport relies on the tailnet's WireGuard
  encryption. `process` and `http` receive no managed credential. codex-local is out of this series.
- **Credential lifecycle (PR 4).** Keys are stored only as secret references through `secrets.ts`
  (`local_encrypted`), never as raw values in grant JSON. Keys are validated at save, calling only the hard-coded
  hosts of the three app definitions until PR 5. Rotating creates a new secret version that is used from the next
  run. Revoking takes effect at the next run or resume; runs already started finish. Offboarding: if step 0 finds a
  company-membership removal path, it revokes the user's grants (secret version disabled, grant removed; hard
  delete follows the secrets retention rule). If not, revoke-on-removal is deferred (4.7) and adding a new path needs
  owner sign-off. Independently, every run start checks that the grant owner is still a member
  (`ai_credential_owner_removed`). Rotating `secrets/master.key` is an ops TODO.
- **Binding writes (PR 4).** A managed binding can be written only through the adopt route, which rejects agent
  actors. Agent config PATCH and company-portability import strip or reject managed bindings. A hired child agent
  never inherits its parent's grant. Changing an agent's responsible user unadopts it, unless the new user owns
  the grant or has explicitly permitted it.
- **Authorization matrix (PR 4).** The cell values are a proposal: check them against upstream's grant semantics
  during the port; the owner confirms them before PR 4 merges.

| Actor | Create grant | Use grant on own agent | Use another user's grant | Adopt / unadopt on agent | Revoke |
|---|---|---|---|---|---|
| Key owner | yes | yes | n/a | yes, for agents they are responsible for | yes |
| Board admin (same company) | no | no | only if explicitly permitted | yes | yes |
| Other member (same company) | no | no | only if explicitly permitted | no | no |
| Agent | no | only its responsible user's default or a permitted grant | no | no | no |
| Anyone in another company | no | no | no | no | no |

### 4.5 Runtime behaviour
- **Flag.** `instance_settings.experimental.aiConnections` (DB, read per run and at adoption, no restart),
  default off, toggled by an instance admin through the existing instance-settings route or CLI.
- **One resolution point.** Storage is `secrets.ts` for both the existing bindings and managed grants. The single
  run-time resolver is the existing `secretsSvc.resolveAdapterConfigForRuntime` call in `heartbeat.ts:1095`
  (outside `claimQueuedRun`, whose denying gates cancel runs). PR 4 extends it with a managed-connection binding
  rather than adding a second resolver. One resolution call per run reads both sources, checks the flag, the grant,
  owner membership and the grant's rate-limit state, with no cache, so a revoke is immediate. Resolve time is logged.
- **Relation to existing bindings.** Agents that have not adopted keep today's bindings unchanged. An adopted
  agent uses only its managed credential. Conflicting env key bindings are rejected with
  `AI_CONNECTION_CREDENTIAL_CONFLICT`, mirroring the existing `CLAUDE_OAUTH_CREDENTIAL_CONFLICT` pattern.
- **Cost attribution.** `cost_events.paid_by_grant_id` (nullable, `ON DELETE SET NULL`) plus a grant-label
  snapshot column, added in PR 4's additive migration. Budgets keep counting all spend as today.
- **Rate limits.** Applies only to adopted agents. A transient 429 defers wakes for every agent on that grant,
  with exponential backoff and jitter capped at 30 minutes, honouring `Retry-After`. State lives on the grant
  (`ai_rate_limit_until`, `ai_rate_limit_attempts`). The existing wakeup API is the documented "wake now" path. A
  hard quota or credit stop pauses the agent with a visible reason; PR 2's quota classification tells the cases apart.
- **Observability.** For adopted agents only: activity-log events for credential resolution failure, provider
  auth error, quota stop, adopt/unadopt, and allowlist changes, with provider and error code, never the key.

### 4.6 Risk register
| Risk | Decision | Interim control | Owner | Revisit by |
|---|---|---|---|---|
| http adapter makes unrestricted server-side requests (`server/src/adapters/http/execute.ts:19`): no host check, redirects followed, no default timeout | Upstream fix `9dd6526b47` skipped for now (owner, 2026-10-23) | PR 1: hidden from the production list, rejected in authenticated mode, 30 s default timeout | owner | before PR 5 merges, or 2026-12-31, whichever is first |
| DNS rebind inside a subprocess adapter after run-start pinning sends a key to a private host | Accepted residual (autoplan, 2026-10-23) | URL validated and IP checked at config write and run start | owner | follow-up TODO "Server-side provider proxy for subprocess adapter egress" |

### 4.7 Deferred
In TODOS.md:
- per-credential usage view (sub-project 2);
- auto-migrating existing Claude `user_secret_ref` bindings to managed connections (today adoption is rejected
  until the binding is removed);
- per-credential spend view;
- per-payer budget policy (known UX issue: budgets count user-paid spend and can auto-pause an agent spending its owner's own money);
- `master.key` rotation runbook;
- server-side provider proxy.

Also deferred:
- revoke-on-removal, if no membership hook exists;
- the end-user how-to (sub-project 2);
- a configurable backoff cap.

### 4.8 Steady state
`technical-spec/fork/upstream-imports.md` records every import (schema in that file), including schema
divergence and the upstream migration ids each fork migration replaces. Monthly, the repo owner re-diffs the five
adapters and the ported AI-connections files against upstream and triages new commits through the manifest. Once
the fork's diff against an upstream file exceeds 300 lines, the fork stops following that file and records it.

## 5. Decision index
Owner (2026-10-23): onboarding UI fork-built on the ported API; http fix skipped for now; #14970 in scope (PR 5);
/autoplan result approved as-is (approach A, PR-P2 gate before PR 4).

/plan-eng-review D1-D17: egress guard in PR 5 (D1); original PR 4 arrangement (D2); http risk recorded and
stopgapped (D3); per-run isolation (D4); credential lifecycle (D5); redaction canary (D6); authorization matrix
(D7); flag off by default (D8); per-PR acceptance, error codes, Windows gate (D9); run-start resolution (D10);
payer recorded (D11); 429 backoff (D12); test lanes first (D13); stop rule (D14); manifest and dependency
listing (D15); http timeout fix (D16); credential events (D17).

/autoplan (CEO, DX, Eng): E1 one resolver and the conflict rule; 2.4 and the PR-P2 gate; glossary; hello world;
error contract; operator doc; child env allowlist; hardened egress guard with subprocess residual risk; binding
write rules; per-grant backoff; flag-off wake skip; legacy timeout handling; redaction scope; payer column
details; steady-state policy. Taste defaults kept: managed connection wins over env keys; subprocess egress
pinned rather than proxied; conflict message names the env key; 30-minute fixed backoff cap. Review records live
in `~/.gstack/projects/tetracilin-test_ai_todo/` (active plan, CEO plan, test plan).
