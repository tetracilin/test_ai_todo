import type {
  CreateSchedulingRoutineRequest,
  GenerateSchedulingRoutineIssuesResult,
  IssueScheduling,
  ScheduledIssueListItem,
  SchedulingRoutine,
  UpdateSchedulingRoutineRequest,
  UpsertIssueSchedulingRequest,
} from "@paperclipai/shared";
import { api } from "./client";

export interface ScheduledIssuesFilters {
  from?: string;
  to?: string;
}

function scheduledIssuesSearchParams(filters?: ScheduledIssuesFilters) {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  return params;
}

export const schedulingApi = {
  getIssueScheduling: (companyId: string, issueId: string) =>
    api.get<{ scheduling: IssueScheduling | null }>(
      `/companies/${companyId}/issues/${issueId}/scheduling`,
    ),
  upsertIssueScheduling: (companyId: string, issueId: string, data: UpsertIssueSchedulingRequest) =>
    api.put<{ scheduling: IssueScheduling }>(
      `/companies/${companyId}/issues/${issueId}/scheduling`,
      data,
    ),
  clearIssueScheduling: (companyId: string, issueId: string) =>
    api.delete<{ deleted: boolean }>(`/companies/${companyId}/issues/${issueId}/scheduling`),
  listScheduledIssues: (companyId: string, filters?: ScheduledIssuesFilters) => {
    const qs = scheduledIssuesSearchParams(filters).toString();
    return api.get<{ items: ScheduledIssueListItem[] }>(
      `/companies/${companyId}/scheduled-issues${qs ? `?${qs}` : ""}`,
    );
  },

  listRoutines: (companyId: string) =>
    api.get<{ routines: SchedulingRoutine[] }>(`/companies/${companyId}/scheduling-routines`),
  getRoutine: (companyId: string, routineId: string) =>
    api.get<SchedulingRoutine>(`/companies/${companyId}/scheduling-routines/${routineId}`),
  createRoutine: (companyId: string, data: CreateSchedulingRoutineRequest) =>
    api.post<SchedulingRoutine>(`/companies/${companyId}/scheduling-routines`, data),
  updateRoutine: (companyId: string, routineId: string, data: UpdateSchedulingRoutineRequest) =>
    api.patch<SchedulingRoutine>(`/companies/${companyId}/scheduling-routines/${routineId}`, data),
  deleteRoutine: (companyId: string, routineId: string) =>
    api.delete<{ deleted: boolean }>(`/companies/${companyId}/scheduling-routines/${routineId}`),
  generateDueIssues: (companyId: string, options?: { asOf?: string; maxDays?: number }) =>
    api.post<{ results: GenerateSchedulingRoutineIssuesResult[] }>(
      `/companies/${companyId}/scheduling-routines/generate`,
      options ?? {},
    ),
  generateDueIssuesForRoutine: (
    companyId: string,
    routineId: string,
    options?: { asOf?: string; maxDays?: number },
  ) =>
    api.post<GenerateSchedulingRoutineIssuesResult>(
      `/companies/${companyId}/scheduling-routines/${routineId}/generate`,
      options ?? {},
    ),
};
