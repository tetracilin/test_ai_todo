// @vitest-environment jsdom

// Regression guard for the story map and scratch pad links: the pages are
// company-scoped, so the sidebar and the pages themselves emit prefixed URLs,
// but the advertised unprefixed URLs (/story-map, /story-map/backlog,
// /scratch-pad) must redirect to the selected company's page. This drives the
// real <App> route table; removing the UnprefixedBoardRedirect routes makes the
// sentinels disappear.

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
vi.hoisted(() => {
  const sheetProto = window.CSSStyleSheet.prototype as unknown as {
    insertRule: (rule: string, index?: number) => number;
    __storyMapRoutingPatched?: boolean;
  };
  if (!sheetProto.__storyMapRoutingPatched) {
    const original = sheetProto.insertRule;
    sheetProto.insertRule = function patched(this: CSSStyleSheet, rule: string, index?: number) {
      try {
        return original.call(this, rule, index);
      } catch {
        try {
          return original.call(this, ".story-map-routing-noop{}", index);
        } catch {
          return this.cssRules?.length ?? 0;
        }
      }
    };
    sheetProto.__storyMapRoutingPatched = true;
  }
});

// Real Layout renders the full authenticated shell and owns the
// "No company matches prefix" NotFound. For routing we only need it to resolve
// the :companyPrefix segment and render its nested routes.
vi.mock("./components/Layout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { Layout: () => <Outlet /> };
});

// Rendered by <App> outside <Routes> and needs DialogProvider; irrelevant here.
vi.mock("./components/OnboardingWizardVariant", () => ({
  OnboardingWizardVariant: () => null,
}));

// Sentinels so we can assert which route resolved: a sentinel only renders
// when the unprefixed path redirected onto the company-prefixed board route.
vi.mock("./pages/StoryMap", () => ({ StoryMap: () => <div>STORY_MAP_PAGE</div> }));
vi.mock("./pages/StoryMapBacklog", () => ({
  StoryMapBacklog: () => <div>STORY_MAP_BACKLOG_PAGE</div>,
}));
vi.mock("./pages/ScratchPad", () => ({ ScratchPad: () => <div>SCRATCH_PAD_PAGE</div> }));

// Cloud access is unrelated to the route table. Let it fall through
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

function renderAppAt(container: HTMLElement, path: string) {
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

describe("App story map and scratch pad routing (company-aware URLs)", () => {
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
    ["/story-map", "STORY_MAP_PAGE"],
    ["/story-map/backlog", "STORY_MAP_BACKLOG_PAGE"],
    ["/scratch-pad", "SCRATCH_PAD_PAGE"],
    ["/PAP/story-map", "STORY_MAP_PAGE"],
    ["/PAP/story-map/backlog", "STORY_MAP_BACKLOG_PAGE"],
    ["/PAP/scratch-pad", "SCRATCH_PAD_PAGE"],
  ];

  for (const [path, sentinel] of cases) {
    it(`resolves ${path} to the ${sentinel}`, async () => {
      const root = renderAppAt(container, path);
      await waitForRoute(container, sentinel);
      expect(container.textContent).not.toContain("No company matches prefix");
      flushSync(() => root.unmount());
    });
  }
});
