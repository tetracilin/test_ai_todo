// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentPanelChat, documentPanelCommentsKey, taskChatDraftKey } from "./DocumentPanelChat";

const mockListComments = vi.hoisted(() => vi.fn());
const mockAddComment = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const threadProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock("../api/issues", () => ({
  issuesApi: { listComments: mockListComments, addComment: mockAddComment, get: mockGet, update: mockUpdate },
}));
vi.mock("./TaskChatThread", () => ({
  TaskChatThread: (props: Record<string, unknown>) => {
    threadProps.current = props;
    return <div data-testid="thread">{(props.comments as { body: string }[]).map((c) => c.body).join(",")}</div>;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => Promise<void>> = [];

async function renderChat(
  issueId: string | null,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DocumentPanelChat issueId={issueId} companyId="c1" projectId="p1" />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
  });
  return container;
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  document.body.innerHTML = "";
  threadProps.current = null;
  vi.clearAllMocks();
});

describe("DocumentPanelChat", () => {
  it("shows the comments of the task and uses its own draft key", async () => {
    mockListComments.mockResolvedValue([{ id: "m1", body: "hello" }]);
    const container = await renderChat("i1");
    expect(mockListComments).toHaveBeenCalledWith("i1", { order: "asc" });
    expect(container.textContent).toContain("hello");
    expect(threadProps.current?.draftKey).toBe(taskChatDraftKey("i1"));
    expect(taskChatDraftKey("i1")).toBe("paperclip:document-panel-chat-draft:i1");
  });

  it("sends a message to the task and reloads the comments", async () => {
    mockListComments.mockResolvedValue([]);
    mockAddComment.mockResolvedValue({});
    await renderChat("i1");
    const onAdd = threadProps.current?.onAdd as (body: string, reopen?: boolean) => Promise<void>;
    await act(async () => {
      await onAdd("hi there", true);
    });
    expect(mockAddComment).toHaveBeenCalledWith("i1", "hi there", true);
    expect(mockListComments.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not touch the infinite-query data the task page keeps for the same task", async () => {
    mockListComments.mockResolvedValue([{ id: "m1", body: "hello" }]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const infinite = { pages: [[{ id: "x", body: "page" }]], pageParams: [null] };
    queryClient.setQueryData(["issues", "comments", "i1"], infinite);
    const container = await renderChat("i1", queryClient);
    expect(container.textContent).toContain("hello");
    expect(queryClient.getQueryData(["issues", "comments", "i1"])).toBe(infinite);
    expect(documentPanelCommentsKey("i1")).not.toEqual(["issues", "comments", "i1"]);
  });

  it("passes the saved work mode and saves a changed one on the task", async () => {
    mockListComments.mockResolvedValue([]);
    mockGet.mockResolvedValue({ id: "i1", workMode: "ask" });
    mockUpdate.mockResolvedValue({});
    await renderChat("i1");
    expect(threadProps.current?.issueWorkMode).toBe("ask");
    const change = threadProps.current?.onWorkModeChange as (mode: string) => Promise<void>;
    await act(async () => {
      await change("planning");
    });
    expect(mockUpdate).toHaveBeenCalledWith("i1", { workMode: "planning" });
  });

  it("shows a placeholder without a task", async () => {
    const container = await renderChat(null);
    expect(container.textContent).toBe("Task chat");
    expect(mockListComments).not.toHaveBeenCalled();
  });
});
