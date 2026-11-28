import { useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { CompanyArtifact } from "../api/artifacts";

export interface DocumentPanelTabsProps {
  tabs: CompanyArtifact[];
  activeId: string | null;
  /** Ids of tabs with unsaved changes; they are marked and closing them asks first. */
  unsavedIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/** Tab bar of the edit pane: roving focus, arrow/Home/End to move, Delete or the close control to close. */
export function DocumentPanelTabs({ tabs, activeId, unsavedIds, onSelect, onClose }: DocumentPanelTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  function focusTab(id: string) {
    onSelect(id);
    requestAnimationFrame(() => {
      const all = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [];
      for (const el of all) if (el.dataset.tabId === id) el.focus();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    let target: number | null = null;
    if (event.key === "ArrowRight") target = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") target = index === 0 ? last : index - 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    else if (event.key === "Delete") {
      event.preventDefault();
      const next = tabs[index + 1] ?? tabs[index - 1];
      onClose(tabs[index].id);
      if (next) focusTab(next.id);
      return;
    }
    if (target === null) return;
    event.preventDefault();
    focusTab(tabs[target].id);
  }

  return (
    <div ref={listRef} role="tablist" aria-label="Open files" className="flex flex-wrap gap-1">
      {tabs.map((tab, index) => {
        const selected = tab.id === activeId;
        const unsaved = unsavedIds?.has(tab.id) ?? false;
        return (
          <div key={tab.id} className={selected ? "flex items-center rounded-md bg-accent text-foreground" : "flex items-center rounded-md"}>
            <button
              type="button"
              role="tab"
              data-tab-id={tab.id}
              aria-selected={selected}
              tabIndex={selected || (activeId === null && index === 0) ? 0 : -1}
              className="rounded-md py-1 pl-2 pr-1"
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.title}
              {unsaved ? <span aria-label="unsaved changes"> *</span> : null}
            </button>
            <button
              type="button"
              aria-label={"Close " + tab.title}
              className="rounded-md p-1 hover:bg-muted"
              onClick={() => onClose(tab.id)}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
