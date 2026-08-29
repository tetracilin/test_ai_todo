import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runChildProcess: vi.fn(),
    resolveCommandForLogs: vi.fn(async (command: string) => `/usr/local/bin/${command}`),
  };
});

import { execute } from "./execute.js";
import { runChildProcess, resolveCommandForLogs } from "@paperclipai/adapter-utils/server-utils";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const runChildProcessMock = vi.mocked(runChildProcess);
const resolveCommandForLogsMock = vi.mocked(resolveCommandForLogs);

function baseContext(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "NotebookLM Agent",
      adapterType: "notebooklm_local",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config: {},
    context: {},
    onLog: async () => {},
    ...overrides,
  } as AdapterExecutionContext;
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

describe("notebooklm_local execute — args/env", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
    resolveCommandForLogsMock.mockClear();
  });

  it("builds argv [subcommand, ...args, --profile <profile>] and injects NOTEBOOKLM_MCP_CLI_PATH", async () => {
    runChildProcessMock.mockResolvedValueOnce(
      processResult({ stdout: "Checking credentials...\n\u2713 Authentication valid!\n" }),
    );

    const result = await execute(
      baseContext({
        config: {
          command: "nlm",
          subcommand: "login",
          args: ["--check"],
          profile: "default",
          cookieStorePath: "/paperclip/notebooklm",
          cwd: "/paperclip",
        },
      }),
    );

    expect(runChildProcessMock).toHaveBeenCalledTimes(1);
    const [, command, argv, opts] = runChildProcessMock.mock.calls[0]!;
    expect(command).toBe("nlm");
    expect(argv).toEqual(["login", "--check", "--profile", "default"]);
    expect(opts.env.NOTEBOOKLM_MCP_CLI_PATH).toBe("/paperclip/notebooklm");
    expect(opts.env.PAPERCLIP_RUN_ID).toBe("run-1");
    expect(opts.cwd).toBe("/paperclip");
    expect(result.exitCode).toBe(0);
  });

  it("mints PAPERCLIP_API_KEY into the child env only when an authToken is present", async () => {
    runChildProcessMock.mockResolvedValueOnce(processResult());

    await execute(
      baseContext({
        authToken: "run-scoped-jwt",
        config: { subcommand: "notebook", args: ["list"] },
      }),
    );

    const [, , , opts] = runChildProcessMock.mock.calls[0]!;
    expect(opts.env.PAPERCLIP_API_KEY).toBe("run-scoped-jwt");
  });

  it("omits PAPERCLIP_API_KEY entirely when no authToken is supplied", async () => {
    runChildProcessMock.mockResolvedValueOnce(processResult());

    await execute(baseContext({ config: { subcommand: "notebook", args: ["list"] } }));

    const [, , , opts] = runChildProcessMock.mock.calls[0]!;
    expect(opts.env.PAPERCLIP_API_KEY).toBeUndefined();
  });

  it("defaults command to nlm, profile to default, timeoutSec to 60, graceSec to 15", async () => {
    runChildProcessMock.mockResolvedValueOnce(processResult());

    await execute(baseContext({ config: { subcommand: "notebook", args: ["list"] } }));

    const [, command, argv, opts] = runChildProcessMock.mock.calls[0]!;
    expect(command).toBe("nlm");
    expect(argv).toEqual(["notebook", "list", "--profile", "default"]);
    expect(opts.timeoutSec).toBe(60);
    expect(opts.graceSec).toBe(15);
  });

  // NLM-A10: notebooklm_local is deliberately one-shot. A heartbeat or
  // recovery wake may carry generic Paperclip runtime session state, but the
  // adapter must neither consume it nor manufacture a resumable session.
  it("ignores prior runtime session state and returns no session-resume metadata", async () => {
    runChildProcessMock.mockResolvedValueOnce(processResult({ stdout: "[]" }));

    const result = await execute(
      baseContext({
        runtime: {
          sessionId: "stale-session-id",
          sessionParams: { sessionId: "stale-session-id", resume: true },
          sessionDisplayId: "stale-session-id",
          taskKey: "issue-1",
        },
        config: { subcommand: "notebook", args: ["list", "--json"] },
      }),
    );

    expect(result).not.toHaveProperty("sessionId");
    expect(result).not.toHaveProperty("sessionParams");
    expect(result).not.toHaveProperty("sessionDisplayId");
    expect(result).not.toHaveProperty("clearSession");
    expect(runChildProcessMock).toHaveBeenCalledTimes(1);
    expect(runChildProcessMock.mock.calls[0]?.[2]).toEqual([
      "notebook",
      "list",
      "--json",
      "--profile",
      "default",
    ]);
  });
});

describe("notebooklm_local execute — injection rejection", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("throws before spawning anything when the subcommand is outside the allowlisted nlm surface", async () => {
    await expect(
      execute(baseContext({ config: { subcommand: "rm -rf /", args: [] } })),
    ).rejects.toThrow(/not in the allowlisted nlm v0\.9\.14 CLI surface/);
    expect(runChildProcessMock).not.toHaveBeenCalled();
  });

  it("throws when subcommand is missing", async () => {
    await expect(execute(baseContext({ config: { args: ["list"] } }))).rejects.toThrow(
      "missing subcommand",
    );
    expect(runChildProcessMock).not.toHaveBeenCalled();
  });
});

