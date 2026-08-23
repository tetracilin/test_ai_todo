// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardChat } from "./BoardChat";

/**
 * K10 gateway-stream render coverage: sending a board-chat message must
 * consume the backend's SSE stream (`POST /api/board/chat/stream` — the
 * Hermes Gateway AI flow) and render the streamed chunks. No model/provider
 * URL or key is ever involved client-side; the fetch is same-origin `/api`.
 *
 * The stream is faked with a ReadableStream of `data: {...}\n\n` frames, so
 * this exercises the real client-side SSE parsing loop in BoardChat.
 */

const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockGoalsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockIssuesApi = vi.hoisted(() => ({
  list: vi.fn(),
  listComments: vi.fn(),
  listFeedbackVotes: vi.fn(),
}));
const mockDialogState = vi.hoisted(() => ({ onboardingOpen: false }));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/goals", () => ({ goalsApi: mockGoalsApi }));
vi.mock("../api/issues", () => ({ issuesApi: mockIssuesApi }));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Acme Robotics", issuePrefix: "PAP" },
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogState: () => ({ onboardingOpen: mockDialogState.onboardingOpen }),
}));

// Heavy children that are irrelevant to the stream-render flow under test.
vi.mock("../components/ActivityFeed", () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}));
vi.mock("../components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../components/AgentBubbleActionRow", () => ({
  AgentBubbleActionRow: () => null,
  agentBubbleDateLabel: () => "",
}));
vi.mock("../components/AgentIconPicker", () => ({
  AgentIcon: () => null,
}));
// ChatComposer renders Radix tooltips; stub the primitives so no
// TooltipProvider is needed.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Minimal flushSync-based act replacement (repo convention — no testing-library). */
async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

const CEO_AGENT = {
  id: "agent-ceo",
  name: "Alex",
  role: "ceo",
  status: "active",
  icon: null,
};
const BOARD_ISSUE = { id: "issue-board", title: "Board Operations", status: "in_progress" };

/** Controller handle so a test can stream frames incrementally. */
type StreamingResponse = { response: Response; push: (event: object) => void; close: () => void };

/** Build a `Response` whose body is a still-open SSE byte stream the test feeds frame by frame. */
function openSseResponse(): StreamingResponse {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
  return {
    response,
    push: (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    close: () => controller.close(),
  };
}

describe("BoardChat renders the gateway SSE stream (K10)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    container = document.createElement("div");
    document.body.appendChild(container);
    mockDialogState.onboardingOpen = false;
    mockAgentsApi.list.mockResolvedValue([CEO_AGENT]);
    mockGoalsApi.list.mockResolvedValue([
      { id: "goal-1", title: "Build affordable robots", status: "active" },
    ]);
    mockIssuesApi.list.mockResolvedValue([BOARD_ISSUE]);
    mockIssuesApi.listComments.mockResolvedValue([]);
    mockIssuesApi.listFeedbackVotes.mockResolvedValue([]);
    // A user comment already exists so the staged intro reveal is skipped and
    // the composer is immediately interactive.
    mockIssuesApi.listComments.mockResolvedValue([
      {
        id: "comment-user-1",
        body: "Hi Alex!",
        authorAgentId: null,
        authorUserId: "user-1",
        createdAt: "2026-06-10T00:00:00.000Z",
      },
    ]);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function render() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <BoardChat />
        </QueryClientProvider>,
      );
    });
    // Let the agent/goal/issue/comment queries settle (react-query batches
    // through zero-delay timers).
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function composerInput() {
    return container.querySelector<HTMLTextAreaElement>(
      '[data-testid="chat-composer-input"]',
    );
  }

  // React tracks textarea values internally: assigning `.value` directly and
  // dispatching "input" is a no-op for onChange because the value tracker
  // sees no change. Use the prototype chain's native setter (what
  // @testing-library's `type` does) so React records the new value.
  function setNativeValue(el: HTMLTextAreaElement, value: string) {
    let proto: object | null = Object.getPrototypeOf(el);
    while (proto && proto !== Object.prototype) {
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) {
        desc.set.call(el, value);
        return;
      }
      proto = Object.getPrototypeOf(proto);
    }
    el.value = value;
  }

  async function submitMessage(text: string) {
    const textarea = composerInput();
    expect(textarea).not.toBeNull();
    await act(async () => {
      setNativeValue(textarea!, text);
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Plain Enter submits (submitKey="enter").
    await act(async () => {
      textarea!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    // Flush the streaming read loop (microtasks + zero-delay macrotasks).
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  it("POSTs to the same-origin gateway endpoint and renders streamed chunks live", async () => {
    await render();

    const stream = openSseResponse();
    fetchMock.mockResolvedValue(stream.response);
    vi.stubGlobal("fetch", fetchMock);

    await submitMessage("Summarize the company");

    // The request went to the backend's same-origin SSE endpoint with a JSON
    // body carrying the message — no provider URL, no credentials.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/board/chat/stream");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    const payload = JSON.parse(String(init?.body));
    expect(payload.message).toBe("Summarize the company");
    expect(payload.companyId).toBe("company-1");

    // Stream the first chunk and status frame while the stream is still
    // open — the client must render streamed text incrementally.
    await act(async () => {
      stream.push({ type: "start", issueId: "issue-board" });
      stream.push({ type: "chunk", text: "Hello from " });
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(container.textContent).toContain("Hello from ");
    expect(container.textContent).toContain("Summarize the company");

    // Finish the stream; remaining chunks concatenate into the same reply.
    await act(async () => {
      stream.push({ type: "status", text: "Writing…" });
      stream.push({ type: "chunk", text: "the gateway." });
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    // The full reply was assembled live from the two streamed chunks.
    expect(container.textContent).toContain("Hello from the gateway.");

    // Closing the stream ends the send cycle (the persisted reply then
    // arrives through the refetched comments query).
    await act(async () => {
      stream.push({ type: "done", issueId: "issue-board" });
      stream.close();
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  });

  it("surfaces the stream's error event when the gateway reports one", async () => {
    await render();

    const stream = openSseResponse();
    fetchMock.mockResolvedValue(stream.response);
    vi.stubGlobal("fetch", fetchMock);

    await submitMessage("Hello?");

    // The error frame arrives while the stream is still open.
    await act(async () => {
      stream.push({ type: "error", message: "Gateway unavailable" });
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    // Close the stream — the notice renders only after the send cycle ends
    // (`errorText && !sending` in BoardChat).
    await act(async () => {
      stream.close();
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Gateway unavailable",
    );
  });
});
