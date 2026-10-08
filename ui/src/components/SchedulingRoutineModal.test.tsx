// @vitest-environment jsdom

import type React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SchedulingRoutine } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulingRoutineModal } from "./SchedulingRoutineModal";

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: null }),
}));

// Radix Select needs pointer APIs jsdom lacks. A native <select> keeps the form's
// value/onValueChange wiring under test without them. The trigger renders nothing.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: {
    value: string;
    onValueChange: (next: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
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

function zoneSelect(): HTMLSelectElement {
  return [...document.querySelectorAll("select")].find((el) =>
    [...el.options].some((option) => option.value === "UTC"),
  )!;
}

function chooseZone(zone: string) {
  const select = zoneSelect();
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, zone);
    select.dispatchEvent(new Event("change", { bubbles: true }));
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
    expect(zoneSelect().value).toBe("Mars/Olympus_Mons");
  });

  it("sends the zone the user picks instead of the default", () => {
    stubBrowserZone("Asia/Ho_Chi_Minh");
    const onSave = renderModal(null);
    setTitle("Pick a zone");
    chooseZone("Europe/Paris");
    clickSave();
    expect(onSave.mock.calls[0]![0]).toMatchObject({ timezone: "Europe/Paris" });
  });

  it("lets the user change an existing routine's zone", () => {
    stubBrowserZone("Asia/Ho_Chi_Minh");
    const onSave = renderModal(existingRoutine("America/New_York"));
    chooseZone("Asia/Tokyo");
    clickSave();
    expect(onSave.mock.calls[0]![0]).toMatchObject({ timezone: "Asia/Tokyo" });
  });
});
