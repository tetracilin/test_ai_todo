import { describe, expect, it } from "vitest";
import { getConfigSchema, validateNotebookLmLocalConfig } from "./config-schema.js";

describe("notebooklm_local config schema", () => {
  it("exposes only non-credential runtime fields with safe defaults", () => {
    const fields = getConfigSchema().fields;
    expect(fields.map((field) => field.key)).toEqual([
      "command",
      "profile",
      "cookieStorePath",
      "subcommand",
      "args",
      "cwd",
      "timeoutSec",
      "graceSec",
    ]);
    expect(fields.find((field) => field.key === "command")?.default).toBe("nlm");
    expect(fields.find((field) => field.key === "profile")?.default).toBe("default");
    expect(fields.find((field) => field.key === "subcommand")?.default).toBe("notebook");
    expect(fields.map((field) => field.key)).not.toEqual(expect.arrayContaining([
      "password",
      "token",
      "credential",
      "apiKey",
    ]));
  });

  it("rejects unsafe command, path, argument, and timeout values before save", () => {
    const issues = validateNotebookLmLocalConfig({
      command: "nlm --unsafe",
      profile: "default profile",
      cookieStorePath: "relative/store",
      cwd: "relative/cwd",
      subcommand: "not-allowed",
      args: ["list", "two\nlines"],
      timeoutSec: -1,
      graceSec: 1.5,
    });

    expect(issues.map((issue) => issue.key)).toEqual(expect.arrayContaining([
      "command",
      "profile",
      "cookieStorePath",
      "cwd",
      "subcommand",
      "args",
      "timeoutSec",
      "graceSec",
    ]));
  });

  it("accepts bounded NotebookLM argv configuration", () => {
    expect(validateNotebookLmLocalConfig({
      command: "/usr/local/bin/nlm",
      profile: "default",
      cookieStorePath: "/paperclip/notebooklm",
      cwd: "/paperclip",
      subcommand: "notebook",
      args: ["list", "--json"],
      timeoutSec: 60,
      graceSec: 15,
    })).toEqual([]);
  });

  it("rejects a malformed newline-delimited argument from the schema form", () => {
    expect(validateNotebookLmLocalConfig({
      subcommand: "notebook",
      args: "list\nunsafe\0argument",
    }).map((issue) => issue.key)).toContain("args");
  });
});
