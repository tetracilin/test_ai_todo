// Scheduling API contract for the hardened backend routes delivered by K8.
//
// The production deployment of these routes lives on the Paperclip fork
// (server/src/routes/scheduling.ts, commit 6015a80a0). This client mirrors
// that REST surface 1:1 so the UI can consume the real service wherever it is
// mounted under /api. Every route is tenant-scoped by companyId and — per K8 —
// every mutation requires the `tasks:assign` permission, which surfaces to the
// UI as a PermissionDeniedError (HTTP 403) that views render as a distinct
// permission-denied state.

import type { ScheduledIssueListItem } from '../types';

export interface IssueSchedulingDto {
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

export interface ScheduledIssuesFilters {
    from?: string; // YYYY-MM-DD (UTC calendar date)
    to?: string; // YYYY-MM-DD
    limit?: number; // server clamps/validates 1..100, default 50
    cursor?: string; // opaque keyset cursor from a previous page
}

/** Keyset pagination envelope returned by GET /scheduled-issues. */
export interface PaginatedScheduledIssues {
    items: ScheduledIssueListItem[];
    nextCursor: string | null;
}

export type SchedulingRoutineStatus = 'active' | 'paused';
export type SchedulingRecurrenceRule = { kind: 'daily' } | { kind: 'weekly'; daysOfWeek: number[] };

export interface SchedulingRoutineDto {
    id: string;
    companyId: string;
    projectId: string | null;
    title: string;
    description: string | null;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
    priority: 'critical' | 'high' | 'medium' | 'low';
    status: SchedulingRoutineStatus;
    recurrenceRule: SchedulingRecurrenceRule;
    timezone: string;
    scheduledTime: string | null; // HH:MM 24h in routine timezone
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
    priority?: 'critical' | 'high' | 'medium' | 'low';
    recurrenceRule: SchedulingRecurrenceRule;
    timezone?: string;
    scheduledTime?: string | null;
    estimateMinutes?: number | null;
}

export interface UpdateSchedulingRoutineRequest {
    projectId?: string | null;
    title?: string;
    description?: string | null;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    status?: SchedulingRoutineStatus;
    recurrenceRule?: SchedulingRecurrenceRule;
    timezone?: string;
    scheduledTime?: string | null;
    estimateMinutes?: number | null;
}

export interface GenerateSchedulingResult {
    routineId: string;
    createdIssueIds: string[];
    lastGeneratedForDate: string | null;
}

// --- Errors -----------------------------------------------------------------

export class ApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

/** The authenticated actor lacks `tasks:assign` for this mutation (HTTP 403). */
export class PermissionDeniedError extends ApiError {
    constructor(message = 'You do not have permission to manage scheduling.') {
        super(message, 403);
        this.name = 'PermissionDeniedError';
    }
}

export function isPermissionDenied(err: unknown): err is PermissionDeniedError {
    return err instanceof PermissionDeniedError || (err instanceof ApiError && err.status === 403);
}

// --- Transport --------------------------------------------------------------

const API_BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
            ...init,
        });
    } catch (err) {
        // Network-level failure (offline, refused connection).
        throw new ApiError('Network error while contacting the scheduling service.', 0);
    }

    if (!res.ok) {
        if (res.status === 403) throw new PermissionDeniedError();
        let message = `Request failed with status ${res.status}`;
        try {
            const body = await res.json();
            if (body && typeof body.message === 'string') message = body.message;
        } catch {
            /* non-JSON body — keep default message */
        }
        throw new ApiError(message, res.status);
    }
    return res.json() as Promise<T>;
}

function buildSearchParams(filters?: ScheduledIssuesFilters): string {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.cursor) params.set('cursor', filters.cursor);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

// --- Client -----------------------------------------------------------------
//
// All functions take an explicit companyId because every scheduling route on
// the server is namespaced under /companies/:companyId and enforces tenant
// isolation server-side (assertCompanyAccess).

export const schedulingApi = {
    listScheduledIssues: (companyId: string, filters?: ScheduledIssuesFilters) =>
        request<PaginatedScheduledIssues>(
            `/companies/${encodeURIComponent(companyId)}/scheduled-issues${buildSearchParams(filters)}`,
        ),

    getIssueScheduling: (companyId: string, issueId: string) =>
        request<{ scheduling: IssueSchedulingDto | null }>(
            `/companies/${encodeURIComponent(companyId)}/issues/${encodeURIComponent(issueId)}/scheduling`,
        ),

    upsertIssueScheduling: (companyId: string, issueId: string, data: UpsertIssueSchedulingRequest) =>
        request<{ scheduling: IssueSchedulingDto }>(
            `/companies/${encodeURIComponent(companyId)}/issues/${encodeURIComponent(issueId)}/scheduling`,
            { method: 'PUT', body: JSON.stringify(data) },
        ),

    clearIssueScheduling: (companyId: string, issueId: string) =>
        request<{ deleted: boolean }>(
            `/companies/${encodeURIComponent(companyId)}/issues/${encodeURIComponent(issueId)}/scheduling`,
            { method: 'DELETE' },
        ),

    listRoutines: (companyId: string) =>
        request<{ routines: SchedulingRoutineDto[] }>(
            `/companies/${encodeURIComponent(companyId)}/scheduling-routines`,
        ),

    getRoutine: (companyId: string, routineId: string) =>
        request<SchedulingRoutineDto>(
            `/companies/${encodeURIComponent(companyId)}/scheduling-routines/${encodeURIComponent(routineId)}`,
        ),

    createRoutine: (companyId: string, data: CreateSchedulingRoutineRequest) =>
        request<SchedulingRoutineDto>(`/companies/${encodeURIComponent(companyId)}/scheduling-routines`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    updateRoutine: (companyId: string, routineId: string, data: UpdateSchedulingRoutineRequest) =>
        request<SchedulingRoutineDto>(
            `/companies/${encodeURIComponent(companyId)}/scheduling-routines/${encodeURIComponent(routineId)}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        ),

    deleteRoutine: (companyId: string, routineId: string) =>
        request<{ deleted: boolean }>(
            `/companies/${encodeURIComponent(companyId)}/scheduling-routines/${encodeURIComponent(routineId)}`,
            { method: 'DELETE' },
        ),

    generateDueIssues: (companyId: string, options?: { asOf?: string; maxDays?: number }) =>
        request<{ results: GenerateSchedulingResult[] }>(
            `/companies/${encodeURIComponent(companyId)}/scheduling-routines/generate`,
            { method: 'POST', body: JSON.stringify(options ?? {}) },
        ),

    generateDueIssuesForRoutine: (companyId: string, routineId: string, options?: { asOf?: string; maxDays?: number }) =>
        request<GenerateSchedulingResult>(
            `/companies/${encodeURIComponent(companyId)}/scheduling-routines/${encodeURIComponent(routineId)}/generate`,
            { method: 'POST', body: JSON.stringify(options ?? {}) },
        ),
};
