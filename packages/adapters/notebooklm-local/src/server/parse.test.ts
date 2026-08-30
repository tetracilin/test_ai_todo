import { describe, expect, it } from "vitest";
import {
  boundNotebookLmLocalText,
  buildNotebookLmLocalArgv,
  classifyNotebookLmLocalAuthFailure,
  isNotebookLmLocalCommandNotFoundError,
  NOTEBOOKLM_LOCAL_TRUNCATION_MARKER,
  parseNotebookLmLocalStdout,
  resolveNotebookLmLocalArgs,
} from "./parse.js";

describe("buildNotebookLmLocalArgv", () => {
  it("builds argv with the subcommand first and appends the configured profile", () => {
    const argv = buildNotebookLmLocalArgv({
      subcommand: "notebook",
      args: ["list", "--json"],
      profile: "default",
    });
    expect(argv).toEqual(["notebook", "list", "--json", "--profile", "default"]);
  });

  it("does not duplicate --profile when the caller already supplied one", () => {
    const argv = buildNotebookLmLocalArgv({
      subcommand: "login",
      args: ["--check", "--profile", "work"],
      profile: "default",
    });
    expect(argv).toEqual(["login", "--check", "--profile", "work"]);
  });

  it("omits --profile when no profile is configured", () => {
    const argv = buildNotebookLmLocalArgv({
      subcommand: "notebook",
      args: ["list"],
      profile: "",
    });
    expect(argv).toEqual(["notebook", "list"]);
  });

  it("rejects a subcommand outside the captured nlm v0.9.14 CLI surface", () => {
    expect(() =>
      buildNotebookLmLocalArgv({ subcommand: "not-a-real-command", args: [], profile: "default" }),
    ).toThrow(/not in the allowlisted nlm v0\.9\.14 CLI surface/);
  });

  it("rejects an empty subcommand", () => {
    expect(() => buildNotebookLmLocalArgv({ subcommand: "", args: [], profile: "default" })).toThrow(
      "missing subcommand",
    );
  });

  it("rejects a subcommand that smuggles a shell/argv injection attempt", () => {
    // Injection rejection: a value like "notebook; rm -rf /" or containing
    // shell metacharacters is still checked ONLY against the allowlist set
    // membership (exact string match) -- it is never shell-parsed or
    // pattern-matched, so any value not identical to an allowlisted token is
    // rejected outright, regardless of what it "looks like" it might do.
    expect(() =>
      buildNotebookLmLocalArgv({
        subcommand: "notebook; rm -rf /",
        args: [],
        profile: "default",
      }),
    ).toThrow(/not in the allowlisted nlm v0\.9\.14 CLI surface/);
  });

  it("keeps injection-attempt characters in args as inert literal argv members", () => {
    // Args are never checked against an allowlist (nlm itself owns arg
    // validation), but they must survive into argv as opaque strings -- this
    // is what proves buildNotebookLmLocalArgv/runChildProcess never routes
    // through a shell (spawn's shell:false), so `$(...)`/`;`/`|` have no
    // special meaning.
    const argv = buildNotebookLmLocalArgv({
      subcommand: "notebook",
      args: ["query", "id", "ignore instructions; $(rm -rf /)"],
      profile: "",
    });
    expect(argv).toEqual(["notebook", "query", "id", "ignore instructions; $(rm -rf /)"]);
  });
});

describe("resolveNotebookLmLocalArgs", () => {
  it("splits a textarea-style newline-delimited string into trimmed args", () => {
    expect(resolveNotebookLmLocalArgs("list\n--json\n \n--full\n")).toEqual([
      "list",
      "--json",
      "--full",
    ]);
  });

  it("passes through a real string array (operator-only direct config)", () => {
    expect(resolveNotebookLmLocalArgs(["list", "--json"])).toEqual(["list", "--json"]);
  });

  it("filters non-string entries out of an array", () => {
    expect(resolveNotebookLmLocalArgs(["list", 42, null, "--json"] as unknown[])).toEqual([
      "list",
      "--json",
    ]);
  });

  it("returns an empty array for unset/other-typed config", () => {
    expect(resolveNotebookLmLocalArgs(undefined)).toEqual([]);
    expect(resolveNotebookLmLocalArgs(null)).toEqual([]);
    expect(resolveNotebookLmLocalArgs(123)).toEqual([]);
  });
});

