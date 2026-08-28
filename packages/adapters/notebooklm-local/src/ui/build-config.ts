import type { CreateConfigValues } from "@paperclipai/adapter-utils";

// SCAFFOLD ONLY (NLM-A03): no real config fields yet (command, profile,
// cookieStorePath, subcommand/args, cwd, timeoutSec, graceSec, output caps —
// see NLM-A04). Returns an empty adapterConfig object so wiring compiles;
// the UI form itself is not registered until NLM-A07.
export function buildNotebookLmLocalConfig(_v: CreateConfigValues): Record<string, unknown> {
  return {};
}
