// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunForIssue } from "../api/activity";
import { ApiError } from "../api/client";
import { IssueWorkerLogContent } from "./IssueWorkerLog";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={to} {...props}>{children}</a>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function createRun(overrides: Partial<RunForIssue> = {}): RunForIssue {
  return {
    runId: "run-00000000",
    status: "succeeded",
    agentId: "agent-1",
    adapterType: "codex_local",
    startedAt: "2026-08-30T10:00:00.000Z",
    finishedAt: "2026-08-30T10:01:00.000Z",
    createdAt: "2026-08-30T10:00:00.000Z",
    invocationSource: "assignment",
    usageJson: null,
    resultJson: null,
    ...overrides,
  };
}

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function buttonByText(text: string) {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === text) as HTMLButtonElement;
}

function render(props: Partial<React.ComponentProps<typeof IssueWorkerLogContent>> = {}) {
  const loadLog = props.loadLog ?? vi.fn().mockResolvedValue({
    runId: "run-00000000",
    content: "first line\nsecond line\n",
    nextOffset: 23,
  });
  act(() => {
    root.render(
      <IssueWorkerLogContent
        runs={props.runs ?? [createRun()]}
        activeRun={props.activeRun}
        agentMap={props.agentMap ?? new Map([["agent-1", { name: "Codex" }], ["agent-2", { name: "Claude" }]])}
        loadLog={loadLog}
      />,
    );
  });
  return loadLog;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("IssueWorkerLogContent", () => {
  it("shows empty state without attempting log access", () => {
    const loadLog = render({ runs: [] });
    expect(container.textContent).toContain("No worker runs linked to this task.");
    expect(loadLog).not.toHaveBeenCalled();
  });

  it("loads selected run, exposes safe raw text, search, controls, and full run link", async () => {
    const loadLog = render({
      loadLog: vi.fn().mockResolvedValue({
        runId: "run-00000000",
        content: "\u001b[31mhello /private/secret.log\u001b[0m\nworker result",
      }),
    });
    await flush();

    expect(loadLog).toHaveBeenCalledWith("run-00000000", 0, 64_000);
    expect(container.querySelector("pre")?.textContent).toContain("hello [redacted filesystem path]");
    expect(container.querySelector("pre")?.textContent).not.toContain("/private/secret.log");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/agents/agent-1/runs/run-00000000");
    expect(container.querySelector("a")?.textContent).toBe("Full Run Detail");
    expect(container.textContent).toContain("Parsed");
    expect(container.textContent).toContain("Raw log");
    expect(container.textContent).toContain("Wrap lines");
    expect(container.textContent).toContain("Terminal · Succeeded");

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    act(() => setInputValue(search, "worker"));
    expect(container.textContent).toContain("1 match in loaded output");
  });

  it("keeps raw output as text and redacts POSIX, file URL, and Windows paths", async () => {
    render({
      loadLog: vi.fn().mockResolvedValue({
        runId: "run-00000000",
        content: "\u001b[32mfile:///var/private/run.log C:\\worker\\secret.txt \\\\host\\share\\secret.txt /srv/worker/output.log /project-specific/secret.txt https://paperclip.example/run\u001b[0m",
      }),
    });
    await flush();

    const raw = [...container.querySelectorAll("button")].find((item) => item.textContent === "Raw log") as HTMLButtonElement;
    act(() => raw.click());
    const output = container.querySelector("pre")?.textContent ?? "";
    expect(output).toContain("[redacted filesystem path]");
    expect(output).not.toContain("/var/private/run.log");
    expect(output).not.toContain("C:\\worker\\secret.txt");
    expect(output).not.toContain("\\\\host\\share\\secret.txt");
    expect(output).not.toContain("/srv/worker/output.log");
    expect(output).not.toContain("/project-specific/secret.txt");
    expect(output).toContain("https://paperclip.example/run");
    expect(container.querySelector("pre")?.querySelector("span")).toBeNull();
  });

  it("loads next bounded page and stops after eight chunks", async () => {
    const loadLog = vi.fn().mockImplementation(async (_runId: string, offset: number) => ({
      runId: "run-00000000",
      content: `page-${offset}\n`,
      nextOffset: offset + 1,
    }));
    render({ loadLog });
    await flush();

    for (let index = 0; index < 7; index += 1) {
      const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Load more") as HTMLButtonElement;
      act(() => button.click());
      await flush();
    }

    expect(loadLog).toHaveBeenCalledTimes(8);
    expect(container.textContent).toContain("loading limit reached");
    expect([...container.querySelectorAll("button")].some((item) => item.textContent === "Load more")).toBe(false);
  });

  it("shows authorization and missing-log errors with retry", async () => {
    const denied = vi.fn().mockRejectedValue(new ApiError("Forbidden", 403, null));
    render({ loadLog: denied });
    await flush();
    expect(container.textContent).toContain("You do not have permission to view this worker log.");
    expect(container.textContent).toContain("Retry");

    act(() => ([...container.querySelectorAll("button")].find((item) => item.textContent === "Retry") as HTMLButtonElement).click());
    await flush();
    expect(denied).toHaveBeenCalledTimes(2);
  });

  it("enables auto-follow only for active run and stops it after scrolling away", async () => {
    render({ runs: [createRun({ status: "running", finishedAt: null })] });
    await flush();
    const follow = [...container.querySelectorAll('input[type="checkbox"]')].find((input) => (input.parentElement?.textContent ?? "").includes("Auto-follow")) as HTMLInputElement;
    expect(follow.checked).toBe(true);
    expect(container.textContent).toContain("Running · live");

    const pre = container.querySelector("pre") as HTMLPreElement;
    Object.defineProperties(pre, { scrollHeight: { configurable: true, value: 100 }, clientHeight: { configurable: true, value: 20 }, scrollTop: { configurable: true, writable: true, value: 0 } });
    act(() => pre.dispatchEvent(new Event("scroll")));
    expect(follow.checked).toBe(false);
  });

  it("switches selected run, reloads from offset zero, clears search, and lists duration", async () => {
    const loadLog = vi.fn()
      .mockResolvedValueOnce({ runId: "run-11111111", content: "first run output\n", nextOffset: undefined })
      .mockResolvedValue({ runId: "run-22222222", content: "second run output\n", nextOffset: undefined });
    render({
      runs: [
        createRun({ runId: "run-11111111", agentId: "agent-1" }),
        createRun({ runId: "run-22222222", agentId: "agent-2", startedAt: "2026-08-30T09:00:00.000Z", finishedAt: "2026-08-30T09:00:30.000Z", createdAt: "2026-08-30T09:00:00.000Z" }),
      ],
      loadLog,
    });
    await flush();
    expect(container.querySelector("pre")?.textContent).toContain("first run output");

    const select = container.querySelector('select[aria-label="Task run"]') as HTMLSelectElement;
    // TVR-W02: selector lists short id, agent name, status, start time, and duration.
    expect(select.options[1].textContent).toContain("run-2222");
    expect(select.options[1].textContent).toContain("Claude");
    expect(select.options[1].textContent).toContain("Succeeded");
    expect(select.options[1].textContent).toContain("30s");

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    act(() => setInputValue(search, "first"));
    act(() => setSelectValue(select, "run-22222222"));
    await flush();

    expect(loadLog).toHaveBeenCalledWith("run-22222222", 0, 64_000);
    expect(container.querySelector("pre")?.textContent).toContain("second run output");
    expect(container.querySelector("pre")?.textContent).not.toContain("first run output");
    expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe("");
  });

  it("ignores stale log responses from a run the user already switched away from", async () => {
    let resolveFirst!: (value: { runId: string; content: string; nextOffset?: number }) => void;
    const first = new Promise<{ runId: string; content: string; nextOffset?: number }>((resolve) => { resolveFirst = resolve; });
    const loadLog = vi.fn((runId: string) => (runId === "run-11111111" ? first : Promise.resolve({ runId: "run-22222222", content: "second run output\n", nextOffset: undefined })));
    render({
      runs: [
        createRun({ runId: "run-11111111", agentId: "agent-1" }),
        createRun({ runId: "run-22222222", agentId: "agent-2", startedAt: "2026-08-30T09:00:00.000Z", createdAt: "2026-08-30T09:00:00.000Z" }),
      ],
      loadLog,
    });
    await flush();

    const select = container.querySelector('select[aria-label="Task run"]') as HTMLSelectElement;
    act(() => setSelectValue(select, "run-22222222"));
    await flush();
    expect(container.querySelector("pre")?.textContent).toContain("second run output");

    act(() => { resolveFirst({ runId: "run-11111111", content: "stale first run content\n", nextOffset: undefined }); });
    await flush();
    expect(container.querySelector("pre")?.textContent).toContain("second run output");
    expect(container.querySelector("pre")?.textContent).not.toContain("stale first run content");
  });

  it("parsed view strips ANSI escapes while raw view preserves the redacted stored text", async () => {
    render({
      loadLog: vi.fn().mockResolvedValue({
        runId: "run-00000000",
        content: "\u001b[32mok /tmp/secret\u001b[0m tail",
        nextOffset: undefined,
      }),
    });
    await flush();

    let output = container.querySelector("pre")?.textContent ?? "";
    expect(output).toContain("ok [redacted filesystem path] tail");
    expect(output).not.toContain("\u001b");

    act(() => buttonByText("Raw log").click());
    output = container.querySelector("pre")?.textContent ?? "";
    expect(output).toContain("\u001b[32m");
    expect(output).not.toContain("/tmp/secret");
  });

  it("renders log HTML as inert text and never injects elements", async () => {
    render({
      loadLog: vi.fn().mockResolvedValue({
        runId: "run-00000000",
        content: "<svg onload=alert(1)><img src=x onerror=alert(1)>done<script>window.pwned = true</script>",
        nextOffset: undefined,
      }),
    });
    await flush();

    const output = container.querySelector("pre")?.textContent ?? "";
    // Slash-free unsafe markup survives verbatim as inert text.
    expect(output).toContain("<svg onload=alert(1)>");
    expect(output).toContain("<img src=x onerror=alert(1)>");
    expect(output).toContain("done");
    // Slash-bearing tags are additionally path-redacted, still never parsed.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((globalThis as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it("transitions a live run to terminal: auto-follow removed and terminal status shown", async () => {
    render({ runs: [createRun({ status: "running", finishedAt: null })] });
    await flush();
    expect(container.textContent).toContain("Running · live");
    const follow = [...container.querySelectorAll('input[type="checkbox"]')].find((input) => (input.parentElement?.textContent ?? "").includes("Auto-follow")) as HTMLInputElement;
    expect(follow.checked).toBe(true);

    render({ runs: [createRun({ status: "succeeded", finishedAt: "2026-08-30T10:01:00.000Z" })] });
    await flush();
    expect(container.textContent).toContain("Terminal · Succeeded");
    expect([...container.querySelectorAll('input[type="checkbox"]')].some((input) => (input.parentElement?.textContent ?? "").includes("Auto-follow"))).toBe(false);
  });

  it("shows a rotated/unavailable message for 404 and recovers via retry", async () => {
    const missing = vi.fn().mockRejectedValue(new ApiError("Not Found", 404, null));
    render({ loadLog: missing });
    await flush();
    expect(container.textContent).toContain("Worker log is unavailable or has been rotated.");

    act(() => buttonByText("Retry").click());
    await flush();
    expect(missing).toHaveBeenCalledTimes(2);
  });

  it("shows network errors with retry while keeping the last successful content", async () => {
    const loadLog = vi.fn()
      .mockResolvedValueOnce({ runId: "run-00000000", content: "stable output\n", nextOffset: 12 })
      .mockRejectedValueOnce(new Error("network down"));
    render({ loadLog });
    await flush();
    expect(container.querySelector("pre")?.textContent).toContain("stable output");

    act(() => buttonByText("Load more").click());
    await flush();
    expect(container.textContent).toContain("network down");
    expect(container.textContent).toContain("Retry");
    expect(container.querySelector("pre")?.textContent).toContain("stable output");
  });

  it("keeps controls usable in a single-column narrow layout", async () => {
    render();
    await flush();
    const select = container.querySelector('select[aria-label="Task run"]') as HTMLSelectElement;
    expect(select.className).toContain("w-full");
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(search.className).toContain("w-full");
    const toolbar = [...container.querySelectorAll("div")].find((div) => (div.className ?? "").includes("flex-wrap") && (div.textContent ?? "").includes("Wrap lines"));
    expect(toolbar).toBeTruthy();
    const header = [...container.querySelectorAll("div")].find((div) => (div.className ?? "").includes("flex-wrap") && (div.textContent ?? "").includes("Worker Log"));
    expect(header).toBeTruthy();
    expect((container.querySelector("pre")?.className ?? "").includes("overflow-auto")).toBe(true);
    expect((container.querySelector("pre")?.className ?? "").includes("max-h-96")).toBe(true);
  });
});
