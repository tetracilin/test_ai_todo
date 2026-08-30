import { afterEach, describe, expect, it, vi } from "vitest";
import { formatNotebookLmLocalStdoutEvent } from "./format-event.js";

describe("formatNotebookLmLocalStdoutEvent", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  afterEach(() => {
    log.mockClear();
  });

  function output(): string {
    return log.mock.calls.flat().join("\n");
  }

  it("renders JSON success without profile fields", () => {
    formatNotebookLmLocalStdoutEvent(JSON.stringify({
      type: "result",
      exitCode: 0,
      resultJson: {
        json: [{ id: "nb-1", title: "Read me", account: "person@example.com" }],
        stdout: "ignored because JSON is available",
      },
    }), false);

    expect(output()).toContain("NotebookLM command completed");
    expect(output()).toContain("JSON result:");
    expect(output()).toContain("nb-1");
    expect(output()).toContain("[redacted]");
    expect(output()).not.toContain("person@example.com");
  });

  it("renders raw stdout when JSON is unavailable", () => {
    formatNotebookLmLocalStdoutEvent(JSON.stringify({
      type: "result",
      exitCode: 0,
      resultJson: { stdout: "Notebook list\n- Product notes" },
    }), false);

    expect(output()).toContain("stdout:");
    expect(output()).toContain("Product notes");
  });

  it("redacts auth-failure profile data and gives out-of-band guidance", () => {
    formatNotebookLmLocalStdoutEvent(JSON.stringify({
      type: "result",
      exitCode: 1,
      errorCode: "notebooklm_local_auth_failed",
      errorMessage: "Cookies have expired\nAccount: person@example.com",
      resultJson: { stderr: "__Secure-1PSID=secret-cookie" },
    }), false);

    expect(output()).toContain("NotebookLM authentication failed");
    expect(output()).toContain("Run nlm login out of band");
    expect(output()).not.toContain("person@example.com");
    expect(output()).not.toContain("secret-cookie");
  });

  it("renders command errors and timeouts", () => {
    formatNotebookLmLocalStdoutEvent(JSON.stringify({
      type: "result",
      exitCode: 2,
      errorCode: "notebooklm_local_nonzero_exit",
      errorMessage: "Notebook not found",
    }), false);
    formatNotebookLmLocalStdoutEvent(JSON.stringify({
      type: "result",
      exitCode: null,
      timedOut: true,
      errorCode: "notebooklm_local_timeout",
      resultJson: { stdout: "partial result" },
    }), false);

    expect(output()).toContain("NotebookLM command failed: notebooklm_local_nonzero_exit");
    expect(output()).toContain("NotebookLM command timed out");
    expect(output()).toContain("partial result");
  });

  it("marks adapter and renderer truncation", () => {
    formatNotebookLmLocalStdoutEvent(JSON.stringify({
      type: "result",
      exitCode: 0,
      resultJson: { stdout: "x".repeat(9_000), stdoutTruncated: true },
    }), false);

    expect(output()).toContain("output truncated");
    expect(output()).toContain("stdout truncated");
    expect(output()).toContain("…[truncated by Paperclip notebooklm_local adapter]");
  });

  it("preserves readable raw nlm stdout and redacts generic JSON output", () => {
    formatNotebookLmLocalStdoutEvent("nlm version 0.9.14", false);
    formatNotebookLmLocalStdoutEvent(JSON.stringify({ type: "progress", account: "person@example.com" }), false);

    expect(output()).toContain("nlm version 0.9.14");
    expect(output()).toContain("[redacted]");
    expect(output()).not.toContain("person@example.com");
  });
});