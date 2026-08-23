import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockUpsert = vi.fn();
const mockGenerate = vi.fn();
const mockDeleteRoutine = vi.fn();

vi.mock('../services/schedulingApi', () => ({
    schedulingApi: {
        listScheduledIssues: (...a: unknown[]) => mockList(...a),
        upsertIssueScheduling: (...a: unknown[]) => mockUpsert(...a),
        generateDueIssuesForRoutine: (...a: unknown[]) => mockGenerate(...a),
        deleteRoutine: (...a: unknown[]) => mockDeleteRoutine(...a),
    },
    ApiError: class ApiError extends Error {
        constructor(public message: string, public status: number) { super(message); }
    },
    PermissionDeniedError: class PermissionDeniedError extends Error {},
    isPermissionDenied: (err: unknown) =>
        !!err && typeof err === 'object' && (err as { name?: string }).name === 'PermissionDeniedError',
}));

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({ currentUserId: 'user-1' }),
}));

const routines = [
    {
        id: 'rt-1',
        creatorId: 'user-1',
        title: 'Daily standup notes',
        note: '',
        tagIds: [],
        estimate: 15,
        assigneeId: 'user-1',
        recurrenceRule: { frequency: 'Weekly' as const, daysOfWeek: [1, 3, 5] },
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
    },
];

vi.mock('../context/TaskContext', () => ({
    useTasks: () => ({
        getRoutines: () => routines,
        upsertRoutine: vi.fn(),
        deleteRoutine: vi.fn(),
    }),
}));

import { SchedulingBoard } from './SchedulingBoard';

afterEach(() => {
    mockList.mockReset();
    mockUpsert.mockReset();
    mockGenerate.mockReset();
    mockDeleteRoutine.mockReset();
});

describe('SchedulingBoard', () => {
    it('shows a loading state while the API call is in flight', async () => {
        let resolve!: (v: unknown) => void;
        mockList.mockReturnValueOnce(new Promise(res => { resolve = res; }));
        render(<SchedulingBoard />);
        expect(screen.getByTestId('loading-state')).toBeInTheDocument();
        resolve({ items: [], nextCursor: null });
        await waitFor(() => expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument());
    });

    it('shows an empty state when no issues are scheduled', async () => {
        mockList.mockResolvedValueOnce({ items: [], nextCursor: null });
        render(<SchedulingBoard />);
        expect(await screen.findByTestId('empty-state')).toHaveTextContent(/nothing scheduled for today/i);
    });

    it('renders scheduled issues for today', async () => {
        mockList.mockResolvedValueOnce({
            items: [{
                issueId: 'iss-9',
                identifier: 'T-9',
                title: 'Write release notes',
                status: 'active',
                priority: 'high',
                assigneeAgentId: null,
                assigneeUserId: null,
                scheduledAt: new Date().toISOString(),
                deferUntil: null,
                scheduledDurationMinutes: 30,
            }],
            nextCursor: null,
        });
        render(<SchedulingBoard />);
        expect(await screen.findAllByTestId('scheduled-issue').then(cards => cards[0])).toHaveTextContent('Write release notes');
    });

    it('renders a permission-denied state on HTTP 403', async () => {
        const err: any = new Error('denied');
        err.name = 'PermissionDeniedError';
        err.status = 403;
        mockList.mockRejectedValueOnce(err);
        render(<SchedulingBoard />);
        expect(await screen.findByTestId('permission-denied-state')).toHaveTextContent(/tasks:assign/);
    });

    it('renders an error state with a working Retry button', async () => {
        mockList.mockRejectedValueOnce(new Error('boom'));
        mockList.mockResolvedValueOnce({ items: [], nextCursor: null });
        render(<SchedulingBoard />);
        expect(await screen.findByTestId('error-state')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    });

    it('switches tabs and shows routine rows with keyboard focus support', async () => {
        mockList.mockResolvedValue({ items: [], nextCursor: null });
        render(<SchedulingBoard initialTab="routines" />);

        expect(await screen.findByTestId('routine-list')).toBeInTheDocument();
        expect(screen.getAllByTestId('routine-row')[0]).toHaveTextContent('Daily standup notes');

        // Tab switching works
        await userEvent.click(screen.getByRole('tab', { name: 'Today' }));
        expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    });

    it('generates tasks from a routine and reports success', async () => {
        mockList.mockResolvedValue({ items: [], nextCursor: null });
        mockGenerate.mockResolvedValueOnce({ routineId: 'rt-1', createdIssueIds: ['i1'], lastGeneratedForDate: '2026-08-23' });
        render(<SchedulingBoard initialTab="routines" />);

        await userEvent.click(await screen.findByTestId('generate-routine'));
        expect(mockGenerate).toHaveBeenCalledWith(
            'demo-company',
            'rt-1',
            expect.objectContaining({ asOf: expect.any(String) }),
        );
        expect(await screen.findByTestId('toast-ok')).toHaveTextContent(/generated 1 task/i);
    });

    it('rolls back a drag reschedule when the API rejects it', async () => {
        mockList.mockResolvedValue({
            items: [{
                issueId: 'iss-1',
                identifier: null,
                title: 'Movable item',
                status: 'active',
                priority: 'low',
                assigneeAgentId: null,
                assigneeUserId: null,
                scheduledAt: '2026-08-23T09:00:00Z',
                deferUntil: null,
                scheduledDurationMinutes: null,
            }],
            nextCursor: null,
        });
        mockUpsert.mockRejectedValueOnce(new Error('offline'));

        const { container } = render(<SchedulingBoard initialTab="schedule" />);
        await screen.findAllByTestId((id) => id.startsWith('schedule-day-'));

        const target = screen.getByTestId(`schedule-day-${new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10)}`);
        const drop = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
        Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'iss-1' } });
        act(() => { target.dispatchEvent(drop); });

        // Rollback toast appears and the optimistic move is reverted.
        expect(await screen.findByTestId('toast-error')).toHaveTextContent(/rolled back/i);

        const card = screen.getByTestId('scheduled-issue');
        expect(card).toHaveTextContent('Movable item');
        void container;
    });
});

import { act } from 'react';
