import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";

// SCAFFOLD ONLY (NLM-A03): real config fields (command, profile,
// cookieStorePath, subcommand/args, cwd, timeoutSec, graceSec, output caps)
// are implemented in NLM-A04 per the canonical plan's "Config fields" list.
// Empty schema for now — no Google credential fields, ever.
export function getConfigSchema(): AdapterConfigSchema {
  return { fields: [] };
}
