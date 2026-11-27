import { useState, type RefObject } from "react";
import type { CompanyArtifact } from "../api/artifacts";
import { DocumentPanelFileTree } from "./DocumentPanelFileTree";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface DocumentPopoverPanelProps {
  documentKey: string | null;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  companyId?: string | null;
  projectId?: string | null;
}

/**
 * Pop-over shell for a document: file tree and task chat share the left 25%,
 * the edit pane takes the right 75%. Areas hold placeholders until they are built.
 * Radix Dialog supplies the focus trap, Escape handling and focus return.
 */
export function DocumentPopoverPanel({ documentKey, onClose, returnFocusRef, companyId, projectId }: DocumentPopoverPanelProps) {
  const [openTabs, setOpenTabs] = useState<CompanyArtifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = openTabs.find((tab) => tab.id === activeId) ?? null;
  return (
    <Dialog
      open={documentKey !== null}
      onOpenChange={(open) => {
        if (!open) {
          setOpenTabs([]);
          setActiveId(null);
          onClose();
        }
      }}
    >
      <DialogContent
        data-testid="document-popover-panel"
        onCloseAutoFocus={(event) => {
          // No Dialog.Trigger is used, so Radix has nothing to refocus: return it to the opening row.
          event.preventDefault();
          returnFocusRef?.current?.focus();
        }}
        className="!max-w-(--pct-90) flex h-(--sz-85vh) w-full flex-col gap-0 overflow-hidden p-0"
      >
        <div className="border-b border-border px-4 py-3">
          <DialogTitle className="truncate text-sm">{documentKey ?? ""} document</DialogTitle>
          <DialogDescription className="sr-only">
            File tree, task chat and edit pane for the {documentKey ?? ""} document.
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-0 min-w-0 flex-col md:basis-1/4 md:flex-row">
            <section
              aria-label="File tree"
              data-testid="document-panel-file-tree"
              className="min-w-0 flex-1 overflow-auto border-b border-border p-3 text-sm text-muted-foreground md:border-b-0"
            >
              <DocumentPanelFileTree
                companyId={companyId}
                projectId={projectId}
                selectedArtifactId={activeId}
                onOpenArtifact={(artifact) => {
                  setOpenTabs((tabs) => (tabs.some((tab) => tab.id === artifact.id) ? tabs : [...tabs, artifact]));
                  setActiveId(artifact.id);
                }}
              />
            </section>
            <section
              aria-label="Task chat"
              data-testid="document-panel-chat"
              className="min-w-0 flex-1 overflow-auto border-b border-border p-3 text-sm text-muted-foreground md:border-b-0 md:border-l"
            >
              Task chat
            </section>
          </div>
          <section
            aria-label="Edit pane"
            data-testid="document-panel-edit"
            className="min-h-0 min-w-0 flex-1 overflow-auto p-3 text-sm text-muted-foreground md:basis-3/4 md:border-l md:border-border"
          >
            {openTabs.length > 0 ? (
              <div role="tablist" aria-label="Open files" className="flex flex-wrap gap-1">
                {openTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeId}
                    className={tab.id === activeId ? "rounded-md bg-accent px-2 py-1 text-foreground" : "rounded-md px-2 py-1"}
                    onClick={() => setActiveId(tab.id)}
                  >
                    {tab.title}
                  </button>
                ))}
              </div>
            ) : (
              "Edit pane"
            )}
            {active ? <div className="mt-3 text-foreground">{active.title}</div> : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
