import { describe, expect, it } from "vitest";
import { isDatabaseConnectionUnavailableError } from "../app.js";

describe("feedback export flush error classification", () => {
  it("recognizes wrapped database connection-refused errors", () => {
    const error = new Error("Failed query: select ...: connect ECONNREFUSED 127.0.0.1:54329");
    (error as { cause?: unknown }).cause = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:54329"),
      { code: "ECONNREFUSED" },
    );

    expect(isDatabaseConnectionUnavailableError(error)).toBe(true);
  });

  it("does not classify ordinary feedback upload failures as database outages", () => {
    expect(isDatabaseConnectionUnavailableError(new Error("upstream returned 500"))).toBe(false);
  });

  it("does not trust unrelated error messages that mention ECONNREFUSED", () => {
    expect(isDatabaseConnectionUnavailableError(
      new Error("feedback upload payload mentioned ECONNREFUSED in user content"),
    )).toBe(false);
  });

  it("recognizes a top-level ECONNREFUSED code without a cause chain", () => {
    expect(isDatabaseConnectionUnavailableError(Object.assign(new Error("boom"), { code: "ECONNREFUSED" }))).toBe(true);
  });

  it("does not classify other error codes or non-error values as database outages", () => {
    expect(isDatabaseConnectionUnavailableError(Object.assign(new Error("boom"), { code: "ETIMEDOUT" }))).toBe(false);
    expect(isDatabaseConnectionUnavailableError(null)).toBe(false);
    expect(isDatabaseConnectionUnavailableError(undefined)).toBe(false);
    expect(isDatabaseConnectionUnavailableError("ECONNREFUSED")).toBe(false);
  });
});
