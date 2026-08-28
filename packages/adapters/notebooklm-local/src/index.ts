// Shared root metadata for the notebooklm_local adapter. Kept dependency-free
// per docs/adapters/creating-an-adapter.md Step 1: this module is imported by
// the server, ui, and cli entry points.
//
// Scope note (NLM-A03): this is a scaffold only. No execute/parse/config-schema
// behavior lives here yet (that is NLM-A04). `models`/`modelProfiles` stay
// empty until a contract test proves a non-empty value is required, per the
// canonical plan (2026-08-28-notebooklm-adapter-action-plan-review.md).

export const type = "notebooklm_local";
export const label = "NotebookLM (local)";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# notebooklm_local agent configuration

Adapter: notebooklm_local

STATUS: scaffold only (NLM-A03). No execute/parse/config-schema behavior is
implemented yet; this doc will be filled in by NLM-A04+ once the adapter is
functional. Do not select this adapter type for a real agent yet.

Use when (planned, not yet implemented):
- You want Paperclip to invoke the \`nlm\` NotebookLM CLI for deterministic
  notebook/source/query/research operations.

Don't use when:
- You need a conversational session with resumable state (this adapter is
  built as a one-shot deterministic invocation per issue, matching the
  Phase 0 \`process\` adapter MVP evidence).
`;
