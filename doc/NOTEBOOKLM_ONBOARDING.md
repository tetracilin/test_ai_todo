# NotebookLM Adapter Onboarding

Status: isolated-trial only. `notebooklm_local` is a registered, selectable
Paperclip built-in after NLM-A06. It is not approved for CEO-lane or production
use. Production rollout needs a separate approved gate.

This guide supersedes old Phase-0-only wording. Architecture authority:
`/root/T3-text-repo/outputs/hermes/2026/08/2026-08-28-notebooklm-adapter-action-plan-review.md`.
Implementation runtime source: [Dockerfile](../Dockerfile).

## Runtime and profile topology

`notebooklm-mcp-cli` v0.9.14 (`nlm`) is baked into Paperclip image through
`uv tool install`. Runtime executable is `/usr/local/bin/nlm`. It is immutable
image content and contains no profile or credentials. Never install into
`/app`; `/app` is ephemeral on image replacement.

Profile data stays outside image on Paperclip bind mount:

| Location | Path | Use |
| --- | --- | --- |
| Host | `/root/paperclip-data/notebooklm` | Human-only profile maintenance |
| Container | `/paperclip/notebooklm` | `notebooklm_local.cookieStorePath` and `NOTEBOOKLM_MCP_CLI_PATH` |
| Image runtime | `/usr/local/bin/nlm` | `notebooklm_local.command` |

Container configuration must use `/paperclip/notebooklm`, never host path.
Image sets `NOTEBOOKLM_MCP_CLI_PATH=/paperclip/notebooklm`; keep
`cookieStorePath` explicit in agent configuration so target is testable.
Directories require mode `700`; credential files require mode `600`. Do not
inspect, copy, attach, print, or log profile-store contents.

## Allowed use

Use one isolated trial `notebooklm_local` agent for one bounded, allowlisted
`nlm` operation per run: notebook/source management, query, research, or
artifact generation. Use distinct existing profile when access boundaries
require it. Run environment Test before first task and after any image,
profile-path, or auth change.

Recommended trial configuration:

| Field | Value |
| --- | --- |
| `command` | `/usr/local/bin/nlm` |
| `profile` | `default` or existing isolated profile |
| `cookieStorePath` | `/paperclip/notebooklm` |
| `subcommand` | Exact allowlisted top-level `nlm` command |
| `args` | One argv item per line; use `--json` only when supported |
| `cwd` | Explicit absolute runtime directory |
| `timeoutSec` | Explicit bounded limit; default `60` |
| `graceSec` | Explicit bounded grace period; default `15` |

Adapter spawns argv arrays only. It rejects non-allowlisted subcommands,
multiline/NUL arguments, relative command paths, and malformed runtime values
before spawn or persistence. Output, JSON lists, and transcript lines are
bounded and redacted by adapter/CLI renderers.

## Do not use

- Do not use `process` as user-selectable NotebookLM workaround. It remains
  operator-only.
- Do not use NotebookLM in CEO lane, autonomous general-purpose work, or
  production until separate rollout gate approves it.
- Do not use for arbitrary shell execution, credential storage, cookie export,
  or sharing profile with agents that must not receive its NotebookLM access.
- Do not put cookies, OAuth material, Google passwords, or profile contents in
  agent config, issue text, logs, comments, evidence, or support requests.
- Do not expect ACP transport, conversational session resume, session codec,
  or automatic Google login. Each run is one deterministic command.

## Human OAuth flow

1. Authorized human opens approved out-of-band interactive session in same
   target runtime/profile store. Agents never enter credentials or operate
   browser.
2. Human runs `nlm login --profile <profile>` with target runtime's
   `NOTEBOOKLM_MCP_CLI_PATH=/paperclip/notebooklm`, completes Google OAuth, and
   closes interactive session.
3. Human or operator runs `nlm login --check --profile <profile>` in same
   runtime. Record only pass/fail, not account identity or raw output.
4. Configure isolated trial agent with that profile name and
   `cookieStorePath=/paperclip/notebooklm`, then run Paperclip environment Test.
5. Continue only when Test reports binary identity, profile-store access, and
   valid authentication. Failed test blocks for human remediation; never
   triggers automatic login.

## Smoke protocol

Use only isolated NotebookLM trial agent and non-CEO issues. Create two bounded
read-only smoke issues:

1. `notebook list --json`
2. `login --check`

For each, verify successful exit, bounded/redacted transcript, no profile or
credential data, and no circuit-breaker trip. Expected trial result reports
minimal command result state; raw profile contents and account identity are not
evidence. Do not repeat failed auth probes in loop; stop and request human
re-authentication.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `notebooklm_local_command_not_found` | Verify image contains `/usr/local/bin/nlm`; do not install under `/app`. |
| `notebooklm_local_wrong_binary` | Set `command` to `/usr/local/bin/nlm`; rerun environment Test. |
| Profile store inaccessible | Set container `cookieStorePath` to `/paperclip/notebooklm`; verify bind mount and permissions without reading files. |
| `notebooklm_local_auth_failed` or invalid auth Test | Human completes out-of-band `nlm login --profile <profile>` in same runtime, then reruns Test. |
| Timeout | Lower command scope, check bounded `timeoutSec`/`graceSec`, inspect redacted result metadata only. |
| Config rejected | Use absolute `command`, `cookieStorePath`, and `cwd`; simple profile name; one non-empty one-line argv item per arg; allowlisted subcommand. |
| Unexpected CLI/API behavior | Treat as unofficial Google API/protocol drift. Stop automation, retain only redacted diagnostics, require review. |

## Rollback

1. Disable or remove isolated trial agent and trial issues. Do not delete,
   inspect, or alter retained auth profile data.
2. Disable `notebooklm_local` registration/selection through approved deployment
   procedure, or revert deployment to prior approved image/config. Never patch
   ephemeral `/app`.
3. If image rollback is approved, deploy prior image and verify new container
   does not provide `nlm`; verify normal Hermes Gateway agents remain available.
4. Revert this document only when runtime facts are inaccurate. Keep incident
   evidence redacted and preserve exact deployment/version decision separately.

`notebooklm_local` is non-portable by default because profile-store mapping is
host-local. Export/import must not carry `cookieStorePath` or imply auth
portability. See [Hermes Gateway onboarding](HERMES_GATEWAY_ONBOARDING.md) for
normal gateway-agent configuration, not NotebookLM OAuth.