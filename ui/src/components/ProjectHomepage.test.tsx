// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHomepage } from "./ProjectHomepage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockProjectsApi = vi.hoisted(() => ({ homepage: vi.fn(), addHomepageResource: vi.fn() }));
vi.mock("../api/projects", () => ({ projectsApi: mockProjectsApi }));

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

describe("ProjectHomepage", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockProjectsApi.homepage.mockResolvedValue({
      project: { id: "project-1", name: "Website refresh" },
      goals: [{ id: "goal-1", title: "Increase adoption", href: "/goals/goal-1" }],
      resources: [{ id: "resource-1", title: "Research brief", url: "https://docs.example.com/research", addedBy: { id: "member-1", name: "Ada" } }],
      channels: { discordUrl: "https://discord.com/channels/1/2", whatsappUrl: "https://chat.whatsapp.com/example" },
      documents: [{ id: "doc-1", title: "Requirements", type: "markdown", creator: { id: "member-1", name: "Ada" }, href: "/issues/PAP-1#document-requirements" }],
      artifacts: [{ id: "artifact-1", title: "prototype.png", type: "image/png", creator: { id: "member-1", name: "Ada" }, href: "/issues/PAP-1#artifact-artifact-1" }],
    });
  });

  afterEach(async () => {
    await act(() => root?.unmount());
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  async function renderHomepage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProjectHomepage projectId="project-1" companyId="company-1" />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("shows project goals, safe channel links, resources, documents, and artifacts", async () => {
    await renderHomepage();

    expect(container.textContent).toContain("Increase adoption");
    expect(container.querySelector('a[href="/goals/goal-1"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://discord.com/channels/1/2"]')?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector('a[href="https://chat.whatsapp.com/example"]')?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("Research brief");
    expect(container.textContent).toContain("Requirements");

    const artifactsTab = Array.from(container.querySelectorAll('[role="tab"]')).find((node) => node.textContent?.includes("Artifacts"));
    await act(() => (artifactsTab as HTMLButtonElement).click());
    expect(container.textContent).toContain("prototype.png");
  });

  it("renders empty states", async () => {
    mockProjectsApi.homepage.mockResolvedValueOnce({
      project: { id: "project-1", name: "Empty" },
      goals: [],
      resources: [],
      channels: { discordUrl: null, whatsappUrl: null },
      documents: [],
      artifacts: [],
    });

    await renderHomepage();

    expect(container.textContent).toContain("No goals linked yet.");
    expect(container.textContent).toContain("No resources added yet.");
    expect(container.textContent).toContain("No documents created by project members.");
  });
});
