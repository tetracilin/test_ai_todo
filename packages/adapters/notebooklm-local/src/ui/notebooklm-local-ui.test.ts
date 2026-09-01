import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { describe, expect, it } from "vitest";
import {
  buildNotebookLmLocalConfig,
  parseNotebookLmLocalStdoutLine,
  NOTEBOOKLM_LOCAL_TRANSCRIPT_MAX_CHARS,
  NOTEBOOKLM_LOCAL_TRANSCRIPT_TRUNCATION_MARKER,
} from "./index.js";

const baseValues: CreateConfigValues = {
  adapterType: "notebooklm_local" as const,
  cwd: "",
  instructionsFilePath: "",
  promptTemplate: "",
  model: "",
  thinkingEffort: "",
  chrome: false,
  dangerouslySkipPermissions: false,
  search: false,
  fastMode: false,
  dangerouslyBypassSandbox: false,
  command: "",
  args: "",
  extraArgs: "",
  envVars: "",
  envBindings: {},
  url: "",
  bootstrapPrompt: "",
  maxTurnsPerRun: 1000,
  heartbeatEnabled: false,
  intervalSec: 300,
};

describe("NotebookLM UI config", () => {
  it("uses safe defaults and preserves declared runtime fields", () => {
    expect(buildNotebookLmLocalConfig({
      ...baseValues,
      adapterSchemaValues: {
        subcommand: "notebook",
        args: "list\n--json",
        cookieStorePath: " /paperclip/notebooklm ",
        cwd: " /paperclip ",
      },
    })).toEqual({
      command: "nlm",
      profile: "default",
      subcommand: "notebook",
      args: "list\n--json",
      timeoutSec: 60,
      graceSec: 15,
      cookieStorePath: "/paperclip/notebooklm",
      cwd: "/paperclip",
    });
  });
});

describe("NotebookLM transcript rendering", () => {
  const ts = "2026-08-29T00:00:00.000Z";

  it("pretty prints JSON stdout", () => {
    expect(parseNotebookLmLocalStdoutLine('{"notebooks":["alpha"]}', ts)).toEqual([
      { kind: "stdout", ts, text: '{\n  "notebooks": [\n    "alpha"\n  ]\n}' },
    ]);
  });

  it("keeps non-JSON output as raw stdout", () => {
    expect(parseNotebookLmLocalStdoutLine("Authentication valid", ts)).toEqual([
      { kind: "stdout", ts, text: "Authentication valid" },
    ]);
  });

  it("marks oversized transcript output as truncated", () => {
    const output = "x".repeat(NOTEBOOKLM_LOCAL_TRANSCRIPT_MAX_CHARS + 1);
    const [entry] = parseNotebookLmLocalStdoutLine(output, ts);
    expect(entry).toMatchObject({ kind: "stdout", ts });
    expect(entry?.kind).toBe("stdout");
    if (entry?.kind !== "stdout") throw new Error("expected stdout transcript entry");
    expect(entry.text).toContain(NOTEBOOKLM_LOCAL_TRANSCRIPT_TRUNCATION_MARKER);
  });
});
