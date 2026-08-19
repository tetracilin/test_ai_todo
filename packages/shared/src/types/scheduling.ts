export type SchedulingRecurrenceRule =
  | { kind: "daily" }
  | { kind: "weekly"; daysOfWeek: number[] };

export type SchedulingRoutineStatus = "active" | "paused";

export interface IssueScheduling {
  issueId: string;
  companyId: string;
  scheduledAt: string | null;
  deferUntil: string | null;
  scheduledDurationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertIssueSchedulingRequest {
  scheduledAt?: string | null;
  deferUntil?: string | null;
  scheduledDurationMinutes?: number | null;
}

export interface ScheduledIssueListItem {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  scheduledAt: string | null;
  deferUntil: string | null;
  scheduledDurationMinutes: number | null;
}

export interface SchedulingRoutine {
  id: string;
  companyId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  priority: string;
  status: SchedulingRoutineStatus;
  recurrenceRule: SchedulingRecurrenceRule;
  scheduledTime: string | null;
  estimateMinutes: number | null;
  lastGeneratedForDate: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSchedulingRoutineRequest {
  projectId?: string | null;
  title: string;
  description?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  priority?: string;
  recurrenceRule: SchedulingRecurrenceRule;
  scheduledTime?: string | null;
  estimateMinutes?: number | null;
}

export interface UpdateSchedulingRoutineRequest {
  projectId?: string | null;
  title?: string;
  description?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  priority?: string;
  status?: SchedulingRoutineStatus;
  recurrenceRule?: SchedulingRecurrenceRule;
  scheduledTime?: string | null;
  estimateMinutes?: number | null;
}

export interface GenerateSchedulingRoutineIssuesResult {
  routineId: string;
  createdIssueIds: string[];
  lastGeneratedForDate: string | null;
}