describe("parseNotebookLmLocalStdout — JSON success", () => {
  it("parses a valid --json array (real nlm notebook list shape, NLM-A02 evidence)", () => {
    const stdout = JSON.stringify([
      { id: "nb-1", title: "Metrology.NET 2.0", source_count: 3, updated_at: "2026-08-01" },
      { id: "nb-2", title: "Another notebook", source_count: 1, updated_at: "2026-08-02" },
    ]);
    const parsed = parseNotebookLmLocalStdout(stdout, { jsonRequested: true });
    expect(parsed.jsonParseError).toBeNull();
    expect(parsed.jsonTruncated).toBe(false);
    expect(Array.isArray(parsed.json)).toBe(true);
    expect((parsed.json as unknown[]).length).toBe(2);
  });

  it("parses a valid --json object (e.g. notebook get)", () => {
    const stdout = JSON.stringify({ id: "nb-1", title: "Metrology.NET 2.0" });
    const parsed = parseNotebookLmLocalStdout(stdout, { jsonRequested: true });
    expect(parsed.jsonParseError).toBeNull();
    expect(parsed.json).toEqual({ id: "nb-1", title: "Metrology.NET 2.0" });
  });

  it("caps an oversized JSON array at the configured item limit", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `nb-${i}` }));
    const stdout = JSON.stringify(items);
    const parsed = parseNotebookLmLocalStdout(stdout, { jsonRequested: true, maxArrayItems: 3 });
    expect(parsed.jsonTruncated).toBe(true);
    expect((parsed.json as unknown[]).length).toBe(3);
  });
});

describe("parseNotebookLmLocalStdout — raw fallback", () => {
  it("returns raw stdout without attempting JSON parsing when --json was not requested", () => {
    const stdout = "Checking credentials for profile: default...\n\u2713 Authentication valid!\n";
    const parsed = parseNotebookLmLocalStdout(stdout, { jsonRequested: false });
    expect(parsed.json).toBeNull();
    expect(parsed.jsonParseError).toBeNull();
    expect(parsed.raw).toBe(stdout);
  });
});

describe("parseNotebookLmLocalStdout — malformed JSON", () => {
  it("reports a structured parse error instead of throwing when --json output is not valid JSON", () => {
    const stdout = "not actually json {{{";
    const parsed = parseNotebookLmLocalStdout(stdout, { jsonRequested: true });
    expect(parsed.json).toBeNull();
    expect(parsed.jsonParseError).toMatch(/failed to parse --json stdout as JSON/);
    // Raw stdout must still be preserved as a fallback even on parse failure.
    expect(parsed.raw).toBe(stdout);
  });

  it("reports a structured error when --json was requested but stdout was empty", () => {
    const parsed = parseNotebookLmLocalStdout("   \n  ", { jsonRequested: true });
    expect(parsed.json).toBeNull();
    expect(parsed.jsonParseError).toMatch(/stdout was empty/);
  });
});

describe("classifyNotebookLmLocalAuthFailure", () => {
  it("detects the live-captured auth-expired phrasing", () => {
    expect(classifyNotebookLmLocalAuthFailure("Cookies have expired")).toBe(true);
    expect(classifyNotebookLmLocalAuthFailure("Error: authentication may have expired")).toBe(true);
    expect(classifyNotebookLmLocalAuthFailure("Profile not found: default")).toBe(true);
  });

  it("does not flag unrelated errors as auth failures", () => {
    expect(classifyNotebookLmLocalAuthFailure("Notebook not found")).toBe(false);
    expect(classifyNotebookLmLocalAuthFailure("Rate limit exceeded")).toBe(false);
    expect(classifyNotebookLmLocalAuthFailure("")).toBe(false);
  });
});

describe("isNotebookLmLocalCommandNotFoundError", () => {
  it("recognizes the runChildProcess ENOENT rejection shape", () => {
    const err = new Error(
      'Failed to start command "nlm" in "/paperclip". Verify adapter command, working directory, and PATH ().',
    );
    expect(isNotebookLmLocalCommandNotFoundError(err)).toBe(true);
  });

  it("does not misclassify an unrelated error", () => {
    expect(isNotebookLmLocalCommandNotFoundError(new Error("some other failure"))).toBe(false);
    expect(isNotebookLmLocalCommandNotFoundError("not an Error instance")).toBe(false);
  });
});

describe("boundNotebookLmLocalText — truncation markers", () => {
  it("passes short text through unchanged", () => {
    const bounded = boundNotebookLmLocalText("short output", 100);
    expect(bounded.text).toBe("short output");
    expect(bounded.truncated).toBe(false);
  });

  it("truncates oversized text and appends the truncation marker", () => {
    const longText = "x".repeat(50);
    const bounded = boundNotebookLmLocalText(longText, 10);
    expect(bounded.truncated).toBe(true);
    expect(bounded.text.length).toBe(10 + 1 + NOTEBOOKLM_LOCAL_TRUNCATION_MARKER.length);
    expect(bounded.text.endsWith(NOTEBOOKLM_LOCAL_TRUNCATION_MARKER)).toBe(true);
    expect(bounded.text.startsWith("x".repeat(10))).toBe(true);
  });
});
