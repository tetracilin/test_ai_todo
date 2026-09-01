import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runChildProcess: vi.fn(),
  };
});

import { testEnvironment } from "./test.js";
import { runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import type { AdapterEnvironmentTestContext } from "@paperclipai/adapter-utils";

const runChildProcessMock = vi.mocked(runChildProcess);

function baseContext(
  config: Record<string, unknown>,
  overrides: Partial<AdapterEnvironmentTestContext> = {},
): AdapterEnvironmentTestContext {
  return {
    companyId: "company-1",
    adapterType: "notebooklm_local",
    config,
    ...overrides,
  };
}

function processResult(overrides: Partial<Awaited<ReturnType<typeof runChildProcess>>> = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 4242,
    startedAt: new Date().toISOString(),
    ...overrides,
  } as Awaited<ReturnType<typeof runChildProcess>>;
}

let tmpProfileDir: string;

describe("notebooklm_local testEnvironment", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
    tmpProfileDir = mkdtempSync(path.join(tmpdir(), "nlm-a05-profile-"));
  });

  afterEach(() => {
    rmSync(tmpProfileDir, { recursive: true, force: true });
  });

  it("reports pass with a valid-auth check when everything succeeds (healthy live profile)", async () => {
    runChildProcessMock
      .mockResolvedValueOnce(processResult({ stdout: "nlm version 0.9.14\n" })) // --version
      .mockResolvedValueOnce(
        processResult({
          stdout:
            "Checking credentials for profile: default...\n\u2713 Authentication valid!\n  Profile: default\n  Notebooks found: 14\n  Account: user@example.com\n",
        }),
      ); // login --check

    const result = await testEnvironment(
      baseContext({ command: "nlm", profile: "default", cookieStorePath: tmpProfileDir }),
    );

    expect(result.status).toBe("pass");
    expect(result.adapterType).toBe("notebooklm_local");
    expect(result.checks.map((c) => c.code)).toEqual(
      expect.arrayContaining([
        "notebooklm_local_profile_store_accessible",
        "notebooklm_local_binary_identity_verified",
        "notebooklm_local_auth_valid",
      ]),
    );
    // Never surfaces the raw stdout (which contains the Account: line) in any check.
    const serialized = JSON.stringify(result.checks);
    expect(serialized).not.toContain("Account:");
    expect(serialized).not.toContain("user@example.com");
  });

  it("classifies invalid/expired auth distinctly from a healthy profile", async () => {
    runChildProcessMock
      .mockResolvedValueOnce(processResult({ stdout: "nlm version 0.9.14\n" }))
      .mockResolvedValueOnce(
        processResult({ exitCode: 2, stderr: "\u2717 Authentication failed: Cookies have expired\n" }),
      );

    const result = await testEnvironment(
      baseContext({ command: "nlm", profile: "default", cookieStorePath: tmpProfileDir }),
    );

    expect(result.status).toBe("fail");
    const authCheck = result.checks.find((c) => c.code === "notebooklm_local_auth_invalid");
    expect(authCheck).toBeDefined();
    expect(authCheck?.level).toBe("error");
    expect(authCheck?.hint).toMatch(/nlm login/);
  });

  it("classifies command-not-found without attempting the auth probe", async () => {
    runChildProcessMock.mockRejectedValueOnce(
      new Error('Failed to start command "nlm" in "/paperclip". Verify adapter command, working directory, and PATH ().'),
    );

    const result = await testEnvironment(
      baseContext({ command: "nlm", profile: "default", cookieStorePath: tmpProfileDir }),
    );

    expect(result.status).toBe("fail");
    expect(result.checks.some((c) => c.code === "notebooklm_local_command_not_found")).toBe(true);
    // Only one probe attempted: the version check. No auth probe when the binary is missing.
    expect(runChildProcessMock).toHaveBeenCalledTimes(1);
  });

  it("classifies wrong binary when --version succeeds but output isn't an nlm version string", async () => {
    runChildProcessMock.mockResolvedValueOnce(processResult({ stdout: "GNU coreutils 9.4\n" }));

    const result = await testEnvironment(
      baseContext({ command: "ls", profile: "default", cookieStorePath: tmpProfileDir }),
    );

    expect(result.status).toBe("fail");
    expect(result.checks.some((c) => c.code === "notebooklm_local_wrong_binary")).toBe(true);
    // Auth probe is skipped once binary identity fails.
    expect(runChildProcessMock).toHaveBeenCalledTimes(1);
  });

  it("classifies wrong binary when --version exits nonzero", async () => {
    runChildProcessMock.mockResolvedValueOnce(processResult({ exitCode: 1, stderr: "unknown flag --version\n" }));

    const result = await testEnvironment(
      baseContext({ command: "nlm", profile: "default", cookieStorePath: tmpProfileDir }),
    );

    expect(result.status).toBe("fail");
    expect(result.checks.some((c) => c.code === "notebooklm_local_wrong_binary")).toBe(true);
  });

  it("gives an actionable error for a missing/inaccessible profile-store path", async () => {
    runChildProcessMock
      .mockResolvedValueOnce(processResult({ stdout: "nlm version 0.9.14\n" }))
      .mockResolvedValueOnce(
        processResult({ stdout: "\u2713 Authentication valid!\n  Profile: default\n" }),
      );

    const missingPath = path.join(tmpProfileDir, "does-not-exist-subdir");
    const result = await testEnvironment(
      baseContext({ command: "nlm", profile: "default", cookieStorePath: missingPath }),
    );

    expect(result.status).toBe("fail");
    const storeCheck = result.checks.find((c) => c.code === "notebooklm_local_profile_store_inaccessible");
    expect(storeCheck).toBeDefined();
    expect(storeCheck?.level).toBe("error");
    expect(storeCheck?.detail).toBe(missingPath);
    expect(storeCheck?.message).toBeTruthy();
  });

  it("warns (does not fail outright) when cookieStorePath is unset", async () => {
    runChildProcessMock
      .mockResolvedValueOnce(processResult({ stdout: "nlm version 0.9.14\n" }))
      .mockResolvedValueOnce(processResult({ stdout: "\u2713 Authentication valid!\n" }));

    const result = await testEnvironment(baseContext({ command: "nlm", profile: "default" }));

    const storeCheck = result.checks.find((c) => c.code === "notebooklm_local_profile_store_not_configured");
    expect(storeCheck).toBeDefined();
    expect(storeCheck?.level).toBe("warn");
    // A warn-level check (no cookieStorePath configured) never escalates
    // status to "fail" on its own -- only error-level checks do that.
    expect(result.status).toBe("warn");
    expect(result.checks.some((c) => c.level === "error")).toBe(false);
  });

  it("times out the version probe distinctly from an auth-probe timeout", async () => {
    runChildProcessMock.mockResolvedValueOnce(
      processResult({ timedOut: true, exitCode: null, signal: "SIGTERM", stdout: "" }),
    );

    const result = await testEnvironment(
      baseContext({ command: "nlm", profile: "default", cookieStorePath: tmpProfileDir }),
    );

    expect(result.status).toBe("fail");
    expect(result.checks.some((c) => c.code === "notebooklm_local_version_probe_timeout")).toBe(true);
  });

  it("still emits a wrong-binary/command-not-found check for an empty command (defensive default)", async () => {
    // asString() falls back to the schema default "nlm" for a genuinely
    // unset config.command, so this exercises the same command-not-found
    // path as the dedicated test above via an empty string in config.
    runChildProcessMock.mockRejectedValueOnce(
      new Error('Failed to start command "nlm" in "/paperclip". Verify adapter command, working directory, and PATH ().'),
    );

    const result = await testEnvironment(baseContext({ command: "", profile: "default" }));

    expect(result.status).toBe("fail");
    expect(result.checks.some((c) => c.code === "notebooklm_local_command_not_found")).toBe(true);
    expect(runChildProcessMock).toHaveBeenCalledTimes(1);
  });

  it("never includes profile/cookie content in check output even on success", async () => {
    const secretLookingStdout =
      "Checking credentials...\n\u2713 Authentication valid!\n  Account: someone@example.com\n  __Secure-1PSID=abc123;\n";
    runChildProcessMock
      .mockResolvedValueOnce(processResult({ stdout: "nlm version 0.9.14\n" }))
      .mockResolvedValueOnce(processResult({ stdout: secretLookingStdout }));

    const result = await testEnvironment(
      baseContext({ command: "nlm", profile: "default", cookieStorePath: tmpProfileDir }),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("__Secure-1PSID");
    expect(serialized).not.toContain("someone@example.com");
  });

  it("passes argv [login, --check, --profile <profile>] to the auth probe, mirroring execute()", async () => {
    runChildProcessMock
      .mockResolvedValueOnce(processResult({ stdout: "nlm version 0.9.14\n" }))
      .mockResolvedValueOnce(processResult({ stdout: "\u2713 Authentication valid!\n" }));

    await testEnvironment(
      baseContext({ command: "nlm", profile: "work", cookieStorePath: tmpProfileDir }),
    );

    expect(runChildProcessMock).toHaveBeenCalledTimes(2);
    const [, authCommand, authArgv, authOpts] = runChildProcessMock.mock.calls[1]!;
    expect(authCommand).toBe("nlm");
    expect(authArgv).toEqual(["login", "--check", "--profile", "work"]);
    expect(authOpts.env.NOTEBOOKLM_MCP_CLI_PATH).toBe(tmpProfileDir);
  });

  it("no Google credential field exists anywhere in the config it reads", async () => {
    runChildProcessMock
      .mockResolvedValueOnce(processResult({ stdout: "nlm version 0.9.14\n" }))
      .mockResolvedValueOnce(processResult({ stdout: "\u2713 Authentication valid!\n" }));

    await testEnvironment(
      baseContext({
        command: "nlm",
        profile: "default",
        cookieStorePath: tmpProfileDir,
        // deliberately not read/used by testEnvironment even if present in config
        googleCredential: "should-never-be-touched",
      }),
    );

    const anyCallUsedGoogleCredential = runChildProcessMock.mock.calls.some(([, , , opts]) =>
      JSON.stringify(opts.env).includes("should-never-be-touched"),
    );
    expect(anyCallUsedGoogleCredential).toBe(false);
  });
});
