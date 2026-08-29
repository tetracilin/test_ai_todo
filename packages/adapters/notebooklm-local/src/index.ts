// Shared root metadata for the notebooklm_local adapter. Kept dependency-free
// per docs/adapters/creating-an-adapter.md Step 1: this module is imported by
// the server, ui, and cli entry points.
//
// Scope note (NLM-A03): this is a scaffold only. No execute/parse/config-schema
// behavior lives here yet (that is NLM-A04). `models`/`modelProfiles` stay
// empty until a contract test proves a non-empty value is required, per the
// canonical plan (2026-08-28-notebooklm-adapter-action-plan-review.md).

export const type = "notebooklm_local";
export const label = "NotebookLM";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# NotebookLM agent configuration

Status: isolated trial only. Do not configure for CEO lane, general-purpose
autonomy, or production without separate approved rollout gate.

Use this adapter for one deterministic \`nlm\` command per run: notebook/source
management, queries, research, or artifact generation. It has no ACP transport,
conversational session resume, session codec, or automatic Google login.

Runtime topology:
- Image binary: \`/usr/local/bin/nlm\` (baked into image; never install under
  ephemeral \`/app\`).
- Host profile store: \`/root/paperclip-data/notebooklm\` (human maintenance
  only; never use this host path in container agent config).
- Container profile store: \`/paperclip/notebooklm\` (set as
  \`cookieStorePath\`; injected as \`NOTEBOOKLM_MCP_CLI_PATH\`).
- Profile data is sensitive even though path itself is plain config: never read,
  display, paste, export, or log its contents. The adapter is non-portable by
  default; exports omit its host-local profile-store mapping.

Required runtime settings:
- \`command\`: \`/usr/local/bin/nlm\` or another verified in-runtime absolute
  executable path.
- \`profile\`: one existing \`nlm\` profile name, default \`default\`.
- \`cookieStorePath\`: \`/paperclip/notebooklm\`, mapped to
  \`NOTEBOOKLM_MCP_CLI_PATH\`; never inspect or paste store contents.
- \`subcommand\` and newline-delimited \`args\`: allowlisted \`nlm\` argv.
- \`cwd\`, \`timeoutSec\`, \`graceSec\`: explicit bounded execution limits.

Authentication is human out-of-band only. Authorized human runs
\`nlm login --profile <profile>\` in same runtime with
\`NOTEBOOKLM_MCP_CLI_PATH=/paperclip/notebooklm\`, then runs
\`nlm login --check --profile <profile>\`. Record pass/fail only; never raw
output or account identity. Run environment Test after configuration and after
any image, profile-path, or auth change. Invalid auth blocks for human action;
this adapter never starts browser or automatic Google login.

Use isolated trial agent and bounded, read-only smoke issues first:
\`notebook list --json\` and \`login --check\`. Confirm bounded/redacted result,
no profile data, and no circuit-breaker trip before any further trial work.

Do not use for arbitrary shell execution, credential storage, cookie export, or
shared profile whose access should not be available to this agent. On command
missing/wrong-binary error verify \`/usr/local/bin/nlm\`; on profile-store error
verify bind mount/permissions without reading files; on auth error require
human re-authentication. Treat unexpected Google API behavior as protocol drift:
stop automation and retain redacted diagnostics only.
`;
