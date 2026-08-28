// NLM-A04: `nlm --json` output parsing, argv construction, and error
// classification for the notebooklm_local adapter. Kept as pure, easily
// unit-tested functions per the canonical plan's Phase 1 package tree
// (execute.ts stays orchestration-only and delegates here).
import { isAllowedNotebookLmLocalSubcommand } from "./config-schema.js";

// Bounds on captured output. runChildProcess already caps total captured
// stdout/stderr at MAX_CAPTURE_BYTES (4MiB, adapter-utils/server-utils.ts);
// these are a tighter, adapter-specific bound applied to what actually goes
// into resultJson/logs, per the plan's "bound stdout, stderr, JSON payloads,
// list counts" requirement.
export const NOTEBOOKLM_LOCAL_MAX_RAW_CHARS = 200_000;
export const NOTEBOOKLM_LOCAL_MAX_JSON_ARRAY_ITEMS = 500;
export const NOTEBOOKLM_LOCAL_TRUNCATION_MARKER =
  "\u2026[truncated by Paperclip notebooklm_local adapter]";

// Auth-failure signal strings copied verbatim from the live-captured `nlm
// --ai` guidance and `nlm login --check` behavior (NLM-C01 surface capture,
// NLM-A02 evidence). Never invent additional patterns here without a fresh
// live capture backing them.
const NOTEBOOKLM_LOCAL_AUTH_FAILURE_PATTERNS: RegExp[] = [
  /cookies have expired/i,
  /authentication may have expired/i,
  /profile not found/i,
  /authentication invalid/i,
];

export function classifyNotebookLmLocalAuthFailure(text: string): boolean {
  if (!text) return false;
  return NOTEBOOKLM_LOCAL_AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

// Spawn-time "command not found" surfaces as a rejected runChildProcess
// promise (adapter-utils/server-utils.ts child.on("error")), with this exact
// message prefix for ENOENT. Matched here so execute.ts can turn it into a
// structured AdapterExecutionResult instead of an uncaught throw.
export function isNotebookLmLocalCommandNotFoundError(err: unknown): boolean {
  return err instanceof Error && /Failed to start command/i.test(err.message);
}

export interface NotebookLmLocalBoundedText {
  text: string;
  truncated: boolean;
}

export function boundNotebookLmLocalText(
  value: string,
  maxChars: number = NOTEBOOKLM_LOCAL_MAX_RAW_CHARS,
): NotebookLmLocalBoundedText {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxChars)}\n${NOTEBOOKLM_LOCAL_TRUNCATION_MARKER}`,
    truncated: true,
  };
}

export interface NotebookLmLocalParsedStdout {
  json: unknown | null;
  jsonParseError: string | null;
  jsonTruncated: boolean;
  raw: string;
  rawTruncated: boolean;
}

// `--json` parsing only happens when the caller explicitly requested it
// (i.e. included a literal "--json" argument) — per the canonical plan,
// "uses --json only where live per-command help proves --json support" and
// this adapter cannot know per-subcommand support, so it defers to whatever
// the operator/agent configured and never guesses. Every other invocation
// returns raw stdout only, exactly like the built-in `process` adapter.
export function parseNotebookLmLocalStdout(
  stdout: string,
  options: {
    jsonRequested: boolean;
    maxRawChars?: number;
    maxArrayItems?: number;
  },
): NotebookLmLocalParsedStdout {
  const maxRawChars = options.maxRawChars ?? NOTEBOOKLM_LOCAL_MAX_RAW_CHARS;
  const maxArrayItems = options.maxArrayItems ?? NOTEBOOKLM_LOCAL_MAX_JSON_ARRAY_ITEMS;
  const bounded = boundNotebookLmLocalText(stdout, maxRawChars);

  if (!options.jsonRequested) {
    return {
      json: null,
      jsonParseError: null,
      jsonTruncated: false,
      raw: bounded.text,
      rawTruncated: bounded.truncated,
    };
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      json: null,
      jsonParseError: "notebooklm_local: --json was requested but stdout was empty",
      jsonTruncated: false,
      raw: bounded.text,
      rawTruncated: bounded.truncated,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      json: null,
      jsonParseError:
        err instanceof Error
          ? `notebooklm_local: failed to parse --json stdout as JSON: ${err.message}`
          : "notebooklm_local: failed to parse --json stdout as JSON",
      jsonTruncated: false,
      raw: bounded.text,
      rawTruncated: bounded.truncated,
    };
  }

  let jsonTruncated = false;
  let boundedJson: unknown = parsed;
  if (Array.isArray(parsed) && parsed.length > maxArrayItems) {
    boundedJson = parsed.slice(0, maxArrayItems);
    jsonTruncated = true;
  }

  return {
    json: boundedJson,
    jsonParseError: null,
    jsonTruncated,
    raw: bounded.text,
    rawTruncated: bounded.truncated,
  };
}

// The declared config-schema "args" field is a textarea (one argument per
// line) because ConfigFieldSchema has no array field type; an operator-only
// direct write (e.g. the NLM-A02 process-adapter precedent) may instead
// supply a true string[]. Accept either shape defensively.
export function resolveNotebookLmLocalArgs(rawArgs: unknown): string[] {
  if (Array.isArray(rawArgs)) {
    return rawArgs.filter((value): value is string => typeof value === "string" && value.length > 0);
  }
  if (typeof rawArgs === "string") {
    return rawArgs
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return [];
}

// Safe argv construction: only the resolved subcommand is checked against
// the allowlist (the live-captured nlm v0.9.14 CLI surface); every argv
// element is passed through to spawn() as a literal array member (never a
// shell string), so no argument-level content can be reinterpreted as a
// separate command or flag. Rejects any subcommand outside that surface
// before anything is spawned.
export function buildNotebookLmLocalArgv(input: {
  subcommand: string;
  args: string[];
  profile: string;
}): string[] {
  const subcommand = input.subcommand.trim();
  if (!subcommand) {
    throw new Error("notebooklm_local adapter missing subcommand");
  }
  if (!isAllowedNotebookLmLocalSubcommand(subcommand)) {
    throw new Error(
      `notebooklm_local adapter: subcommand "${subcommand}" is not in the allowlisted nlm v0.9.14 CLI surface (references/nlm-cli-surface-v0.9.14.md)`,
    );
  }

  const argv = [subcommand, ...input.args];
  const profile = input.profile.trim();
  const hasExplicitProfileFlag = input.args.some((arg) => arg === "--profile" || arg === "-p");
  if (profile && !hasExplicitProfileFlag) {
    argv.push("--profile", profile);
  }
  return argv;
}
