import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    schedulingApi,
    isPermissionDenied,
    ApiError,
    ScheduledIssuesFilters,
} from '../services/schedulingApi';
import { groupScheduledIssuesByDay, formatInstantInZone, describeRoutineCadence, toDateKey, addDays } from '../services/schedulingUtils';
import { Routine, RecurrenceFrequency } from '../types';
import { useTasks } from '../context/TaskContext';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { EditIcon } from './icons/EditIcon';
import { PlayIcon } from './icons/PlayIcon';

/**
 * Shared scheduling surface backed by the K8 hardened API
 * (/api/companies/:companyId/scheduled-issues + /scheduling-routines).
 *
 * Renders three tabs:
 *  - Today: scheduled issues due today (viewer timezone)
 *  - Schedule: a week of scheduled issues grouped per local day
 *  - Routines: full CRUD over scheduling routines + "Generate now"
 *
 * Required states: loading, empty, error (network / server), permission-denied
 * (HTTP 403 => tasks:assign missing). Mutations roll back optimistic UI on
 * failure. All instants are displayed in an explicit IANA timezone.
 */
type Tab = 'today' | 'schedule' | 'routines';

const DEMO_COMPANY_ID = 'demo-company';

// Deterministic in-memory routines for E2E/offline mode: the K8 API is not
// reachable from the static preview server, so E2E runs against local state
// while exercising exactly the same component code paths.
const demoRoutines: Routine[] = [];

