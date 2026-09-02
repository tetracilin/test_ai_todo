import type { CreateConfigValues } from "@paperclipai/adapter-utils";

const DEFAULTS = {
  command: "nlm",
  profile: "default",
  timeoutSec: 60,
  graceSec: 15,
} as const;

/** Build only safe, declarative NotebookLM runtime settings. */
export function buildNotebookLmLocalConfig(v: CreateConfigValues): Record<string, unknown> {
  const fields = v.adapterSchemaValues ?? {};
  const config: Record<string, unknown> = {
    command: typeof fields.command === "string" && fields.command.trim() ? fields.command.trim() : DEFAULTS.command,
    profile: typeof fields.profile === "string" && fields.profile.trim() ? fields.profile.trim() : DEFAULTS.profile,
    subcommand: typeof fields.subcommand === "string" ? fields.subcommand.trim() : "",
    args: typeof fields.args === "string" ? fields.args : "",
    timeoutSec: typeof fields.timeoutSec === "number" ? fields.timeoutSec : DEFAULTS.timeoutSec,
    graceSec: typeof fields.graceSec === "number" ? fields.graceSec : DEFAULTS.graceSec,
  };
  for (const key of ["cookieStorePath", "cwd"] as const) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) config[key] = value.trim();
  }
  return config;
}
