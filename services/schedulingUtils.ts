// Pure helpers shared by the Today / Schedule / Scheduling Routines surfaces.
// Everything here is side-effect free so it can be unit-tested without a DOM.

import type { RecurrenceRule, ScheduledIssueListItem } from '../types';
import type { SchedulingRoutineDto } from '../services/schedulingApi';

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Stable, locale-independent YYYY-MM-DD key (NOT toISOString — that is UTC). */
export function toDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

export function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

/**
 * Formats a UTC instant for display in an explicit target IANA time zone.
 * Falls back to the browser's local zone when none is given. Returns a
 * human-readable "MMM D, HH:mm" label plus the zone name.
 */
export function formatInstantInZone(iso: string, timezone?: string): { label: string; zone: string } {
    let zone = timezone;
    if (!zone) {
        try {
            zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
            zone = 'UTC';
        }
    }
    let valid = true;
    try {
        // Throws RangeError for a non-IANA zone string.
        new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(iso));
    } catch {
        valid = false;
    }
    if (!valid) zone = 'UTC';

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return { label: 'Invalid date', zone };

    const dateLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        month: 'short',
        day: 'numeric',
    }).format(date);
    const timeLabel = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
    return { label: `${dateLabel}, ${timeLabel}`, zone };
}

/** "9:05 AM" style label for a HH:MM 24-hour string. */
export function formatTimeOfDay(hhmm: string): string {
    const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!match) return hhmm;
    const hours = Number(match[1]);
    const minutes = match[2];
    const period = hours < 12 ? 'AM' : 'PM';
    const display = hours % 12 === 0 ? 12 : hours % 12;
    return `${display}:${minutes} ${period}`;
}

/** "Every day" / "Weekly on Mon, Wed" / "Daily at 09:00 (Asia/Ho_Chi_Minh)". */
export function describeRoutineCadence(routine: Pick<SchedulingRoutineDto, 'recurrenceRule' | 'scheduledTime' | 'timezone'>): string {
    const parts: string[] = [];
    if (routine.recurrenceRule.kind === 'daily') {
        parts.push('Every day');
    } else {
        const days = [...routine.recurrenceRule.daysOfWeek].sort((a, b) => a - b);
        if (days.length === 7) {
            parts.push('Every day');
        } else if (days.length === 0) {
            parts.push('Weekly (no days selected)');
        } else {
            parts.push(`Weekly on ${days.map(d => WEEKDAY_LABELS[d]).join(', ')}`);
        }
    }
    if (routine.scheduledTime) {
        parts.push(`at ${formatTimeOfDay(routine.scheduledTime)}`);
    }
    if (routine.timezone && routine.timezone !== fallbackTimezone()) {
        parts.push(`(${routine.timezone})`);
    }
    return parts.join(' ');
}

let cachedLocalZone: string | null = null;
export function fallbackTimezone(): string {
    if (!cachedLocalZone) {
        try {
            cachedLocalZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch {
            cachedLocalZone = 'UTC';
        }
    }
    return cachedLocalZone;
}

/**
 * Projects server scheduled issues onto local calendar days. `scheduledAt` is
 * a UTC instant; the returned key is the YYYY-MM-DD of that instant rendered
 * in the viewer's time zone, which is what the Schedule grid groups by.
 */
export function groupScheduledIssuesByDay(
    items: ScheduledIssueListItem[],
    timezone?: string,
): Map<string, ScheduledIssueListItem[]> {
    const map = new Map<string, ScheduledIssueListItem[]>();
    for (const item of items) {
        if (!item.scheduledAt) continue;
        const key = localDateKeyForInstant(item.scheduledAt, timezone);
        const bucket = map.get(key);
        if (bucket) bucket.push(item);
        else map.set(key, [item]);
    }
    for (const bucket of map.values()) {
        bucket.sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1));
    }
    return map;
}

function localDateKeyForInstant(iso: string, timezone?: string): string {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone ?? fallbackTimezone(),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date(iso));
        // en-CA yields ISO-like YYYY-MM-DD.
        return parts;
    } catch {
        return iso.slice(0, 10);
    }
}

/**
 * Next due date for a recurrence rule, strictly after `from` (inclusive of
 * `from` itself when it already matches). Returns null when the rule can never
 * fire (weekly rule with no days). Timezone-naive by design: generation is
 * keyed on calendar dates, matching the backend's lastGeneratedForDate guard.
 */
export function nextOccurrence(rule: RecurrenceRule, from: Date): Date | null {
    if (rule.frequency === 'Weekly') {
        const days = rule.daysOfWeek ?? [];
        if (days.length === 0) return null;
        const allowed = new Set(days);
        for (let offset = 0; offset < 8; offset++) {
            const candidate = addDays(from, offset);
            if (allowed.has(candidate.getDay())) return candidate;
        }
        return null;
    }
    return from;
}

/** True when `date` matches the recurrence (used when scanning a date range). */
export function occursOn(rule: RecurrenceRule, date: Date): boolean {
    if (rule.frequency === 'Weekly') {
        return (rule.daysOfWeek ?? []).includes(date.getDay());
    }
    return true;
}

/**
 * Idempotency key for one routine firing on one calendar day. The same
 * routine + day pair always maps to the same task id, so re-running
 * generation after an error (or racing two tabs) updates instead of
 * duplicating — mirroring the backend's lastGeneratedForDate contract.
 */
export function routineTaskId(routineId: string, dateKey: string): string {
    return `rt-${routineId.slice(0, 8)}-${dateKey}`;
}
