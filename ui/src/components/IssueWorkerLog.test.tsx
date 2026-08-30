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
        agentMap={props.agentMap ?? new Map([["agent-1", { name: "Codex" }]])}
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

    const pre = container.querySelector("pre") as HTMLPreElement;
    Object.defineProperties(pre, { scrollHeight: { configurable: true, value: 100 }, clientHeight: { configurable: true, value: 20 }, scrollTop: { configurable: true, writable: true, value: 0 } });
    act(() => pre.dispatchEvent(new Event("scroll")));
    expect(follow.checked).toBe(false);
  });

  it("lists duration and retry relation in the run selector (TVR-W02)", async () => {
    render({
      runs: [
        createRun({ runId: "run-aaaa" }),
        createRun({
          runId: "run-bbbb",
          retryOfRunId: "run-aaaa",
          startedAt: "2026-08-30T11:00:00.000Z",
          finishedAt: "2026-08-30T11:02:30.000Z",
        }),
      ],
    });
    await flush();

    // Newest first: the retry lands at index 0.
    const options = [...container.querySelectorAll("option")];
    expect(options[0]?.textContent).toContain("run-bbbb");
    expect(options[0]?.textContent).toContain("2m 30s");
    expect(options[0]?.textContent).toContain("retry of run-aaaa");
    // The original run keeps its own 60s duration and no retry relation.
    expect(options[1]?.textContent).toContain("run-aaaa");
    expect(options[1]?.textContent).toContain("1m");
    expect(options[1]?.textContent).not.toContain("retry of");
  });

  it("marks a live run as active instead of a duration in the selector (TVR-W02)", async () => {
    render({ runs: [createRun({ status: "running", finishedAt: null })] });
    await flush();
    const option = container.querySelector("option");
    expect(option?.textContent).toContain("running");
    expect(option?.textContent).toContain("active");
    expect(option?.textContent).not.toContain("duration");
  });
});