describe("notebooklm_local execute — JSON success", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("parses resultJson.json when --json was explicitly requested", async () => {
    const notebooks = [{ id: "nb-1", title: "Metrology.NET 2.0" }];
    runChildProcessMock.mockResolvedValueOnce(processResult({ stdout: JSON.stringify(notebooks) }));

    const result = await execute(
      baseContext({ config: { subcommand: "notebook", args: ["list", "--json"] } }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.resultJson?.json).toEqual(notebooks);
    expect(result.resultJson?.stdout).toBe(JSON.stringify(notebooks));
  });
});

describe("notebooklm_local execute — raw fallback", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("returns raw stdout only (no json field) when --json was not requested", async () => {
    runChildProcessMock.mockResolvedValueOnce(
      processResult({ stdout: "\u2713 Authentication valid!\n" }),
    );

    const result = await execute(
      baseContext({ config: { subcommand: "login", args: ["--check"] } }),
    );

    expect(result.resultJson?.stdout).toBe("\u2713 Authentication valid!\n");
    expect(result.resultJson?.json).toBeUndefined();
  });
});

describe("notebooklm_local execute — malformed JSON", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("surfaces a jsonParseError and preserves raw stdout instead of throwing", async () => {
    runChildProcessMock.mockResolvedValueOnce(processResult({ stdout: "not json {{{" }));

    const result = await execute(
      baseContext({ config: { subcommand: "notebook", args: ["list", "--json"] } }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.resultJson?.json).toBeNull();
    expect(result.resultJson?.jsonParseError).toMatch(/failed to parse --json stdout as JSON/);
    expect(result.resultJson?.stdout).toBe("not json {{{");
  });
});

describe("notebooklm_local execute — command-not-found", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("returns a structured error result instead of throwing when the nlm binary is missing", async () => {
    runChildProcessMock.mockRejectedValueOnce(
      new Error(
        'Failed to start command "nlm" in "/paperclip". Verify adapter command, working directory, and PATH ().',
      ),
    );

    const result = await execute(
      baseContext({ config: { subcommand: "notebook", args: ["list"] } }),
    );

    expect(result.errorCode).toBe("notebooklm_local_command_not_found");
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it("re-throws an unrelated spawn error rather than misclassifying it", async () => {
    runChildProcessMock.mockRejectedValueOnce(new Error("unexpected internal failure"));

    await expect(
      execute(baseContext({ config: { subcommand: "notebook", args: ["list"] } })),
    ).rejects.toThrow("unexpected internal failure");
  });
});

describe("notebooklm_local execute — auth failure", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("classifies a nonzero exit with expired-cookie output as notebooklm_local_auth_failed", async () => {
    runChildProcessMock.mockResolvedValueOnce(
      processResult({ exitCode: 1, stderr: "Error: Cookies have expired\n" }),
    );

    const result = await execute(
      baseContext({ config: { subcommand: "notebook", args: ["list"] } }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("notebooklm_local_auth_failed");
    expect(result.errorMessage).toMatch(/never performs automatic login/);
  });
});

describe("notebooklm_local execute — timeout", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("returns timedOut:true with notebooklm_local_timeout and bounded stdout/stderr", async () => {
    runChildProcessMock.mockResolvedValueOnce(
      processResult({
        timedOut: true,
        exitCode: null,
        signal: "SIGTERM",
        stdout: "partial output",
        stderr: "",
      }),
    );

    const result = await execute(
      baseContext({ config: { subcommand: "notebook", args: ["list"], timeoutSec: 1 } }),
    );

    expect(result.timedOut).toBe(true);
    expect(result.errorCode).toBe("notebooklm_local_timeout");
    expect(result.errorMessage).toContain("timed out after 1s");
    expect(result.resultJson?.stdout).toBe("partial output");
  });
});

describe("notebooklm_local execute — nonzero exit", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("classifies a nonzero, non-auth exit as notebooklm_local_nonzero_exit", async () => {
    runChildProcessMock.mockResolvedValueOnce(
      processResult({ exitCode: 2, stderr: "Notebook not found\n" }),
    );

    const result = await execute(
      baseContext({ config: { subcommand: "notebook", args: ["get", "bogus-id"] } }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.errorCode).toBe("notebooklm_local_nonzero_exit");
    expect(result.errorMessage).toContain("exited with code 2");
  });
});

describe("notebooklm_local execute — truncation markers", () => {
  beforeEach(() => {
    runChildProcessMock.mockReset();
  });

  it("marks stdout/stderr as truncated in resultJson when they exceed the adapter's bound", async () => {
    const longStdout = "x".repeat(250_000);
    runChildProcessMock.mockResolvedValueOnce(processResult({ stdout: longStdout }));

    const result = await execute(
      baseContext({ config: { subcommand: "notebook", args: ["list"] } }),
    );

    expect(result.resultJson?.stdoutTruncated).toBe(true);
    expect(String(result.resultJson?.stdout)).toContain(
      "\u2026[truncated by Paperclip notebooklm_local adapter]",
    );
  });
});
