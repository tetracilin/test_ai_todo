# NotebookLM Adapter — Action Plan

Status: proposed
Owner: TBD (Hermes-connected agent, board-assigned)
Related: `doc/NOTEBOOKLM_ONBOARDING.md` (host-level `nlm` CLI auth, already working)

## 1. Problem framing

We want a Paperclip agent that can drive Google NotebookLM (via the `nlm`
CLI, https://github.com/jacob-bd/gemini-notebook-mcp-cli) as part of a
company's work — creating notebooks, adding sources, generating audio
overviews/reports, running research.

The original ask was "use the `gemini_local` adapter as a template." Code
research (see decision log below) found that's the wrong model: `nlm` is a
deterministic, one-shot CLI (`nlm notebook list`, `nlm source add --url`,
`nlm audio create --confirm`) with no autonomous multi-turn loop. `gemini_local`
exists to drive an *autonomous coding-agent* CLI (ACP protocol, session
resume, skills injection — 759 lines of machinery for exactly that). Copying
it would import a large amount of irrelevant complexity.

### Decision log

- Paperclip already ships a **built-in `process` adapter**
  (`server/src/adapters/process/`, ~100 lines total across
  `index.ts`+`execute.ts`): spawn `config.command` with `config.args`/`env`/
  `cwd`, capture stdout/stderr, return exit code as `resultJson`. No ACP, no
  session codec, no skills symlinking. This is structurally almost exactly
  what wrapping `nlm` needs.
- `grok-local` (`packages/adapters/grok-local`) is a CLI-spawn adapter
  *without* the ACP branch gemini-local has (588 vs 759 lines in
  `execute.ts`) — the better reference if/when we build a dedicated package,
  but even it should be trimmed down, not copied whole.
- New adapter types need **no DB migration** — `agents.adapterType` is a
  free-text column, `adapterConfig` is untyped `jsonb`
  (`packages/db/src/schema/agents.ts:26-27`). This is purely
  application-layer registration.
- A new built-in adapter type touches three parallel registries
  (`server/src/adapters/registry.ts`, `ui/src/adapters/registry.ts` +
  `adapter-display-registry.ts`, `cli/src/adapters/registry.ts`) plus
  `builtin-adapter-types.ts`, `packages/shared/src/constants.ts`,
  `packages/shared/src/environment-support.ts`, and several
  `server/src/services/*.ts` allowlists (`built-in-agents.ts`,
  `company-portability.ts`, `heartbeat.ts`, `recovery/service.ts`). There is
  also an **external plugin path** (`server/src/adapters/plugin-loader.ts` +
  `adapter-plugin-store.ts`) that avoids touching core files entirely, at
  the cost of not being a first-class built-in — worth considering for a v0
  iteration loop, but no live example currently exists in this checkout to
  copy from, so the built-in-package path (matching `gemini-local`/
  `grok-local` precedent) is lower-risk.
- The one genuinely new problem `nlm` introduces vs. every existing adapter:
  auth is not an API-key env var (`GEMINI_API_KEY`-style) — it's a
  filesystem cookie/profile store (`NOTEBOOKLM_MCP_CLI_PATH`, already
  working at `/root/paperclip-data/notebooklm` = `/paperclip/notebooklm` in
  the app container per `doc/NOTEBOOKLM_ONBOARDING.md`) plus a one-time,
  human-in-the-loop Google OAuth step (browser/VNC) that cannot be
  automated — this is closer to how Gemini CLI's own `~/.gemini/
  oauth_creds.json` local-login path works than to a secret-ref env
  binding. Treat the profile-store path as a plain config field, not a
  `secret_ref`/`user_secret_ref` binding (the file's *contents* are
  sensitive; the *path* is not).

## 2. Phased plan

### Phase 0 — MVP, zero new code (fastest path to value)

Prove the concept using the existing `process` adapter before investing in
a dedicated package.

1. Create a Paperclip agent with `adapterType: "process"`,
   `adapterConfig: { command: "/root/.local/bin/nlm", args: [...],
   env: { NOTEBOOKLM_MCP_CLI_PATH: "/paperclip/notebooklm" }, cwd: "..." }`.
2. Confirm the container image actually has `nlm` on `PATH` (as of
   2026-08-28 the running `paperclip` container does **not** have `nlm`
   installed — see open question in §4). Either install it into the image/
   Dockerfile, or point `command` at a host-reachable path if execution
   happens outside the container.
3. Smoke test: one issue that runs `nlm notebook list` and one that runs
   `nlm login --check`, confirm `resultJson.stdout` round-trips correctly.
4. Write up findings — this tells us whether a dedicated adapter package is
   worth building at all, or whether `process` + good agent-config docs is
   sufficient long-term.

### Phase 1 — Dedicated `notebooklm_local` adapter package (if Phase 0 shows it's worth it)

Scaffold `packages/adapters/notebooklm-local`, modeled on `grok-local`'s
*non-ACP* shape, trimmed toward `process`'s simplicity:

```
packages/adapters/notebooklm-local/
  package.json                 (copy grok-local's, rename)
  src/
    index.ts                   (type="notebooklm_local", label, agentConfigurationDoc)
    server/
      index.ts                 (ServerAdapterModule: execute, testEnvironment, getConfigSchema)
      execute.ts                (spawn nlm, build args per sub-command, capture+parse output)
      parse.ts                  (nlm output → resultJson/summary; nlm has --json on most commands — prefer that over regex scraping)
      config-schema.ts          (fields: command default "nlm", cookieStorePath, subcommand/args, profile, timeoutSec)
    ui/
      build-config.ts           (form values → adapterConfig)
      index.ts
    cli/
      format-event.ts           (stdout line → CLI transcript formatting)
      index.ts
```

Key implementation notes:
- `execute()`: no ACP branch, no session codec (each `nlm` call is
  independent — no conversational resume concept applies). Use `--json`
  output where `nlm` subcommands support it (confirm via `nlm --help` /
  `nlm <cmd> --help` per-command) and parse into `resultJson`; fall back to
  raw stdout otherwise.
- `testEnvironment()`: run `nlm login --check --profile <profile>`,
  classify `✓ Authentication valid!` vs. `✗ Authentication failed` vs.
  command-not-found, return a structured `AdapterEnvironmentTestResult`.
  This gives the UI a real "is this agent's NotebookLM login working"
  signal instead of failing silently on first real use.
- `getConfigSchema()`: expose `command` (default `nlm`), `profile` (default
  `default`), `cookieStorePath`/`NOTEBOOKLM_MCP_CLI_PATH` override,
  `timeoutSec`. Do **not** expose Google credentials through this schema —
  auth is out-of-band (see §3).
- No skills-symlinking, no headless-browser env forcing (`nlm` already
  handles its own browser lifecycle at login time, not at query time —
  post-login `nlm` calls don't touch a browser at all).
- `models`/`modelProfiles`: likely empty/not applicable — `nlm` isn't
  model-selectable the way LLM CLIs are. Confirm no adapter-contract field
  is hard-required to be non-empty.

### Phase 2 — Registration

Touch, in this order (server → shared → ui → cli), each confirmed by the
research pass:

1. `server/src/adapters/registry.ts` — import + register
   `notebooklmLocalAdapter`.
2. `server/src/adapters/builtin-adapter-types.ts` — add
   `"notebooklm_local"` to `BUILTIN_ADAPTER_TYPES`.
3. `packages/shared/src/constants.ts` — add to the shared adapter-type
   list/labels.
4. `packages/shared/src/environment-support.ts` — decide execution-target
   support (local-only is fine for v1; remote/sandbox is a later
   enhancement, not required since `nlm` calls are cheap/fast).
5. `server/src/services/built-in-agents.ts` — add to relevant
   `allowedAdapterTypes` arrays if NotebookLM should be selectable for
   built-in agent templates.
6. `server/src/services/company-portability.ts` — add an export/import
   field-mapping entry (decide whether `notebooklm_local` should be
   portable across companies at all, given the profile-store path is
   host-local).
7. `ui/src/adapters/notebooklm-local/index.ts` + `ui/src/adapters/
   registry.ts` + `ui/src/adapters/adapter-display-registry.ts` — form,
   transcript parsing, icon/label.
8. `cli/src/adapters/registry.ts` — CLI transcript formatting.
9. `server/src/services/heartbeat.ts` /
   `server/src/services/recovery/service.ts` — only touch if NotebookLM
   agents need session-resume-aware heartbeat/retry behavior; likely a
   no-op given no session concept (confirm, don't assume).

### Phase 3 — Docs, tests, rollout

- `agentConfigurationDoc` in `src/index.ts` (shown in-product) — model
  after `gemini-local`'s: use-when/don't-use-when, core fields, auth notes
  pointing at `doc/NOTEBOOKLM_ONBOARDING.md`.
- Unit tests: `parse.test.ts` (nlm output → resultJson), `execute.test.ts`
  or equivalent (arg building, env injection, error classification) — match
  the `*.test.ts` sibling-file convention used by every other adapter.
- Update `doc/NOTEBOOKLM_ONBOARDING.md` with the new adapter-based flow
  once it exists (currently documents host-CLI-only usage).
- Smoke: repeat Phase 0's two test issues through the real adapter instead
  of raw `process`.

## 3. Auth model (carries over unchanged from current host setup)

No new auth work needed — this plan wraps the CLI, it doesn't reimplement
auth. Recap of the durable pieces already in place (see
`doc/NOTEBOOKLM_ONBOARDING.md` for full detail):

- `/usr/local/bin/chromium` no-sandbox wrapper (host-level, persists across
  `nlm` upgrades, unrelated to this adapter work).
- `NOTEBOOKLM_MCP_CLI_PATH=/root/paperclip-data/notebooklm` (host) /
  `/paperclip/notebooklm` (container) — durable per-profile credential
  store, bind-mounted.
- Adding a Google account = `/root/ops/notebooklm/vnc-login.sh
  <profile-name>` (human completes real OAuth over a temporary,
  password-protected, Tailscale-only VNC session) → `vnc-teardown.sh`.
- `default` profile already authenticated as `tetracilin@gmail.com`,
  verified via `nlm login --check`.

The adapter's `testEnvironment()` (Phase 1) is what surfaces this state to
Paperclip's UI/board instead of requiring a human to know to run
`nlm login --check` by hand.

## 4. Open questions / risks

- **`nlm` is not installed inside the `paperclip` app container today**
  (confirmed via `docker exec paperclip which nlm` → not found, no
  `NOTEBOOKLM_MCP_CLI_PATH` env set there either). Wherever adapter
  execution actually runs (in-container vs. on a trusted local/remote
  execution target — see `execution-target.ts`), `nlm` needs to be
  reachable there. Resolve this **before** Phase 0, or Phase 0's smoke test
  will just reproduce the "command not found" error. Options: bake `nlm`
  into the `paperclip` image (Dockerfile change, needs image rebuild +
  redeploy), or run NotebookLM agents on a designated trusted local
  execution target (`PAPERCLIP_TRUSTED_MCP_RUNTIME_HOST`-style) that already
  has `nlm` — i.e. this host.
- Multi-account: each `nlm` profile = one Google account. Decide whether
  one Paperclip agent = one `nlm` profile (simplest, config field maps
  1:1) or whether an agent should be able to select a profile per-call.
  Recommend 1:1 for v1.
- `company-portability.ts` question above: does it make sense to export/
  import a `notebooklm_local` agent config across companies when the
  credential store is a specific host path? Probably mark it
  non-portable (like `process`/`http` per `IMPORT_FORBIDDEN_ADAPTER_TYPES`)
  until there's a real multi-host story.
- Confirm which `nlm` subcommands actually support `--json`/`--quiet`
  output before finalizing `parse.ts` — don't assume, check `nlm --ai` or
  `nlm <cmd> --help` per command used.

## 5. Kanban breakdown (for board assignment)

Each item below is sized to be one Paperclip Issue. Suggested order =
dependency order.

1. **Resolve `nlm` container/execution-target reachability** (blocks
   everything else — see §4). Output: `nlm` runnable from wherever
   NotebookLM agents will actually execute, confirmed via a manual
   `process`-adapter smoke test.
2. **Phase 0 MVP**: stand up one `process`-adapter agent running real `nlm`
   commands end-to-end (no new code). Output: two passing smoke-test
   issues, a short written recommendation on whether Phase 1 is worth it.
3. **Scaffold `packages/adapters/notebooklm-local`** package structure
   (empty-ish files matching the layout in §2, package.json, builds/
   typechecks). No behavior yet.
4. **Implement `server/execute.ts` + `parse.ts` + `config-schema.ts`**
   (the adapter's actual logic). Output: unit tests passing, manual smoke
   test running real `nlm` calls through the new adapter.
5. **Implement `testEnvironment()`** (auth-status probe via
   `nlm login --check`).
6. **Registration**: touch all Phase 2 files, get a NotebookLM agent
   selectable and creatable through the Paperclip UI end-to-end.
7. **UI polish**: `ui/build-config.ts` fields, transcript parsing
   (`ui/parse-stdout.ts` equivalent), display registry icon/label.
8. **CLI polish**: `cli/format-event.ts` for `paperclipai` CLI transcript
   output.
9. **Docs + `agentConfigurationDoc`**: update
   `doc/NOTEBOOKLM_ONBOARDING.md`, write the in-product doc string.
10. **Company-portability + heartbeat/recovery decisions**: resolve the two
    open questions in §4, implement or explicitly no-op.

Items 3-10 depend on item 2's go/no-go recommendation; item 1 is a hard
blocker for everything.
