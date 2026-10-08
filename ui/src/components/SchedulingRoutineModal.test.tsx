// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SchedulingRoutine } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulingRoutineModal } from "./SchedulingRoutineModal";

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: null }),
}));

function act(callback: () => void) {
  flushSync(callback);
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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

function stubBrowserZone(zone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: zone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

function renderModal(routine: SchedulingRoutine | null) {
  const onSave = vi.fn();
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <SchedulingRoutineModal open routine={routine} onClose={vi.fn()} onSave={onSave} />
      </QueryClientProvider>,
    );
  });
  return onSave;
}

function setTitle(value: string) {
  const input = document.getElementById("routine-title") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickSave() {
  const button = [...document.querySelectorAll("button")].find((b) => /^(Create routine|Save)$/.test(b.textContent ?? ""));
  act(() => button!.click());
}

function existingRoutine(timezone: string): SchedulingRoutine {
  return {
    id: "r1",
    companyId: "c1",
    projectId: null,
    title: "Evening check",
    description: null,
    assigneeAgentId: null,
    assigneeUserId: null,
    priority: "medium",
    status: "active",
    recurrenceRule: { kind: "daily" },
    timezone,
    scheduledTime: "18:00",
    estimateMinutes: 30,
    lastGeneratedForDate: null,
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}

describe("SchedulingRoutineModal time zone", () => {
  it("defaults a new routine to the browser's time zone and sends it on save", () => {
    stubBrowserZone("Asia/Ho_Chi_Minh");
    const onSave = renderModal(null);
    setTitle("Daily evening check");
    clickSave();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ timezone: "Asia/Ho_Chi_Minh", scheduledTime: "09:00" });
  });

  it("falls back to UTC when the browser reports no time zone", () => {
    stubBrowserZone("");
    const onSave = renderModal(null);
    setTitle("No zone");
    clickSave();
    expect(onSave.mock.calls[0]![0]).toMatchObject({ timezone: "UTC" });
  });

  it("keeps an existing routine's stored zone on edit, whatever the browser says", () => {
    stubBrowserZone("Asia/Ho_Chi_Minh");
    const onSave = renderModal(existingRoutine("America/New_York"));
    clickSave();
    expect(onSave.mock.calls[0]![0]).toMatchObject({ timezone: "America/New_York" });
  });

  it("shows a stored zone the runtime does not enumerate", () => {
    stubBrowserZone("UTC");
    renderModal(existingRoutine("Mars/Olympus_Mons"));
    expect(document.getElementById("routine-timezone")!.textContent).toContain("Mars/Olympus_Mons");
  });
});
