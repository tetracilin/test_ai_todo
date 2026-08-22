import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { CalendarDays, Settings } from "lucide-react";
import { schedulingApi } from "../api/scheduling";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { ScheduleDateStrip, toDateKey } from "../components/ScheduleDateStrip";
import { ScheduleAgendaGrid, type AgendaItem } from "../components/ScheduleAgendaGrid";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { IssueStatusBadge } from "../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SCHEDULE_CONFIG_STORAGE_KEY = "t3.schedule.config.v1";
const OPEN_STATUSES = "todo,in_progress,in_review,blocked";

interface ScheduleConfig {
  dayCount: number;
  startHour: number;
  endHour: number;
  defaultDurationMinutes: number;
}

const DEFAULT_CONFIG: ScheduleConfig = { dayCount: 7, startHour: 7, endHour: 20, defaultDurationMinutes: 30 };

function loadConfig(): ScheduleConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(SCHEDULE_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function Schedule() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<ScheduleConfig>(loadConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [rangeStart, setRangeStart] = useState(() => startOfDay(new Date()));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Schedule" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    window.localStorage.setItem(SCHEDULE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const rangeEnd = addDays(rangeStart, config.dayCount - 1);
  const from = rangeStart.toISOString();
  const to = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59, 999).toISOString();

  const scheduledQuery = useQuery({
    queryKey: queryKeys.scheduling.scheduledIssues(selectedCompanyId!, from, to),
    queryFn: () => schedulingApi.listScheduledIssues(selectedCompanyId!, { from, to }),
    enabled: !!selectedCompanyId,
  });

  // Broad scheduled-id set (no date filter) so the "Unscheduled" panel only shows
  // issues that truly have no scheduling row anywhere, not just outside this range.
  const allScheduledQuery = useQuery({
    queryKey: queryKeys.scheduling.scheduledIssues(selectedCompanyId!, undefined, undefined),
    queryFn: () => schedulingApi.listScheduledIssues(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const openIssuesQuery = useQuery({
    queryKey: [...queryKeys.issues.list(selectedCompanyId!), "schedule-unscheduled-candidates"],
    queryFn: () =>
      issuesApi.listCompact(selectedCompanyId!, { status: OPEN_STATUSES, limit: 100, sortField: "updated", sortDir: "desc" }),
    enabled: !!selectedCompanyId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["scheduling", selectedCompanyId] });
    queryClient.invalidateQueries({ queryKey: ["issues", selectedCompanyId] });
  };

  const scheduleMutation = useMutation({
    mutationFn: ({ issueId, at, minutes }: { issueId: string; at: Date; minutes?: number }) =>
      schedulingApi.upsertIssueScheduling(selectedCompanyId!, issueId, {
        scheduledAt: at.toISOString(),
        scheduledDurationMinutes: minutes ?? config.defaultDurationMinutes,
      }),
    onSuccess: invalidate,
    onError: (err: Error) => pushToast({ title: "Couldn't schedule", body: err.message, tone: "error" }),
  });

  const resizeMutation = useMutation({
    mutationFn: ({ issueId, minutes }: { issueId: string; minutes: number }) =>
      schedulingApi.upsertIssueScheduling(selectedCompanyId!, issueId, { scheduledDurationMinutes: minutes }),
    onSuccess: invalidate,
    onError: (err: Error) => pushToast({ title: "Couldn't resize", body: err.message, tone: "error" }),
  });

  const createAndScheduleMutation = useMutation({
    mutationFn: async (at: Date) => {
      const issue = await issuesApi.create(selectedCompanyId!, { title: "New task", status: "todo" });
      const created = issue as { id: string };
      await schedulingApi.upsertIssueScheduling(selectedCompanyId!, created.id, {
        scheduledAt: at.toISOString(),
        scheduledDurationMinutes: config.defaultDurationMinutes,
      });
      return created;
    },
    onSuccess: (created) => {
      invalidate();
      setSelectedItemId(created.id);
    },
    onError: (err: Error) => pushToast({ title: "Couldn't create task", body: err.message, tone: "error" }),
  });

  const scheduledForRange = scheduledQuery.data?.items ?? [];

  const datesWithItems = useMemo(() => {
    const set = new Set<string>();
    for (const item of scheduledForRange) {
      if (item.scheduledAt) set.add(toDateKey(new Date(item.scheduledAt)));
    }
    return set;
  }, [scheduledForRange]);

  const itemsForSelectedDay: AgendaItem[] = useMemo(() => {
    const key = toDateKey(selectedDate);
    return scheduledForRange
      .filter((item) => item.scheduledAt && toDateKey(new Date(item.scheduledAt)) === key)
      .map((item) => ({
        issueId: item.issueId,
        identifier: item.identifier,
        title: item.title,
        status: item.status,
        scheduledAt: item.scheduledAt as string,
        scheduledDurationMinutes: item.scheduledDurationMinutes,
      }));
  }, [scheduledForRange, selectedDate]);

  const scheduledIssueIds = useMemo(
    () => new Set((allScheduledQuery.data?.items ?? []).map((item) => item.issueId)),
    [allScheduledQuery.data],
  );

  const unscheduledIssues = useMemo(
    () => (openIssuesQuery.data ?? []).filter((issue) => !scheduledIssueIds.has(issue.id)),
    [openIssuesQuery.data, scheduledIssueIds],
  );

  const isLoading = scheduledQuery.isLoading || openIssuesQuery.isLoading;

  if (!selectedCompanyId) {
    return <EmptyState icon={CalendarDays} message="Select a company to view the schedule." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Schedule</h1>
          <p className="text-sm text-muted-foreground">Multi-day agenda with drag-and-drop rescheduling.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/schedule/routines">Routines</Link>
          </Button>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Schedule settings">
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3">
              <div>
                <Label htmlFor="sched-day-count">Days shown</Label>
                <Input
                  id="sched-day-count"
                  type="number"
                  min={3}
                  max={31}
                  value={config.dayCount}
                  onChange={(e) => setConfig((prev) => ({ ...prev, dayCount: Number(e.target.value) }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="sched-start-hour">Start hour</Label>
                  <Input
                    id="sched-start-hour"
                    type="number"
                    min={0}
                    max={23}
                    value={config.startHour}
                    onChange={(e) => setConfig((prev) => ({ ...prev, startHour: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <Label htmlFor="sched-end-hour">End hour</Label>
                  <Input
                    id="sched-end-hour"
                    type="number"
                    min={1}
                    max={24}
                    value={config.endHour}
                    onChange={(e) => setConfig((prev) => ({ ...prev, endHour: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="sched-default-duration">Default duration (min)</Label>
                <Input
                  id="sched-default-duration"
                  type="number"
                  min={5}
                  step={5}
                  value={config.defaultDurationMinutes}
                  onChange={(e) => setConfig((prev) => ({ ...prev, defaultDurationMinutes: Number(e.target.value) }))}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <aside className="w-full shrink-0 space-y-2 md:w-64">
          <h2 className="text-sm font-semibold text-foreground">Unscheduled</h2>
          <div className="max-h-(--sz-70vh) space-y-1.5 overflow-y-auto pr-1">
            {unscheduledIssues.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                Nothing waiting to be scheduled.
              </p>
            ) : (
              unscheduledIssues.map((issue) => (
                <div
                  key={issue.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/x-issue-id", issue.id);
                  }}
                  className="cursor-grab rounded-md border border-border bg-card p-2 text-xs shadow-sm active:cursor-grabbing"
                >
                  <p className="truncate font-medium text-foreground">{issue.title}</p>
                  <div className="mt-1 flex items-center justify-between">
                    {issue.identifier && <span className="text-muted-foreground">{issue.identifier}</span>}
                    <IssueStatusBadge status={issue.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          <ScheduleDateStrip
            rangeStartDate={rangeStart}
            dayCount={config.dayCount}
            selectedDate={selectedDate}
            datesWithItems={datesWithItems}
            onNavigate={(direction) =>
              setRangeStart((prev) => addDays(prev, direction === "prev" ? -config.dayCount : config.dayCount))
            }
            onDateSelect={setSelectedDate}
            onDropOnDate={(date, issueId) => {
              const at = new Date(date);
              at.setHours(config.startHour, 0, 0, 0);
              scheduleMutation.mutate({ issueId, at });
            }}
          />

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </h3>
            <ScheduleAgendaGrid
              date={selectedDate}
              startHour={config.startHour}
              endHour={config.endHour}
              items={itemsForSelectedDay}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
              onSlotClick={(at) => createAndScheduleMutation.mutate(at)}
              onDropIssue={(issueId, at) => scheduleMutation.mutate({ issueId, at })}
              onRescheduleItem={(issueId, at) => scheduleMutation.mutate({ issueId, at })}
              onResizeItem={(issueId, minutes) => resizeMutation.mutate({ issueId, minutes })}
            />
          </div>

          {selectedItemId && (
            <div className="flex justify-end">
              <Button variant="link" size="sm" asChild>
                <Link to={`/issues/${selectedItemId}`}>Open task details →</Link>
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
