import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface ScheduleDateStripProps {
  rangeStartDate: Date;
  dayCount: number;
  selectedDate: Date;
  /** Date keys (toDateKey) that have at least one scheduled item, for the dot indicator. */
  datesWithItems: Set<string>;
  onDateSelect: (date: Date) => void;
  onNavigate: (direction: "prev" | "next") => void;
  /** Called when a dragged issue (issueId in dataTransfer as "application/x-issue-id") is dropped on a date. */
  onDropOnDate?: (date: Date, issueId: string) => void;
}

export function ScheduleDateStrip({
  rangeStartDate,
  dayCount,
  selectedDate,
  datesWithItems,
  onDateSelect,
  onNavigate,
  onDropOnDate,
}: ScheduleDateStripProps) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const dates = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStartDate, i)),
    [rangeStartDate, dayCount],
  );
  const rangeEndDate = dates[dates.length - 1] ?? rangeStartDate;

  const handleDrop = (event: React.DragEvent, date: Date) => {
    event.preventDefault();
    setDragOverKey(null);
    if (!onDropOnDate) return;
    const issueId = event.dataTransfer.getData("application/x-issue-id");
    if (issueId) onDropOnDate(date, issueId);
  };

  return (
    <div className="border-b border-border pb-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate("prev")}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Previous range"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-semibold text-foreground">
          {MONTH_NAMES[rangeStartDate.getMonth()]} {rangeStartDate.getDate()} –{" "}
          {MONTH_NAMES[rangeEndDate.getMonth()]} {rangeEndDate.getDate()}, {rangeEndDate.getFullYear()}
        </h2>
        <button
          type="button"
          onClick={() => onNavigate("next")}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Next range"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div
        className="grid gap-1 overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(44px, 1fr))` }}
      >
        {dates.map((date) => {
          const dateKey = toDateKey(date);
          const selected = isSameDay(date, selectedDate);
          const today = isSameDay(date, new Date());
          const hasItems = datesWithItems.has(dateKey);
          const isDragOver = dragOverKey === dateKey;

          return (
            <button
              type="button"
              key={dateKey}
              onDrop={(e) => handleDrop(e, date)}
              onDragOver={(e) => {
                if (!onDropOnDate) return;
                e.preventDefault();
                setDragOverKey(dateKey);
              }}
              onDragLeave={() => setDragOverKey(null)}
              onClick={() => onDateSelect(date)}
              className={cn(
                "relative rounded-lg p-2 text-center transition-colors",
                isDragOver && "outline outline-2 outline-offset-[-2px] outline-primary",
                selected && "bg-primary text-primary-foreground shadow-sm",
                !selected && today && "bg-accent",
                !selected && !today && "hover:bg-accent/60",
              )}
            >
              <div className={cn("text-[10px] uppercase", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {date.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div className="text-base font-semibold">{date.getDate()}</div>
              {hasItems && (
                <div
                  className={cn(
                    "absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full",
                    selected ? "bg-primary-foreground" : "bg-primary",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
