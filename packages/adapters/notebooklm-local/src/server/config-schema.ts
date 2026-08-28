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
        hint: "nlm auth profile name (see \"nlm login --profile <name>\"). Never put credentials or cookies in this field.",
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
