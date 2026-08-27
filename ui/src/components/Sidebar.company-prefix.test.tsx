// @vitest-environment jsdom

// Regression guard for the T3 scheduling release bug: the Sidebar's Today /
// Schedule / Scheduling Routines / Goals / Projects / Artifacts nav items must
// generate company-prefixed hrefs (`/PAP/today`, `/PAP/schedule`,
// `/PAP/schedule/routines`, ...). Before the fix, `today` and `schedule` were
// missing from BOARD_ROUTE_ROOTS, so the router's `applyCompanyPrefix` treated
// the first path segment as a company prefix ("TODAY"/"SCHEDULE") and left the
// hrefs unprefixed — clicking them 404'd with
// `No company matches prefix "SCHEDULE"`.
//
// Unlike Sidebar.test.tsx (which mocks `@/lib/router` to assert raw `to`
// values), this suite renders the REAL company-aware NavLink so the emitted
// href is the actual generated URL.

import { type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockHeartbeatsApi = vi.hoisted(() => ({
  liveRunsForCompany: vi.fn(),
}));

const mockAttentionApi = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    openNewIssue: vi.fn(),
  }),
  useDialogActions: () => ({
    openNewIssue: vi.fn(),
  }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [
      { id: "company-1", issuePrefix: "PAP", name: "Paperclip", status: "active" },
    ],
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", issuePrefix: "PAP", name: "Paperclip" },
    loading: false,
  }),
}));

const mockSidebar = vi.hoisted(() => ({
  isMobile: false,
  setSidebarOpen: vi.fn(),
  collapsed: false,
  collapseLocked: false,
  peeking: false,
  toggleCollapsed: vi.fn(),
  setCollapsed: vi.fn(),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => mockSidebar,
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: mockHeartbeatsApi,
}));

vi.mock("../api/attention", () => ({
  attentionApi: mockAttentionApi,
}));

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("../hooks/useInboxBadge", () => ({
  useInboxBadge: () => ({ inbox: 0, failedRuns: 0 }),
}));

vi.mock("@/plugins/slots", () => ({
  PluginSlotOutlet: ({ slotTypes }: { slotTypes: string[] }) => (
    <div data-plugin-slot-types={slotTypes.join(",")}>Plugin slot outlet</div>
  ),
}));

vi.mock("@/plugins/launchers", () => ({
  PluginLauncherOutlet: ({ placementZones }: { placementZones: string[] }) => (
    <div data-plugin-launcher-zone={placementZones.join(",")}>Plugin launcher outlet</div>
  ),
}));

vi.mock("./SidebarCompanyMenu", () => ({
  SidebarCompanyMenu: () => <div>Company menu</div>,
}));

vi.mock("./SidebarAgents", () => ({
  SidebarAgents: ({ streamlined }: { streamlined?: boolean }) => (
    <div data-testid="sidebar-agents" data-streamlined={String(streamlined)} />
  ),
}));

vi.mock("./SidebarProjects", () => ({
  SidebarProjects: () => <div data-testid="sidebar-projects">Projects collapsible</div>,
}));

vi.mock("./SidebarStarredProjects", () => ({
  SidebarStarredProjects: () => <div data-testid="sidebar-starred-projects" />,
}));

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("Sidebar company-prefixed navigation hrefs", () => {
  let container: HTMLDivElement;

  // Render the real Sidebar inside the real company-prefixed route layout
  // (`/:companyPrefix/*`), mirroring how <App> mounts it — so
  // useActiveCompanyPrefix resolves "PAP" from the URL params.
  async function renderSidebarAt(path: string) {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/:companyPrefix/*" element={<Sidebar />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    return root;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([]);
    mockAttentionApi.list.mockResolvedValue({ items: [] });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      enableGoalsSidebarLink: true,
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  function hrefByLabel(label: string): string | null {
    const link = [...container.querySelectorAll("nav a")].find(
      (anchor) => anchor.textContent?.trim() === label,
    );
    return link?.getAttribute("href") ?? null;
  }

  it("generates company-prefixed hrefs for Today, Schedule and Scheduling Routines", async () => {
    const root = await renderSidebarAt("/PAP/dashboard");

    expect(hrefByLabel("Today")).toBe("/PAP/today");
    expect(hrefByLabel("Schedule")).toBe("/PAP/schedule");
    expect(hrefByLabel("Scheduling Routines")).toBe("/PAP/schedule/routines");

    flushSync(() => root.unmount());
  });

  it("generates company-prefixed hrefs for Goals, Projects and Artifacts", async () => {
    const root = await renderSidebarAt("/PAP/schedule");

    expect(hrefByLabel("Goals")).toBe("/PAP/goals");
    expect(hrefByLabel("Projects")).toBe("/PAP/projects");
    expect(hrefByLabel("Artifacts")).toBe("/PAP/artifacts");

    flushSync(() => root.unmount());
  });

  it("never emits an unprefixed scheduling href or a route word as the company segment", async () => {
    const root = await renderSidebarAt("/PAP/today");

    const hrefs = [...container.querySelectorAll("nav a")]
      .map((anchor) => anchor.getAttribute("href"))
      .filter((href): href is string => Boolean(href));

    expect(hrefs).not.toContain("/today");
    expect(hrefs).not.toContain("/schedule");
    expect(hrefs).not.toContain("/schedule/routines");
    expect(hrefs.some((href) => href.startsWith("/SCHEDULE/"))).toBe(false);
    expect(hrefs.some((href) => href.startsWith("/TODAY/"))).toBe(false);

    // Every board nav href carries the active company prefix.
    for (const href of hrefs) {
      expect(href.startsWith("/PAP/")).toBe(true);
    }

    flushSync(() => root.unmount());
  });
});
