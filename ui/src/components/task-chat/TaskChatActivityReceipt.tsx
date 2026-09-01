import { Activity } from "lucide-react";
import { timeAgo } from "@/lib/timeAgo";
import type { TaskChatActivityItem } from "./task-chat-model";

/** Compact, accessible receipt for system and field activity in task chronology. */
export function TaskChatActivityReceipt({ item }: { item: TaskChatActivityItem }) {
  return (
    <div
      className="tc-enter-bubble flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground"
      data-testid="task-chat-activity-receipt"
    >
      <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-medium text-foreground">{item.actor}</span>
      <span>{item.text}</span>
      <time className="shrink-0 text-muted-foreground" dateTime={item.createdAtIso}>
        · {timeAgo(item.createdAtIso)}
      </time>
    </div>
  );
}
