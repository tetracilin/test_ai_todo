import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { CalendarClock, Settings } from "lucide-react";
import { schedulingApi } from "../api/scheduling";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { ScheduleAgendaGrid, type AgendaItem } from "../components/ScheduleAgendaGrid";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TODAY_CONFIG_STORAGE_KEY = "t3.today.config.v1";

interface TodayConfig {
  startHour: number;
  endHour: number;
  slotMinutes: number;
}

const DEFAULT_CONFIG: TodayConfig = { startHour: 7, endHour: 20, slotMinutes: 30 };

function loadConfig(): TodayConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(TODAY_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function Today() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<TodayConfig>(loadConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    setBreadcrumbs([{ label: "Today" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    window.localStorage.setItem(TODAY_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const from = startOfDay(today).toISOString();
  const to = endOfDay(today).toISOString();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scheduling.scheduledIssues(selectedCompanyId!, from, to),
    queryFn: () => schedulingApi.listScheduledIssues(selectedCompanyId!, { from, to }),
    enabled: !!selectedCompanyId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["scheduling", selectedCompanyId] });
  };

  const rescheduleMutation = useMutation({
    mutationFn: ({ issueId, at }: { issueId: string; at: Date }) =>
      schedulingApi.upsertIssueScheduling(selectedCompanyId!, issueId, { scheduledAt: at.toISOString() }),
    onSuccess: invalidate,
    onError: (err: Error) => pushToast({ title: "Couldn't reschedule", body: err.message, tone: "error" }),
  });

  const resizeMutation = useMutation({
    mutationFn: ({ issueId, minutes }: { issueId: string; minutes: number }) =>
      schedulingApi.upsertIssueScheduling(selectedCompanyId!, issueId, { scheduledDurationMinutes: minutes }),
    onSuccess: invalidate,
    onError: (err: Error) => pushToast({ title: "Couldn't resize", body: err.message, tone: "error" }),
  });

  const items: AgendaItem[] = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item) => item.scheduledAt)
        .map((item) => ({
          issueId: item.issueId,
          identifier: item.identifier,
          title: item.title,
          status: item.status,
          scheduledAt: item.scheduledAt as string,
          scheduledDurationMinutes: item.scheduledDurationMinutes,
        })),
    [data],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={CalendarClock} message="Select a company to view today's schedule." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Today</h1>
          <p className="text-sm text-muted-foreground">
            {today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/schedule">Full schedule</Link>
          </Button>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Agenda settings">
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3">
              <div>
                <Label htmlFor="today-start-hour">Start hour</Label>
                <Input
                  id="today-start-hour"
                  type="number"
                  min={0}
                  max={23}
                  value={config.startHour}
                  onChange={(e) => setConfig((prev) => ({ ...prev, startHour: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label htmlFor="today-end-hour">End hour</Label>
                <Input
                  id="today-end-hour"
                  type="number"
                  min={1}
                  max={24}
                  value={config.endHour}
                  onChange={(e) => setConfig((prev) => ({ ...prev, endHour: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label htmlFor="today-slot-minutes">Default slot (min)</Label>
                <Input
                  id="today-slot-minutes"
                  type="number"
                  min={5}
                  step={5}
                  value={config.slotMinutes}
                  onChange={(e) => setConfig((prev) => ({ ...prev, slotMinutes: Number(e.target.value) }))}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <ScheduleAgendaGrid
          date={today}
          startHour={config.startHour}
          endHour={config.endHour}
          items={items}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
          onRescheduleItem={(issueId, at) => rescheduleMutation.mutate({ issueId, at })}
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
    </div>
  );
}
