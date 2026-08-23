import { describe, expect, it } from 'vitest';
import {
    toDateKey,
    addDays,
    isSameDay,
    formatInstantInZone,
    formatTimeOfDay,
    describeRoutineCadence,
    groupScheduledIssuesByDay,
    nextOccurrence,
    occursOn,
    routineTaskId,
    fallbackTimezone,
    WEEKDAY_LABELS,
} from './schedulingUtils';
import { RecurrenceFrequency } from '../types';
import type { ScheduledIssueListItem } from '../types';

const issue = (over: Partial<ScheduledIssueListItem> = {}): ScheduledIssueListItem => ({
    issueId: 'iss-1',
    identifier: 'T-1',
    title: 'Ship it',
    status: 'active',
    priority: 'high',
    assigneeAgentId: null,
    assigneeUserId: null,
    scheduledAt: null,
    deferUntil: null,
    scheduledDurationMinutes: null,
    ...over,
});

describe('toDateKey', () => {
    it('formats local calendar dates without UTC shifting', () => {
        // 00:30 local on 2026-08-23 must be 2026-08-23 even if UTC differs.
        const d = new Date(2026, 7, 23, 0, 30);
        expect(toDateKey(d)).toBe('2026-08-23');
    });

    it('pads month and day', () => {
        expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    });
});

describe('addDays / isSameDay', () => {
    it('crosses month boundaries correctly', () => {
        expect(toDateKey(addDays(new Date(2026, 7, 31), 1))).toBe('2026-09-01');
    });

    it('compares calendar days regardless of time', () => {
        expect(isSameDay(new Date(2026, 7, 23, 1), new Date(2026, 7, 23, 23))).toBe(true);
        expect(isSameDay(new Date(2026, 7, 23), new Date(2026, 7, 24))).toBe(false);
    });
});

describe('formatInstantInZone', () => {
    it('renders an instant in an explicit IANA zone (DST-aware)', () => {
        // Summer: New York is UTC-4
        const summer = formatInstantInZone('2026-07-15T13:00:00Z', 'America/New_York');
        expect(summer.label).toBe('Jul 15, 09:00');

        // Winter: New York is UTC-5
        const winter = formatInstantInZone('2026-01-15T13:00:00Z', 'America/New_York');
        expect(winter.label).toBe('Jan 15, 08:00');
    });

    it('falls back to UTC for invalid zones instead of throwing', () => {
        const res = formatInstantInZone('2026-07-15T13:00:00Z', 'Not/AZone');
        expect(res.zone).toBe('UTC');
    });
});

describe('formatTimeOfDay', () => {
    it('converts 24h HH:MM to a readable label', () => {
        expect(formatTimeOfDay('09:05')).toBe('9:05 AM');
        expect(formatTimeOfDay('13:45')).toBe('1:45 PM');
        expect(formatTimeOfDay('00:15')).toBe('12:15 AM');
        expect(formatTimeOfDay('12:00')).toBe('12:00 PM');
    });
});

describe('describeRoutineCadence', () => {
    it('describes daily routines with time and foreign timezone', () => {
        expect(describeRoutineCadence({
            recurrenceRule: { kind: 'daily' },
            scheduledTime: '09:00',
            timezone: 'Asia/Tokyo',
        })).toContain('Every day');
    });

    it('describes weekly routines listing sorted days', () => {
        const text = describeRoutineCadence({
            recurrenceRule: { kind: 'weekly', daysOfWeek: [3, 1] },
            scheduledTime: null,
            timezone: fallbackTimezone(),
        });
        expect(text).toBe(`Weekly on ${WEEKDAY_LABELS[1]}, ${WEEKDAY_LABELS[3]}`);
    });
});

describe('groupScheduledIssuesByDay', () => {
    it('groups by viewer-local calendar day and sorts within each bucket', () => {
        const items = [
            issue({ issueId: 'b', scheduledAt: '2026-08-23T10:00:00Z' }),
            issue({ issueId: 'a', scheduledAt: '2026-08-23T08:00:00Z' }),
            issue({ issueId: 'c', scheduledAt: '2026-08-24T08:00:00Z' }),
            issue({ issueId: 'd', scheduledAt: null }), // skipped: unscheduled
        ];
        const map = groupScheduledIssuesByDay(items, 'UTC');
        expect(map.size).toBe(2);
        expect(map.get('2026-08-23')!.map(i => i.issueId)).toEqual(['a', 'b']);
        expect(map.has('2026-08-24')).toBe(true);
    });
});

describe('nextOccurrence / occursOn', () => {
    const daily = { frequency: RecurrenceFrequency.Daily, daysOfWeek: [] };
    const monWedFri = { frequency: RecurrenceFrequency.Weekly, daysOfWeek: [1, 3, 5] };

    it('daily occurs every day and next occurrence is today', () => {
        const from = new Date(2026, 7, 23);
        expect(nextOccurrence(daily, from)).toEqual(from);
        expect(occursOn(daily, from)).toBe(true);
    });

    it('weekly finds the next allowed day', () => {
        const sunday = new Date(2026, 7, 23); // Sunday
        const next = nextOccurrence(monWedFri, sunday)!;
        expect(next.getDay()).toBe(1); // Monday
        expect(occursOn(monWedFri, sunday)).toBe(false);
        expect(occursOn(monWedFri, next)).toBe(true);
    });

    it('weekly with no days never fires', () => {
        expect(nextOccurrence({ frequency: RecurrenceFrequency.Weekly, daysOfWeek: [] }, new Date())).toBeNull();
    });
});

describe('routineTaskId', () => {
    it('is deterministic per routine+day so retries cannot duplicate tasks', () => {
        const a = routineTaskId('abc12345-xyz', '2026-08-23');
        const b = routineTaskId('abc12345-xyz', '2026-08-23');
        expect(a).toBe(b);
        expect(routineTaskId('abc12345-xyz', '2026-08-24')).not.toBe(a);
    });
});
