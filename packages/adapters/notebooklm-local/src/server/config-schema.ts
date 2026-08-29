import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";

// NLM-A04: real config fields per the canonical plan's "Config fields" list
// (2026-08-28-notebooklm-adapter-action-plan-review.md). The subcommand
// allowlist is copied verbatim from the live-captured `nlm --help` top-level
// Commands list (references/nlm-cli-surface-v0.9.14.md, card NLM-C01) — this
// is the single source of truth execute.ts uses to reject anything outside
// the captured nlm v0.9.14 surface. No Google credential fields, ever.
export const NOTEBOOKLM_LOCAL_SUBCOMMANDS = [
  "login",
  "notebook",
  "label",
  "note",
  "source",
  "chats",
  "chat",
  "studio",
  "research",
  "alias",
  "config",
  "download",
  "share",
  "export",
  "skill",
  "setup",
  "doctor",
  "batch",
  "cross",
  "pipeline",
  "tag",
  "audio",
  "report",
  "quiz",
  "flashcards",
  "mindmap",
  "slides",
  "infographic",
  "video",
  "data-table",
  "create",
  "list",
  "get",
  "delete",
  "add",
  "rename",
  "status",
  "describe",
  "query",
  "sync",
  "content",
  "stale",
  "configure",
  "set",
  "show",
  "install",
  "uninstall",
  "update",
] as const;

export type NotebookLmLocalSubcommand = (typeof NOTEBOOKLM_LOCAL_SUBCOMMANDS)[number];

const NOTEBOOKLM_LOCAL_SUBCOMMAND_SET: ReadonlySet<string> = new Set(NOTEBOOKLM_LOCAL_SUBCOMMANDS);

export function isAllowedNotebookLmLocalSubcommand(value: string): value is NotebookLmLocalSubcommand {
  return NOTEBOOKLM_LOCAL_SUBCOMMAND_SET.has(value);
}

export interface NotebookLmLocalConfigValidationIssue {
  key: "command" | "profile" | "cookieStorePath" | "cwd" | "timeoutSec" | "graceSec" | "subcommand" | "args";
  message: string;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSafeNotebookLmLocalArg(value: string): boolean {
  return value.length > 0 && !value.includes("\0") && !/[\r\n]/.test(value);
}

/**
 * Reject malformed runtime config before persistence. Binary/profile-store
 * reachability belongs to testEnvironment because it depends on target runtime.
 */
export function validateNotebookLmLocalConfig(
  config: Record<string, unknown>,
): NotebookLmLocalConfigValidationIssue[] {
  const issues: NotebookLmLocalConfigValidationIssue[] = [];
  const command = asTrimmedString(config.command) || "nlm";
  const profile = asTrimmedString(config.profile) || "default";
  const cookieStorePath = asTrimmedString(config.cookieStorePath);
  const cwd = asTrimmedString(config.cwd);
  const subcommand = asTrimmedString(config.subcommand);
  const args = config.args;

  if (/\0|[\r\n]/.test(command) || /\s/.test(command)) {
    issues.push({ key: "command", message: "command must be one bare command name or absolute path without whitespace." });
  }
  if (command.includes("/") && !command.startsWith("/")) {
    issues.push({ key: "command", message: "command paths must be absolute." });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profile)) {
    issues.push({ key: "profile", message: "profile must be a simple nlm profile name." });
  }
  if (cookieStorePath && !cookieStorePath.startsWith("/")) {
    issues.push({ key: "cookieStorePath", message: "cookieStorePath must be an absolute path." });
  }
  if (/\0|[\r\n]/.test(cookieStorePath)) {
    issues.push({ key: "cookieStorePath", message: "cookieStorePath must not contain control characters." });
  }
  if (cwd && !cwd.startsWith("/")) {
    issues.push({ key: "cwd", message: "cwd must be an absolute path." });
  }
  if (/\0|[\r\n]/.test(cwd)) {
    issues.push({ key: "cwd", message: "cwd must not contain control characters." });
  }
  if (!isAllowedNotebookLmLocalSubcommand(subcommand)) {
    issues.push({ key: "subcommand", message: "subcommand must be one of the allowlisted nlm commands." });
  }
  if (Array.isArray(args) && !args.every((value) => typeof value === "string" && isSafeNotebookLmLocalArg(value))) {
    issues.push({ key: "args", message: "each argument must be a non-empty single line." });
  }
  if (typeof args === "string" && !args.split(/\r?\n/).filter(Boolean).every(isSafeNotebookLmLocalArg)) {
    issues.push({ key: "args", message: "each argument must be a non-empty single line." });
  }
  if (typeof args !== "undefined" && typeof args !== "string" && !Array.isArray(args)) {
    issues.push({ key: "args", message: "args must be newline-delimited text or an array of strings." });
  }

  for (const [key, value] of [["timeoutSec", config.timeoutSec], ["graceSec", config.graceSec]] as const) {
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
      issues.push({ key, message: `${key} must be a non-negative integer.` });
    }
  }

  return issues;
}

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "command",
        label: "nlm command",
        type: "text",
        default: "nlm",
        hint: "Absolute path or bare command name for the nlm CLI (notebooklm-mcp-cli v0.9.14 surface). Resolved via PATH when not absolute.",
      },
      {
        key: "profile",
        label: "Auth profile",
        type: "text",
        default: "default",
        hint: "nlm auth profile name. Never put credentials or cookies here. If Test reports invalid auth, an operator must run `nlm login --profile <name>` out of band in this runtime; this adapter never logs in automatically.",
      },
      {
        key: "cookieStorePath",
        label: "Cookie/profile store path",
        type: "text",
        hint: "Absolute path to the nlm profile/cookie store on this runtime (e.g. /paperclip/notebooklm), injected as NOTEBOOKLM_MCP_CLI_PATH. This is a plain path, not a secret \u2014 but never display or log the store's contents.",
      },
      {
        key: "subcommand",
        label: "nlm subcommand",
        type: "select",
        required: true,
        default: "notebook",
        options: NOTEBOOKLM_LOCAL_SUBCOMMANDS.map((value) => ({ label: value, value })),
        hint: "Top-level nlm command, restricted to the live-captured v0.9.14 --help surface. Any other value is rejected before spawn.",
      },
      {
        key: "args",
        label: "Arguments (one per line)",
        type: "textarea",
        hint: "Additional nlm CLI arguments, one per line, appended after the subcommand in order. Include --json explicitly on a line by itself to request structured JSON parsing of stdout.",
      },
      {
        key: "cwd",
        label: "Working directory",
        type: "text",
        hint: "Absolute working directory for the nlm process. Defaults to the Paperclip runtime's current directory.",
      },
      {
        key: "timeoutSec",
        label: "Timeout (seconds)",
        type: "number",
        default: 60,
        hint: "Hard kill timeout for the nlm invocation. 0 disables the timeout.",
      },
      {
        key: "graceSec",
        label: "Grace period (seconds)",
        type: "number",
        default: 15,
        hint: "SIGTERM grace period before SIGKILL once the timeout fires.",
      },
    ],
  };
}
