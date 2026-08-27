// @vitest-environment jsdom

// Regression guard for the T3 scheduling release bug: the Today / Schedule /
// Scheduling Routines / Goals nav emits *unprefixed* links (`/today`,
// `/schedule`, `/schedule/routines`, `/goals`) — the same global-unprefixed
// pattern Cases and Pipelines use. Those only resolve if the route roots are
// registered as reserved unprefixed redirect routes in <App> AND listed in
// BOARD_ROUTE_ROOTS (lib/company-routes) so the first path segment is never
// parsed as a company prefix; otherwise the page 404s with
// `No company matches prefix "SCHEDULE"`. This drives the real <App> route
// table so a future removal of those redirect routes fails loudly.

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// jsdom's CSS parser rejects the custom-property marker rule stitches inserts
// (`--sxs{--sxs:N}`), pulled into <App>'s eager import graph transitively via
// @codesandbox/sandpack-react. Substitute a benign, valid rule on parse failure
// so stitches' index bookkeeping stays intact and the module graph evaluates.
// (sandpack itself is never exercised by the routing under test.)
vi.hoisted(() => {
  const sheetProto = window.CSSStyleSheet.prototype as unknown as {
    insertRule: (rule: string, index?: number) => number;
    __schedulingRoutingPatched?: boolean;
  };
  if (!sheetProto.__schedulingRoutingPatched) {
    const original = sheetProto.insertRule;
    sheetProto.insertRule = function patched(this: CSSStyleSheet, rule: string, index?: number) {
      try {
        return original.call(this, rule, index);
      } catch {
        try {
          return original.call(this, ".scheduling-routing-noop{}", index);
        } catch {
          return this.cssRules?.length ?? 0;
        }
      }
    };
    sheetProto.__schedulingRoutingPatched = true;
  }
});

// Real Layout renders the full authenticated shell (sidebar, data queries) and
// owns the "No company matches prefix" NotFound. For routing we only need it to
// resolve the :companyPrefix segment and render its nested routes.
vi.mock("./components/Layout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { Layout: () => <Outlet /> };
});

// Rendered by <App> outside <Routes> and needs DialogProvider; irrelevant here.
vi.mock("./components/OnboardingWizardVariant", () => ({
  OnboardingWizardVariant: () => null,
}));

// Sentinel pages so we can assert *which* route resolved — a sentinel only
// renders when the unprefixed path redirected onto the company-prefixed route
// that mounts that page.
vi.mock("./pages/Today", () => ({ Today: () => <div>TODAY_PAGE</div> }));
vi.mock("./pages/Schedule", () => ({ Schedule: () => <div>SCHEDULE_PAGE</div> }));
vi.mock("./pages/SchedulingRoutines", () => ({
  SchedulingRoutines: () => <div>SCHEDULING_ROUTINES_PAGE</div>,
}));
vi.mock("./pages/Goals", () => ({ Goals: () => <div>GOALS_PAGE</div> }));
vi.mock("./pages/GoalDetail", () => ({ GoalDetail: () => <div>GOAL_DETAIL_PAGE</div> }));
vi.mock("./pages/Projects", () => ({ Projects: () => <div>PROJECTS_PAGE</div> }));
vi.mock("./pages/Artifacts", () => ({ Artifacts: () => <div>ARTIFACTS_PAGE</div> }));

// Cloud access is unrelated to the route-table regression. Let it fall through
// synchronously so this test does not poll its three query transitions.
vi.mock("./components/CloudAccessGate", async () => {
  const { Outlet } = await import("react-router-dom");
  return { CloudAccessGate: () => <Outlet /> };
});

// The prefix resolver + redirect logic both read the active company.
const PAP_COMPANY = {
  id: "company-1",
  name: "Paperclip",
  issuePrefix: "PAP",
  status: "active",
};
vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [PAP_COMPANY],
    selectedCompanyId: PAP_COMPANY.id,
    selectedCompany: PAP_COMPANY,
    loading: false,
  }),
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

async function renderAppAt(container: HTMLElement, path: string) {
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  });
  return root;
}

async function waitForRoute(container: HTMLElement, text: string) {
  await vi.waitFor(() => expect(container.textContent).toContain(text));
}

describe("App scheduling routing (company-aware Today/Schedule/Goals URLs)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const cases: Array<[string, string]> = [
    ["/today", "TODAY_PAGE"],
    ["/schedule", "SCHEDULE_PAGE"],
    ["/schedule/routines", "SCHEDULING_ROUTINES_PAGE"],
    ["/goals", "GOALS_PAGE"],
    ["/projects", "PROJECTS_PAGE"],
    ["/artifacts", "ARTIFACTS_PAGE"],
  ];

  for (const [unprefixedPath, sentinel] of cases) {
    it(`redirects unprefixed ${unprefixedPath} to the company-prefixed page`, async () => {
      const root = await renderAppAt(container, unprefixedPath);
      await waitForRoute(container, sentinel);
      expect(container.textContent).not.toContain("No company matches prefix");
      flushSync(() => root.unmount());
    });
  }

  // Direct loads / hard refreshes arrive at the already-prefixed URL (the
  // SPA fallback serves the same shell); the route must resolve without the
  // "No company matches prefix" NotFound.
  const prefixedCases: Array<[string, string]> = [
    ["/PAP/today", "TODAY_PAGE"],
    ["/PAP/schedule", "SCHEDULE_PAGE"],
    ["/PAP/schedule/routines", "SCHEDULING_ROUTINES_PAGE"],
    ["/PAP/goals", "GOALS_PAGE"],
    ["/PAP/projects", "PROJECTS_PAGE"],
    ["/PAP/artifacts", "ARTIFACTS_PAGE"],
  ];

  for (const [prefixedPath, sentinel] of prefixedCases) {
    it(`resolves a direct/refreshed load of ${prefixedPath} to the page`, async () => {
      const root = await renderAppAt(container, prefixedPath);
      await waitForRoute(container, sentinel);
      expect(container.textContent).not.toContain("No company matches prefix");
      flushSync(() => root.unmount());
    });
  }

  it("redirects unprefixed /goals/:goalId to the company-prefixed goal detail page", async () => {
    const root = await renderAppAt(container, "/goals/G-123");
    await waitForRoute(container, "GOAL_DETAIL_PAGE");
    expect(container.textContent).not.toContain("No company matches prefix");
    flushSync(() => root.unmount());
  });
});
