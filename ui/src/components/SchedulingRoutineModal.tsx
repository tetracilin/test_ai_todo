import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ISSUE_PRIORITIES, type SchedulingRoutine } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { accessApi } from "../api/access";
import { useCompany } from "../context/CompanyContext";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "../lib/utils";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface SchedulingRoutineFormValues {
  title: string;
  description: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  priority: string;
  recurrenceRule: { kind: "daily" } | { kind: "weekly"; daysOfWeek: number[] };
  scheduledTime: string | null;
  estimateMinutes: number | null;
}

interface SchedulingRoutineModalProps {
  open: boolean;
  routine: SchedulingRoutine | null;
  onClose: () => void;
  onSave: (values: SchedulingRoutineFormValues) => void;
  saving?: boolean;
}

const UNASSIGNED = "__unassigned__";

export function SchedulingRoutineModal({ open, routine, onClose, onSave, saving }: SchedulingRoutineModalProps) {
  const { selectedCompanyId } = useCompany();
  const [title, setTitle] = useState(routine?.title ?? "");
  const [description, setDescription] = useState(routine?.description ?? "");
  const [assignee, setAssignee] = useState<string>(
    routine?.assigneeAgentId
      ? `agent:${routine.assigneeAgentId}`
      : routine?.assigneeUserId
        ? `user:${routine.assigneeUserId}`
        : UNASSIGNED,
  );
  const [priority, setPriority] = useState(routine?.priority ?? "medium");
  const [frequency, setFrequency] = useState<"daily" | "weekly">(routine?.recurrenceRule.kind ?? "daily");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    routine?.recurrenceRule.kind === "weekly" ? routine.recurrenceRule.daysOfWeek : [],
  );
  const [scheduledTime, setScheduledTime] = useState(routine?.scheduledTime ?? "09:00");
  const [estimateMinutes, setEstimateMinutes] = useState(routine?.estimateMinutes ?? 30);

  const { data: agents } = useQuery({
    queryKey: ["agents", selectedCompanyId, "for-scheduling-routine"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });
  const { data: userDirectory } = useQuery({
    queryKey: ["user-directory", selectedCompanyId, "for-scheduling-routine"],
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const canSave = title.trim().length > 0 && (frequency === "daily" || daysOfWeek.length > 0);

  function toggleDay(day: number) {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function handleSave() {
    if (!canSave) return;
    const [assigneeKind, assigneeId] = assignee === UNASSIGNED ? [null, null] : assignee.split(":");
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      assigneeAgentId: assigneeKind === "agent" ? (assigneeId ?? null) : null,
      assigneeUserId: assigneeKind === "user" ? (assigneeId ?? null) : null,
      priority,
      recurrenceRule: frequency === "daily" ? { kind: "daily" } : { kind: "weekly", daysOfWeek },
      scheduledTime: scheduledTime || null,
      estimateMinutes: estimateMinutes || null,
    });
  }

  const assigneeOptions = useMemo(
    () => ({
      agents: agents ?? [],
      users: userDirectory?.users ?? [],
    }),
    [agents, userDirectory],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-(--sz-85vh) max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{routine ? "Edit routine" : "New routine"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="routine-title">Title</Label>
            <Input id="routine-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="routine-description">Notes</Label>
            <Textarea id="routine-description" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {assigneeOptions.agents.map((agent) => (
                    <SelectItem key={agent.id} value={`agent:${agent.id}`}>
                      {agent.name}
                    </SelectItem>
                  ))}
                  {assigneeOptions.users.map((entry) => (
                    <SelectItem key={entry.principalId} value={`user:${entry.principalId}`}>
                      {entry.user?.name ?? entry.user?.email ?? entry.principalId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Recurs</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as "daily" | "weekly")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
            {frequency === "weekly" && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {DAY_LABELS.map((label, day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium",
                      daysOfWeek.includes(day)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="routine-time">Time of day</Label>
              <Input
                id="routine-time"
                type="time"
                value={scheduledTime ?? ""}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="routine-estimate">Estimate (min)</Label>
              <Input
                id="routine-estimate"
                type="number"
                min={1}
                value={estimateMinutes ?? ""}
                onChange={(e) => setEstimateMinutes(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {routine ? "Save" : "Create routine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
