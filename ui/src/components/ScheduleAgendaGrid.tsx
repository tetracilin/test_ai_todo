import { useCallback, useEffect, useRef } from "react";
import { IssueStatusBadge } from "./StatusBadge";
import { cn } from "../lib/utils";

export interface AgendaItem {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  scheduledAt: string;
  scheduledDurationMinutes: number | null;
}

interface ScheduleAgendaGridProps {
  date: Date;
  startHour: number;
  endHour: number;
  pixelsPerHour?: number;
  items: AgendaItem[];
  selectedItemId?: string | null;
  onSelectItem: (issueId: string) => void;
  /** Click an empty slot to schedule something new at that time. */
  onSlotClick?: (at: Date) => void;
  /** A previously-unscheduled issue was dropped at this time. */
  onDropIssue?: (issueId: string, at: Date) => void;
  /** Drag an already-scheduled item to reposition it in time. */
  onRescheduleItem?: (issueId: string, at: Date) => void;
  /** Resize the bottom edge to change duration (minutes, snapped to 15). */
  onResizeItem?: (issueId: string, durationMinutes: number) => void;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

export function ScheduleAgendaGrid({
  date,
  startHour,
  endHour,
  pixelsPerHour = 60,
  items,
  selectedItemId,
  onSelectItem,
  onSlotClick,
  onDropIssue,
  onRescheduleItem,
  onResizeItem,
}: ScheduleAgendaGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeState = useRef<{ issueId: string; initialY: number; initialMinutes: number } | null>(null);

  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const gridHeight = (endHour - startHour) * pixelsPerHour;

  const yToDate = useCallback(
    (offsetY: number) => {
      const minutesFromStart = Math.max(0, (offsetY / pixelsPerHour) * 60);
      const rounded = Math.round(minutesFromStart / 15) * 15;
      const result = new Date(date);
      result.setHours(startHour, 0, 0, 0);
      result.setMinutes(result.getMinutes() + rounded);
      return result;
    },
    [date, startHour, pixelsPerHour],
  );

  const handleGridClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || !onSlotClick) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    onSlotClick(yToDate(e.clientY - rect.top));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const at = yToDate(e.clientY - rect.top);
    const issueId = e.dataTransfer.getData("application/x-issue-id");
    if (!issueId) return;
    const isReschedule = items.some((item) => item.issueId === issueId);
    if (isReschedule) onRescheduleItem?.(issueId, at);
    else onDropIssue?.(issueId, at);
  };

  const handleResizeMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      const state = resizeState.current;
      if (!state) return;
      const clientY = "touches" in e ? e.touches[0]?.clientY ?? state.initialY : e.clientY;
      const deltaMinutes = ((clientY - state.initialY) / pixelsPerHour) * 60;
      let minutes = Math.round(state.initialMinutes + deltaMinutes);
      minutes = Math.max(15, Math.round(minutes / 15) * 15);
      onResizeItem?.(state.issueId, minutes);
    },
    [pixelsPerHour, onResizeItem],
  );

  useEffect(() => {
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", handleResizeMove);
      window.removeEventListener("touchend", onUp);
    };
    return () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", handleResizeMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [handleResizeMove]);

  const startResize = (e: React.MouseEvent | React.TouchEvent, item: AgendaItem) => {
    if (!onResizeItem) return;
    e.preventDefault();
    e.stopPropagation();
    const clientY = "touches" in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    resizeState.current = {
      issueId: item.issueId,
      initialY: clientY,
      initialMinutes: item.scheduledDurationMinutes ?? 30,
    };
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", () => {
      resizeState.current = null;
    }, { once: true });
    window.addEventListener("touchmove", handleResizeMove, { passive: false });
    window.addEventListener("touchend", () => {
      resizeState.current = null;
    }, { once: true });
  };

  return (
    <div className="flex">
      <div className="w-14 shrink-0 pr-2 pt-1 text-right">
        {hours.map((hour) => (
          <div key={hour} className="text-[11px] text-muted-foreground" style={{ height: `${pixelsPerHour}px` }}>
            {formatHourLabel(hour)}
          </div>
        ))}
      </div>
      <div
        ref={containerRef}
        className="relative flex-1 border-l border-border"
        style={{ height: `${gridHeight}px` }}
        onClick={handleGridClick}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {hours.map((hour, index) =>
          index > 0 ? (
            <div
              key={hour}
              className="absolute w-full border-t border-border"
              style={{ top: `${index * pixelsPerHour}px` }}
            />
          ) : null,
        )}

        {items.map((item) => {
          const itemDate = new Date(item.scheduledAt);
          const minutesFromStart = (itemDate.getHours() - startHour) * 60 + itemDate.getMinutes();
          const top = (minutesFromStart / 60) * pixelsPerHour;
          const duration = item.scheduledDurationMinutes ?? 30;
          const height = Math.max(22, (duration / 60) * pixelsPerHour - 2);
          const selected = item.issueId === selectedItemId;

          return (
            <div
              key={item.issueId}
              className="absolute w-full pr-1"
              style={{ top: `${top}px`, height: `${height}px`, zIndex: selected ? 10 : 1 }}
            >
              <div
                draggable={!!onRescheduleItem}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("application/x-issue-id", item.issueId);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectItem(item.issueId);
                }}
                className={cn(
                  "group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-md border p-1.5 text-left text-xs shadow-sm transition-all",
                  "bg-primary/15 border-primary/30 hover:bg-primary/20 cursor-pointer",
                  selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  onRescheduleItem && "cursor-grab active:cursor-grabbing",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{item.title}</p>
                  {item.identifier && (
                    <p className="truncate text-[10px] text-muted-foreground">{item.identifier}</p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <IssueStatusBadge status={item.status} />
                  <span className="text-[10px] text-muted-foreground">
                    {itemDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                {onResizeItem && (
                  <div
                    onMouseDown={(e) => startResize(e, item)}
                    onTouchStart={(e) => startResize(e, item)}
                    style={{ touchAction: "none" }}
                    className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 cursor-ns-resize rounded-full border-2 border-primary bg-background opacity-0 group-hover:opacity-100"
                    aria-label="Resize duration"
                  />
                )}
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-4 text-center text-sm text-muted-foreground">
            Nothing scheduled. Click the grid to add a time, or drag an item here.
          </div>
        )}
      </div>
    </div>
  );
}
