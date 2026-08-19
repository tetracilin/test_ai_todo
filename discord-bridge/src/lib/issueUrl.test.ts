import { describe, expect, it } from "vitest";
import { issueUrl } from "./issueUrl.js";

describe("issueUrl", () => {
  it("builds a company-prefixed issue URL", () => {
    expect(issueUrl("T-10", "T", "https://paperclip.example")).toBe(
      "https://paperclip.example/T/issues/T-10",
    );
  });

  it("does not strip or add slashes on its own (edge case: caller must normalize dashboardUrl)", () => {
    expect(issueUrl("T-10", "T", "https://paperclip.example/")).toBe(
      "https://paperclip.example//T/issues/T-10",
    );
  });
});
