import type { ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * A story map card or header that can be dragged by its handle and dropped on.
 * Only the handle starts a drag, so renaming and menus keep working with the keyboard.
 */
export function DragItem({
  dragKey,
  label,
  className,
  children,
}: {
  dragKey: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const drag = useDraggable({ id: dragKey });
  const drop = useDroppable({ id: dragKey });
  const setNodeRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  const style = drag.transform ? { transform: CSS.Translate.toString(drag.transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-drag-key={dragKey}
      className={cn(
        "flex items-start gap-1",
        className,
        drag.isDragging && "relative z-10 opacity-70",
        drop.isOver && !drag.isDragging && "ring-2 ring-ring",
      )}
    >
      <button
        type="button"
        aria-label={`Drag ${label}`}
        className="mt-0.5 cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...drag.listeners}
        {...drag.attributes}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A cell (one task in one release row) that a story can be dropped on. */
export function CellDrop({ dropKey, children }: { dropKey: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropKey });
  return (
    <div ref={setNodeRef} className={cn("h-full space-y-1", isOver && "bg-accent/40")}>
      {children}
    </div>
  );
}

export interface MoveMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** The keyboard and touch way to move an item: a small menu with the same moves as dragging. */
export function MoveMenu({
  label,
  items,
  releaseHeading,
  releaseItems,
}: {
  label: string;
  items: MoveMenuItem[];
  /** Shown above `releaseItems`, for example "Move to release". */
  releaseHeading?: string;
  releaseItems?: MoveMenuItem[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move ${label}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} disabled={item.disabled} onSelect={item.onSelect}>
            {item.label}
          </DropdownMenuItem>
        ))}
        {releaseItems && releaseItems.length > 0 ? (
          <>
            {releaseHeading ? <DropdownMenuLabel>{releaseHeading}</DropdownMenuLabel> : null}
            {releaseItems.map((item) => (
              <DropdownMenuItem key={item.label} disabled={item.disabled} onSelect={item.onSelect}>
                {item.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
