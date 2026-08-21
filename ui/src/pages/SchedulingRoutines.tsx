import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Play, Plus, Repeat2, Trash2, Pencil, Pause } from "lucide-react";
import type { SchedulingRoutine } from "@paperclipai/shared";
import { schedulingApi } from "../api/scheduling";
import { agentsApi } from "../api/agents";
import { accessApi } from "../api/access";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  SchedulingRoutineModal,
  type SchedulingRoutineFormValues,
} from "../components/SchedulingRoutineModal";
import { Button } from "@/components/ui/button";

function formatRecurrence(rule: SchedulingRoutine["recurrenceRule"]): string {
  if (rule.kind === "daily") return "Daily";
  if (rule.daysOfWeek.length === 7) return "Every day";
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return [...rule.daysOfWeek].sort().map((d) => labels[d]).join(", ");
}

export function SchedulingRoutines() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<SchedulingRoutine | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Schedule", href: "/schedule" }, { label: "Routines" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scheduling.routines(selectedCompanyId!),
    queryFn: () => schedulingApi.listRoutines(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents", selectedCompanyId, "for-scheduling-routines-list"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: userDirectory } = useQuery({
    queryKey: ["user-directory", selectedCompanyId, "for-scheduling-routines-list"],
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.scheduling.routines(selectedCompanyId!) });

  const createMutation = useMutation({
    mutationFn: (values: SchedulingRoutineFormValues) => schedulingApi.createRoutine(selectedCompanyId!, values),
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      pushToast({ title: "Routine created", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Couldn't create routine", body: err.message, tone: "error" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: SchedulingRoutineFormValues }) =>
      schedulingApi.updateRoutine(selectedCompanyId!, id, values),
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setEditingRoutine(null);
      pushToast({ title: "Routine updated", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Couldn't update routine", body: err.message, tone: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulingApi.deleteRoutine(selectedCompanyId!, id),
    onSuccess: invalidate,
    onError: (err: Error) => pushToast({ title: "Couldn't delete routine", body: err.message, tone: "error" }),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (routine: SchedulingRoutine) =>
      schedulingApi.updateRoutine(selectedCompanyId!, routine.id, {
        status: routine.status === "active" ? "paused" : "active",
      }),
    onSuccess: invalidate,
    onError: (err: Error) => pushToast({ title: "Couldn't change status", body: err.message, tone: "error" }),
  });

  const generateMutation = useMutation({
    mutationFn: (routineId: string) => schedulingApi.generateDueIssuesForRoutine(selectedCompanyId!, routineId),
    onSuccess: (result) => {
      invalidate();
      pushToast({
        title: "Routine ran",
        body: `Created ${result.createdIssueIds.length} task${result.createdIssueIds.length === 1 ? "" : "s"}.`,
        tone: "success",
      });
    },
    onError: (err: Error) => pushToast({ title: "Couldn't run routine", body: err.message, tone: "error" }),
  });

  function assigneeLabel(routine: SchedulingRoutine): string {
    if (routine.assigneeAgentId) {
      return agents?.find((a) => a.id === routine.assigneeAgentId)?.name ?? "Agent";
    }
    if (routine.assigneeUserId) {
      const entry = userDirectory?.users.find((u) => u.principalId === routine.assigneeUserId);
      return entry?.user?.name ?? entry?.user?.email ?? "Person";
    }
    return "Unassigned";
  }

  function handleSave(values: SchedulingRoutineFormValues) {
    if (editingRoutine) {
      updateMutation.mutate({ id: editingRoutine.id, values });
    } else {
      createMutation.mutate(values);
    }
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={Repeat2} message="Select a company to manage scheduling routines." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const routines = data?.routines ?? [];

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Scheduling routines</h1>
          <p className="text-sm text-muted-foreground">
            Recurring task templates that generate concrete{" "}
            <Link to="/schedule" className="underline">
              scheduled
            </Link>{" "}
            tasks daily or weekly.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingRoutine(null);
            setModalOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New routine
        </Button>
      </div>

      {routines.length === 0 ? (
        <EmptyState
          icon={Repeat2}
          message="No scheduling routines yet."
          description="Create one to auto-generate recurring tasks like daily standups or weekly reviews."
          action="New routine"
          onAction={() => {
            setEditingRoutine(null);
            setModalOpen(true);
          }}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Title</th>
                <th className="px-4 py-2.5">Assignee</th>
                <th className="px-4 py-2.5">Recurs</th>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {routines.map((routine) => (
                <tr key={routine.id} className="border-t border-border hover:bg-accent/40">
                  <td className="px-4 py-2.5 font-medium text-foreground">{routine.title}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{assigneeLabel(routine)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatRecurrence(routine.recurrenceRule)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{routine.scheduledTime ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        routine.status === "active"
                          ? "text-xs font-medium text-foreground"
                          : "text-xs font-medium text-muted-foreground"
                      }
                    >
                      {routine.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Run now"
                        onClick={() => generateMutation.mutate(routine.id)}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={routine.status === "active" ? "Pause" : "Resume"}
                        onClick={() => toggleStatusMutation.mutate(routine)}
                      >
                        <Pause className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Edit"
                        onClick={() => {
                          setEditingRoutine(routine);
                          setModalOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Delete"
                        onClick={() => {
                          if (window.confirm("Delete this routine?")) deleteMutation.mutate(routine.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <SchedulingRoutineModal
          open={modalOpen}
          routine={editingRoutine}
          onClose={() => {
            setModalOpen(false);
            setEditingRoutine(null);
          }}
          onSave={handleSave}
          saving={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
}
