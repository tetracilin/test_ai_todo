import os from "node:os";
import path from "node:path";

function envMap(config: Record<string, unknown>): Record<string, unknown> {
  const env = config.env;
  return typeof env === "object" && env !== null && !Array.isArray(env)
    ? (env as Record<string, unknown>)
    : {};
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Directory the Hermes CLI uses for config.yaml, .env, skills/ and state.db.
 *
 * Order: config.env.HERMES_HOME, then config.env.HOME/.hermes, then the server's
 * HERMES_HOME, then the server user's ~/.hermes. The CLI child receives config.env,
 * so this matches the directory the CLI itself will use.
 */
export function resolveHermesHomeDir(config: Record<string, unknown>): string {
  const env = envMap(config);
  const configured = nonEmpty(env.HERMES_HOME);
  if (configured) return path.resolve(configured);
  const home = nonEmpty(env.HOME);
  if (home) return path.join(path.resolve(home), ".hermes");
  const processHome = nonEmpty(process.env.HERMES_HOME);
  if (processHome) return path.resolve(processHome);
  return path.join(os.homedir(), ".hermes");
}
