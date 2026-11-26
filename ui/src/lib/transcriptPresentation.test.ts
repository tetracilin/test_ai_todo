import { describe, expect, it } from "vitest";
import {
  describeToolInput,
  shouldHideNiceModeStderr,
  stripInformationalStderrExcerpt,
  summarizeToolInput,
} from "./transcriptPresentation";

describe("shouldHideNiceModeStderr", () => {
  it("hides start-of-run paperclip notices that are not failures", () => {
    expect(
      shouldHideNiceModeStderr(
        "[paperclip] Adapter execution timeout: none (no adapter wall-clock timeout for this target; set adapterConfig.timeoutSec to add one).",
      ),
    ).toBe(true);
    expect(
      shouldHideNiceModeStderr(
        "[paperclip] Adapter execution timeout: timeoutSec=14400 (sandbox default; set adapterConfig.timeoutSec to override).",
      ),
    ).toBe(true);
    expect(
      shouldHideNiceModeStderr(
        "[paperclip] Skipping saved session resume for task \"PAP-485\" because wake reason is issue_assigned.",
      ),
    ).toBe(true);
  });

  it("keeps real timeout failures and other stderr visible", () => {
    expect(
      shouldHideNiceModeStderr(
        "[paperclip] Run exceeded the adapter execution timeout (timeoutSec=14400, sandbox default).",
      ),
    ).toBe(false);
    expect(shouldHideNiceModeStderr("[paperclip] ACPX child stderr tail (turn): error")).toBe(false);
  });
});

describe("stripInformationalStderrExcerpt", () => {
  it("drops the start-of-run timeout notice from a failure excerpt", () => {
    expect(
      stripInformationalStderrExcerpt(
        "[paperclip] Adapter execution timeout: none (no adapter wall-clock timeout for this target; set adapterConfig.timeoutSec to add one).\n",
      ),
    ).toBe("");
  });

  it("keeps actionable stderr lines next to a filtered notice", () => {
    expect(
      stripInformationalStderrExcerpt(
        [
          "[paperclip] Adapter execution timeout: timeoutSec=900 (configured via adapterConfig.timeoutSec; set adapterConfig.timeoutSec to override).",
          "error: spawn claude ENOENT",
          "",
        ].join("\n"),
      ),
    ).toBe("error: spawn claude ENOENT");
  });
});

describe("summarizeToolInput", () => {
  it("prefers human descriptions over raw commands when both exist", () => {
    expect(
      summarizeToolInput("command_execution", {
        description: "Inspect the issue chat thread layout classes",
        command: "zsh -lc 'sed -n \"1,220p\" ui/src/components/IssueChatThread.tsx'",
      }),
    ).toBe("Inspect the issue chat thread layout classes");
  });
});

describe("describeToolInput", () => {
  it("keeps command tools description-first in the detail view", () => {
    expect(
      describeToolInput("command_execution", {
        description: "Inspect the issue chat thread layout classes",
        command: "zsh -lc 'sed -n \"1,220p\" ui/src/components/IssueChatThread.tsx'",
        cwd: "/workspace/paperclip",
      }),
    ).toEqual([
      { label: "Intent", value: "Inspect the issue chat thread layout classes", tone: "default" },
      { label: "Directory", value: "/workspace/paperclip", tone: "default" },
    ]);
  });

  it("surfaces concise structured details for file tools", () => {
    expect(
      describeToolInput("read_file", {
        path: "ui/src/lib/issue-chat-messages.ts",
      }),
    ).toEqual([
      { label: "Path", value: "ui/src/lib/issue-chat-messages.ts", tone: "default" },
    ]);
  });
});
