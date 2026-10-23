import { describe, expect, it } from "vitest";
import type { AdapterExecutionContext } from "../types.js";
import { execute } from "./execute.js";

// Characterization tests: they pin the process adapter's current behaviour
// before the upstream adapter fixes land. The child is the running Node binary,
// so the tests behave the same on Linux, macOS and Windows.
const node = process.execPath;

function buildContext(
  config: Record<string, unknown>,
  extra: Partial<AdapterExecutionContext> = {},
): AdapterExecutionContext {
  return {
    runId: "run-process-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Agent",
      adapterType: "process",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config,
    context: {},
    onLog: async () => {},
    ...extra,
  };
}

function stdoutOf(result: Awaited<ReturnType<typeof execute>>): string {
  return String((result.resultJson as { stdout?: unknown } | null | undefined)?.stdout ?? "");
}

describe("process adapter execute", () => {
  it("throws when no command is configured", async () => {
    await expect(execute(buildContext({}))).rejects.toThrow("Process adapter missing command");
  });

  it("returns the child's stdout on a zero exit", async () => {
    const result = await execute(buildContext({
      command: node,
      args: ["-e", "process.stdout.write('hello from child')"],
    }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.errorMessage).toBeUndefined();
    expect(stdoutOf(result)).toContain("hello from child");
  });

  it("reports a non-zero exit with the exit code and keeps stderr", async () => {
    const result = await execute(buildContext({
      command: node,
      args: ["-e", "process.stderr.write('boom'); process.exit(3)"],
    }));

    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toBe("Process exited with code 3");
    expect(String((result.resultJson as { stderr?: unknown }).stderr)).toContain("boom");
  });

  it("passes the run id and the harness token, never a configured PAPERCLIP_API_KEY", async () => {
    const result = await execute(buildContext(
      {
        command: node,
        args: ["-e", "process.stdout.write(JSON.stringify({ run: process.env.PAPERCLIP_RUN_ID, key: process.env.PAPERCLIP_API_KEY, custom: process.env.CUSTOM_VALUE }))"],
        env: { PAPERCLIP_API_KEY: "from-config", CUSTOM_VALUE: "kept" },
      },
      { authToken: "harness-token" },
    ));

    const env = JSON.parse(stdoutOf(result)) as { run?: string; key?: string; custom?: string };
    expect(env.run).toBe("run-process-1");
    expect(env.key).toBe("harness-token");
    expect(env.custom).toBe("kept");
  });

  it("reports a timeout when the child outlives timeoutSec", async () => {
    const result = await execute(buildContext({
      command: node,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      timeoutSec: 1,
      graceSec: 1,
    }));

    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toBe("Timed out after 1s");
  }, 20_000);
});