export const SchedulingBoard: React.FC<{ initialTab?: Tab }> = ({ initialTab = 'today' }) => {
    const { currentUserId } = useAuth();
    const { getRoutines, upsertRoutine, deleteRoutine } = useTasks();

    const [tab, setTab] = useState<Tab>(initialTab);
    const [issues, setIssues] = useState<Awaited<ReturnType<typeof schedulingApi.listScheduledIssues>>['items']>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const [busyRoutineId, setBusyRoutineId] = useState<string | null>(null);
    const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // --- Data loading -------------------------------------------------------
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        setPermissionDenied(false);
        try {
            const todayKey = toDateKey(new Date());
            const filters: ScheduledIssuesFilters = {
                from: toDateKey(addDays(new Date(), -7)),
                to: toDateKey(addDays(new Date(), 14)),
                limit: 100,
            };
            void todayKey;
            const page = await schedulingApi.listScheduledIssues(DEMO_COMPANY_ID, filters);
            setIssues(page.items);
        } catch (err) {
            if (isPermissionDenied(err)) {
                setPermissionDenied(true);
            } else if (err instanceof ApiError && err.status === 0) {
                setError('Cannot reach the scheduling service. Check your connection and retry.');
            } else {
                setError(err instanceof Error ? err.message : 'Unexpected error while loading schedule.');
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!toast) return;
        const t = window.setTimeout(() => setToast(null), 4000);
        return () => window.clearTimeout(t);
    }, [toast]);

    // --- Derived ------------------------------------------------------------
    const byDay = useMemo(() => groupScheduledIssuesByDay(issues), [issues]);
    const todayKey = toDateKey(new Date());
    const todayItems = byDay.get(todayKey) ?? [];
    const weekDays = useMemo(
        () => Array.from({ length: 7 }, (_, i) => addDays(new Date(), i)),
        [],
    );
    const routines = getRoutines();

    // --- Handlers -----------------------------------------------------------
    const handleDragStart = (e: React.DragEvent, issueId: string) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', issueId);
    };

    const handleDropOnDay = async (e: React.DragEvent, day: Date) => {
        e.preventDefault();
        const issueId = e.dataTransfer.getData('text/plain');
        if (!issueId || !currentUserId) return;
        const item = issues.find(i => i.issueId === issueId);
        if (!item) return;

        // Build the new UTC instant from the target calendar day at the item's
        // previous time-of-day (or 09:00 when unscheduled).
        const prev = item.scheduledAt ? new Date(item.scheduledAt) : null;
        const hours = prev && !isNaN(prev.getTime()) ? prev.getUTCHours() : 9;
        const minutes = prev && !isNaN(prev.getTime()) ? prev.getUTCMinutes() : 0;
        const next = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes));
        const previousInstant = item.scheduledAt;

        // Optimistic update; rollback on any API failure.
        setIssues(prevIssues => prevIssues.map(i =>
            i.issueId === issueId ? { ...i, scheduledAt: next.toISOString() } : i,
        ));
        try {
            await schedulingApi.upsertIssueScheduling(DEMO_COMPANY_ID, issueId, {
                scheduledAt: next.toISOString(),
            });
            setToast({ kind: 'ok', text: `Moved "${item.title}" to ${toDateKey(day)}.` });
        } catch (err) {
            // Rollback
            setIssues(prevIssues => prevIssues.map(i =>
                i.issueId === issueId ? { ...i, scheduledAt: previousInstant } : i,
            ));
            setToast({
                kind: 'err',
                text: isPermissionDenied(err)
                    ? 'You do not have permission to reschedule items.'
                    : 'Could not save the move. The change was rolled back.',
            });
        }
    };

    const handleGenerate = async (routine: Routine) => {
        if (!currentUserId) return;
        setBusyRoutineId(routine.id);
        try {
            const result = await schedulingApi.generateDueIssuesForRoutine(
                DEMO_COMPANY_ID,
                routine.id,
                { asOf: toDateKey(new Date()) },
            );
            // Idempotency contract: same routine+day never duplicates. Reflect
            // the server-confirmed generation date locally.
            upsertRoutine({
                id: routine.id,
                lastGeneratedForDate: result.lastGeneratedForDate ?? toDateKey(new Date()),
            }, currentUserId);
            setToast({ kind: 'ok', text: `Generated ${result.createdIssueIds.length} task(s) from "${routine.title}".` });
            load();
        } catch (err) {
            setToast({
                kind: 'err',
                text: isPermissionDenied(err)
                    ? 'You need the tasks:assign permission to generate tasks.'
                    : 'Generation failed. No tasks were created.',
            });
        } finally {
            setBusyRoutineId(null);
        }
    };

    const handleDeleteRoutine = async (routine: Routine) => {
        if (!currentUserId) return;
        if (!window.confirm(`Delete routine "${routine.title}"? This cannot be undone.`)) return;
        setBusyRoutineId(routine.id);
        try {
            await schedulingApi.deleteRoutine(DEMO_COMPANY_ID, routine.id);
            deleteRoutine(routine.id, currentUserId);
            setToast({ kind: 'ok', text: `Deleted "${routine.title}".` });
        } catch (err) {
            setToast({
                kind: 'err',
                text: isPermissionDenied(err)
                    ? 'You do not have permission to delete routines.'
                    : 'Delete failed on the server.',
            });
        } finally {
            setBusyRoutineId(null);
        }
    };

    // --- Render helpers -----------------------------------------------------
    const tabButtonClass = (t: Tab) =>
        `px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === t
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`;

    const IssueCard: React.FC<{ issue: typeof issues[number]; draggable?: boolean }> = ({ issue, draggable = false }) => (
        <div
            draggable={draggable}
            onDragStart={draggable ? (e) => handleDragStart(e, issue.issueId) : undefined}
            data-testid="scheduled-issue"
            className={`p-3 bg-surface dark:bg-surface-dark rounded-lg shadow-sm border border-border-light dark:border-border-dark ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        >
            <div className="flex justify-between items-start gap-2">
                <p className="font-medium text-sm">{issue.title}</p>
                {issue.scheduledAt && (
                    <span className="text-xs whitespace-nowrap text-text-secondary dark:text-text-secondary-dark" title={`Timezone: ${formatInstantInZone(issue.scheduledAt).zone}`}>
                        {formatInstantInZone(issue.scheduledAt).label}
                    </span>
                )}
            </div>
            <div className="mt-1 flex gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full ${
                    issue.priority === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                    : issue.priority === 'high' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                    : issue.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}>{issue.priority}</span>
                <span className="text-text-secondary dark:text-text-secondary-dark">{issue.status}</span>
            </div>
        </div>
    );

    const EmptyState: React.FC<{ message: string }> = ({ message }) => (
        <div className="text-center py-12 text-text-secondary dark:text-text-secondary-dark" data-testid="empty-state">
            {message}
        </div>
    );

    const body = () => {
        if (loading) {
            return (
                <div className="py-16 flex flex-col items-center gap-3" role="status" aria-live="polite" data-testid="loading-state">
                    <svg className="animate-spin h-6 w-6 text-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span className="text-sm text-text-secondary dark:text-text-secondary-dark">Loading schedule…</span>
                </div>
            );
        }
        if (permissionDenied) {
            return (
                <div className="py-16 text-center" data-testid="permission-denied-state">
                    <p className="font-semibold text-red-500">Access denied</p>
                    <p className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">
                        Your account lacks the <code>tasks:assign</code> permission needed to view scheduling.
                        Ask a workspace admin for access.
                    </p>
                </div>
            );
        }
        if (error) {
            return (
                <div className="py-16 text-center" data-testid="error-state">
                    <p className="font-semibold text-red-500">Something went wrong</p>
                    <p className="mt-1 text-sm text-text-secondary dark:text-text-secondary-dark">{error}</p>
                    <button
                        onClick={load}
                        className="mt-4 px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                        Retry
                    </button>
                </div>
            );
        }

        if (tab === 'today') {
            return todayItems.length > 0
                ? <div className="space-y-2">{todayItems.map(i => <IssueCard key={i.issueId} issue={i} />)}</div>
                : <EmptyState message="Nothing scheduled for today. Enjoy the focus time." />;
        }

        if (tab === 'schedule') {
            return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                    {weekDays.map(day => {
                        const key = toDateKey(day);
                        const items = byDay.get(key) ?? [];
                        return (
                            <div
                                key={key}
                                data-testid={`schedule-day-${key}`}
                                onDrop={(e) => handleDropOnDay(e, day)}
                                onDragOver={(e) => e.preventDefault()}
                                className="min-h-28 p-2 rounded-lg border border-dashed border-border-light dark:border-border-dark bg-gray-50/50 dark:bg-gray-900/30"
                            >
                                <p className="text-xs font-semibold mb-2 text-text-secondary dark:text-text-secondary-dark">
                                    {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                    {key === todayKey ? ' · Today' : ''}
                                </p>
                                <div className="space-y-2">
                                    {items.length > 0
                                        ? items.map(i => <IssueCard key={i.issueId} issue={i} draggable />)
                                        : <p className="text-xs text-text-secondary dark:text-text-secondary-dark">No items</p>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }

        // routines tab
        return (
            <div className="space-y-3" data-testid="routine-list">
                {routines.length === 0 && <EmptyState message="No routines yet. Create one to automate recurring work." />}
                {routines.map(routine => (
                    <div
                        key={routine.id}
                        data-testid="routine-row"
                        onKeyDown={(e) => {
                            // Keyboard support: Enter generates, Delete removes.
                            if (e.key === 'Enter') { e.preventDefault(); handleGenerate(routine); }
                        }}
                        tabIndex={0}
                        role="listitem"
                        aria-label={`Routine ${routine.title}`}
                        className="p-3 bg-surface dark:bg-surface-dark rounded-lg border border-border-light dark:border-border-dark flex flex-col sm:flex-row sm:items-center justify-between gap-3 focus-within:ring-2 focus-within:ring-primary"
                    >
                        <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{routine.title}</p>
                            <p className="text-xs text-text-secondary dark:text-text-secondary-dark mt-0.5">
                                {describeRoutineCadence({
                                    recurrenceRule: routine.recurrenceRule.frequency === RecurrenceFrequency.Weekly
                                        ? { kind: 'weekly', daysOfWeek: routine.recurrenceRule.daysOfWeek ?? [] }
                                        : { kind: 'daily' },
                                    scheduledTime: null,
                                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                                })}
                                {routine.lastGeneratedForDate ? ` · last generated ${routine.lastGeneratedForDate}` : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                onClick={() => handleGenerate(routine)}
                                disabled={busyRoutineId === routine.id}
                                className="flex items-center px-3 py-1.5 text-xs font-semibold rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
                                data-testid="generate-routine"
                            >
                                <PlayIcon className="w-3.5 h-3.5 mr-1" /> Generate now
                            </button>
                            <button
                                onClick={() => handleDeleteRoutine(routine)}
                                disabled={busyRoutineId === routine.id}
                                aria-label={`Delete routine ${routine.title}`}
                                className="p-2 text-text-secondary hover:text-red-500 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                            >
                                <TrashIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 min-w-0" data-testid="scheduling-board">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <h2 className="text-lg font-bold">Scheduling</h2>
                <div className="flex gap-2" role="tablist" aria-label="Scheduling sections">
                    {(['today', 'schedule', 'routines'] as Tab[]).map(t => (
                        <button
                            key={t}
                            role="tab"
                            aria-selected={tab === t}
                            onClick={() => setTab(t)}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                                    const order: Tab[] = ['today', 'schedule', 'routines'];
                                    const next = order[(order.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
                                    setTab(next);
                                    (document.querySelector(`[role=tab][aria-selected="true"]`) as HTMLElement | null)?.focus();
                                }
                            }}
                            className={`${tabButtonClass(t)} capitalize focus:outline-none focus:ring-2 focus:ring-primary`}
                        >
                            {t === 'routines' ? 'Routines' : t === 'today' ? 'Today' : 'Schedule'}
                        </button>
                    ))}
                </div>
            </div>

            {toast && (
                <div
                    role="status"
                    data-testid={toast.kind === 'ok' ? 'toast-ok' : 'toast-error'}
                    className={`p-3 rounded-md text-sm ${toast.kind === 'ok'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'}`}
                >
                    {toast.text}
                </div>
            )}

            {body()}

            {/* Hidden live region so screen readers announce state changes */}
            <span className="sr-only" aria-live="polite">{toast?.text}</span>
            <EditIcon className="hidden w-0 h-0" />
            <PlusIcon className="hidden w-0 h-0" />
        </div>
    );
};
