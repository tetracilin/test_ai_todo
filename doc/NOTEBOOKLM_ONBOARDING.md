# NotebookLM Adapter Onboarding (Phase 0 — operator-only)

Status: Phase 0 only. There is no `notebooklm_local` Paperclip adapter yet.
This document tracks the operator-only `process`-adapter integration approved
under card NLM-A01 (`t_8dd5eb9e`) and implemented card-by-card under the
`notebooklm-adapter-v2` kanban set. See
`/root/T3-text-repo/outputs/hermes/2026/08/2026-08-28-notebooklm-adapter-action-plan-review.md`
for the full architecture plan and rollout gates.

## What exists today

- The `nlm` CLI (`notebooklm-mcp-cli` v0.9.14, PyPI) is baked into the
  production Paperclip image (`Dockerfile`, production stage) via `uv tool
  install`, pinned to the version verified live in card NLM-C01.
  - Binary: `/usr/local/bin/nlm` (image layer, immutable, no credentials).
  - `uv`, the managed CPython 3.11 runtime, and the tool venv all live under
    `/usr/local/...` (never `/app`, which is ephemeral / rebuilt on every
    release) and are world-readable+executable so the non-root `node` runtime
    user can invoke `nlm` directly.
- Runtime auth/profile state is **not** in the image. It lives on the existing
  Paperclip bind mount:
  - Host: `/root/paperclip-data/notebooklm`
  - Container: `/paperclip/notebooklm` (via the standing
    `/root/paperclip-data -> /paperclip` bind mount)
  - The container env var `NOTEBOOKLM_MCP_CLI_PATH=/paperclip/notebooklm` is
    baked into the image `ENV` block so every `nlm` invocation inside the
    container resolves to this path automatically; do not hardcode the host
    path `/root/paperclip-data/notebooklm` in any in-container config.
  - Directories are mode `700`; credential files inside are mode `600`. One
    Paperclip agent maps to one `nlm` profile.
- Google auth for the `default` profile was completed once, out-of-band, by a
  human via a temporary Tailscale-only noVNC bridge (card NLM-C02). Hermes/an
  agent never entered or saw credentials. Auth persists across
  `docker restart -t 30 paperclip` because the profile lives on the bind
  mount, not in the container filesystem.

## K10 selectability policy (explicit decision, card NLM-A01)

Paperclip's server registry (`server/src/adapters/registry.ts`,
`listSelectableServerAdapters()`) is hard-coded to return only the
`hermes_gateway` adapter — this is the K10 Hermes-only product policy, and it
is asserted by `server/src/__tests__/adapter-registry.test.ts`
("offers Hermes Gateway as the sole built-in AI adapter") and enforced at
agent-create/update time by `assertSelectableAdapterType()` in
`server/src/routes/agents.ts`.

**This policy is unchanged and must remain unchanged for Phase 0.** The
built-in `process` adapter (`server/src/adapters/process/`) is already a
registered `BUILTIN_ADAPTER_TYPE` but is *not* in the selectable set, so it
cannot be chosen through the normal hire/create-agent UI or API paths that go
through `assertSelectableAdapterType`. That is exactly the "operator-only"
posture T3 approved: a `process`-adapter NotebookLM agent must be created
directly (DB insert or an operator-scoped path), never exposed as a pickable
option to ordinary users.

Do not add `process` or a future `notebooklm_local` type to
`listSelectableServerAdapters()` in Phase 0. `notebooklm_local` (Phase 1/2 of
the plan) may only be exposed in the UI after:

1. Phase 0 (`process`-adapter MVP, card NLM-A02) returns an explicit GO, and
2. A dedicated `notebooklm_local` adapter package exists with its own
   registration/policy tests (cards NLM-A03–A06).

## Phase 0 usage (operator-only)

Configure one isolated `process` agent per NotebookLM use case with:

- `command`: `/usr/local/bin/nlm` (verified in-runtime absolute path; do not
  rely on `PATH` resolution inside the spawned process).
- `args`: one deterministic subcommand per agent/task (e.g.
  `["notebook", "list"]` or `["login", "--check"]`) — never a shell string.
- `env.NOTEBOOKLM_MCP_CLI_PATH`: `/paperclip/notebooklm` (already the
  container default via image `ENV`, but set explicitly on the agent config
  too so the agent is self-describing and portable).
- `cwd`, `timeoutSec`, `graceSec`: set explicitly; do not rely on adapter
  defaults for a new integration.

See card NLM-A02 for the smoke-test protocol (`nlm notebook list`,
`nlm login --check`) and go/no-go acceptance.

## Non-goals for Phase 0

- No ACP transport, no conversational session codec.
- No Google credential fields in any adapter config; no automatic OAuth login.
- No DB migration.
- No production rollout, no CEO-lane usage, no broad `process` selectability.

## Rollback

- Revert the `Dockerfile` NLM-A01 hunk and redeploy the prior image; confirm
  `nlm` is absent from a fresh container (`command -v nlm` fails).
- No K10 policy code changes were made in Phase 0, so there is nothing to
  revert there.
- Removing the operator-created `process` agent and its test issues does not
  touch the auth profile on the bind mount or this image change; they are
  independent layers by design (see plan "Rollback" sections for A01/A02).
