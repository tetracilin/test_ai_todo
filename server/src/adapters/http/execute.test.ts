import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "../types.js";
import { setAdapterDeploymentMode } from "../deployment-policy.js";
import { execute } from "./execute.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setAdapterDeploymentMode("local_trusted");
});

function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  }));
}

function okFetch() {
  return vi.fn(async () => new Response(null, { status: 200 }));
}

function buildContext(
  config: Record<string, unknown>,
  onLog: AdapterExecutionContext["onLog"] = async () => {},
): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Agent",
      adapterType: "http",
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
    onLog,
  };
}

describe("http adapter execute", () => {
  it("reports configured request timeout as timed_out", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const result = await execute(buildContext({ url: "https://example.test/webhook", timeoutMs: 1 }));

    expect(result.timedOut).toBe(true);
    expect(result.errorCode).toBe("timeout");
    expect(result.errorMessage).toContain("timed out after 1ms");
  });

  it("honours the documented timeoutSec field", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const result = await execute(buildContext({ url: "https://example.test/webhook", timeoutSec: 0.002 }));

    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain("timed out after 2ms");
  });

  it("lets timeoutMs win when both timeout fields are set", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const result = await execute(
      buildContext({ url: "https://example.test/webhook", timeoutMs: 1, timeoutSec: 3600 }),
    );

    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain("timed out after 1ms");
  });

  it("applies a 30 second default timeout when none is configured", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const pending = execute(buildContext({ url: "https://example.test/webhook" }));
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain("timed out after 30000ms");
  });

  it("reads a stored legacy timeoutMs of 0 as the default and logs a warning", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const logs: string[] = [];

    const pending = execute(
      buildContext({ url: "https://example.test/webhook", timeoutMs: 0 }, async (stream, chunk) => {
        if (stream === "stderr") logs.push(chunk);
      }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain("timed out after 30000ms");
    expect(logs.join("")).toContain("timeout of 0");
  });

  it("redacts the URL query string from the run summary", async () => {
    vi.stubGlobal("fetch", okFetch());

    const result = await execute(
      buildContext({ url: "https://example.test/webhook?token=secret-value&x=1" }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("HTTP POST https://example.test/webhook");
    expect(result.summary).not.toContain("secret-value");
  });

  it("redacts the URL query string from the timeout message", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const result = await execute(
      buildContext({ url: "https://example.test/webhook?token=secret-value", timeoutMs: 1 }),
    );

    expect(result.errorMessage).not.toContain("secret-value");
  });

  it("refuses to run in authenticated deployment mode", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    setAdapterDeploymentMode("authenticated");

    const result = await execute(buildContext({ url: "https://example.test/webhook" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.exitCode).toBeNull();
    expect(result.errorCode).toBe("adapter_disabled_authenticated_mode");
    expect(result.errorMessage).toContain("authenticated");
  });

  it("still runs in local_trusted deployment mode", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    setAdapterDeploymentMode("local_trusted");

    const result = await execute(buildContext({ url: "https://example.test/webhook" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
  });
});
