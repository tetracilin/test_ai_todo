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

Use this adapter for one deterministic \`nlm\` command per run: notebook and
source management, queries, research, or artifact generation. It has no
conversational session resume and does not accept Google credentials.

Required runtime settings:
- \`command\`: \`nlm\` or an in-runtime absolute executable path.
- \`profile\`: one existing \`nlm\` profile name, default \`default\`.
- \`cookieStorePath\`: optional absolute runtime path mapped to
  \`NOTEBOOKLM_MCP_CLI_PATH\`; never inspect or paste store contents.
- \`subcommand\` and newline-delimited \`args\`: allowlisted \`nlm\` argv.
- \`cwd\`, \`timeoutSec\`, \`graceSec\`: optional execution limits.

Authentication is out-of-band only. If Test reports invalid authentication,
an operator must run \`nlm login --profile <profile>\` in the same runtime and
then rerun Test. This adapter never starts a browser or automatic Google login.

Do not use for arbitrary shell execution, credential storage, or a shared
profile whose access should not be available to this agent.
`;
