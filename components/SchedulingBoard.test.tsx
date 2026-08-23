import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockUpsert = vi.fn();
const mockGenerate = vi.fn();
const mockDeleteRoutine = vi.fn();
const mockListRoutines = vi.fn();
const mockCreateRoutine = vi.fn();
const mockUpdateRoutine = vi.fn();

vi.mock('../services/schedulingApi', () => ({
    schedulingApi: {
        listScheduledIssues: (...a: unknown[]) => mockList(...a),
        upsertIssueScheduling: (...a: unknown[]) => mockUpsert(...a),
        generateDueIssuesForRoutine: (...a: unknown[]) => mockGenerate(...a),
        deleteRoutine: (...a: unknown[]) => mockDeleteRoutine(...a),
        listRoutines: (...a: unknown[]) => mockListRoutines(...a),
        createRoutine: (...a: unknown[]) => mockCreateRoutine(...a),
        updateRoutine: (...a: unknown[]) => mockUpdateRoutine(...a),
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

// SchedulingRoutineModal is rendered but we just want a testid marker
vi.mock('./SchedulingRoutineModal', () => ({
    SchedulingRoutineModal: ({ onClose, onSaveCreate, onSaveUpdate, routine }: {
        routine: unknown; onClose: () => void; onSaveCreate: (d: unknown) => void; onSaveUpdate: (id: string, d: unknown) => void;
    }) => (
        <div data-testid="routine-modal">
            <button data-testid="modal-close" onClick={onClose}>Close</button>
            <button data-testid="modal-create" onClick={() => onSaveCreate({ title: 'Test Routine', priority: 'medium', recurrenceRule: { kind: 'daily' as const }, timezone: 'UTC', scheduledTime: null, estimateMinutes: null })}>Create</button>
            <button data-testid="modal-update" onClick={() => onSaveUpdate((routine as { id: string }).id || 'rt-1', { title: 'Updated' })}>Update</button>
        </div>
    ),
}));

// K8-compatible routine shape (SchedulingRoutineDto)
const routines = [
    {
        id: 'rt-server-1',
        companyId: 'demo-company',
        projectId: null,
        title: 'Daily standup notes',
        description: null,
        assigneeAgentId: null,
        assigneeUserId: null,
        priority: 'medium' as const,
        status: 'active' as const,
        recurrenceRule: { kind: 'weekly' as const, daysOfWeek: [1, 3, 5] },
        timezone: 'UTC',
        scheduledTime: null,
        estimateMinutes: 15,
        lastGeneratedForDate: null,
        createdByAgentId: null,
        createdByUserId: null,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
    },
];

import { SchedulingBoard } from './SchedulingBoard';

afterEach(() => {
    mockList.mockReset();
    mockUpsert.mockReset();
    mockGenerate.mockReset();
    mockDeleteRoutine.mockReset();
    mockListRoutines.mockReset();
    mockCreateRoutine.mockReset();
    mockUpdateRoutine.mockReset();
});

const setupResolved = () => {
    mockList.mockResolvedValue({ items: [], nextCursor: null });
    mockListRoutines.mockResolvedValue({ routines: [] });
};

describe('SchedulingBoard', () => {
    it('shows a loading state while the API call is in flight', async () => {
        let resolve!: (v: unknown) => void;
        mockList.mockReturnValueOnce(new Promise(res => { resolve = res; }));
        mockListRoutines.mockResolvedValue({ routines: [] });
        render(<SchedulingBoard />);
        expect(screen.getByTestId('loading-state')).toBeInTheDocument();
        resolve({ items: [], nextCursor: null });
        await waitFor(() => expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument());
    });

    it('shows an empty state when no issues are scheduled', async () => {
        setupResolved();
        render(<SchedulingBoard />);
        expect(await screen.findByTestId('empty-state')).toHaveTextContent(/nothing scheduled for today/i);
    });

    it('renders scheduled issues for today', async () => {
        setupResolved();
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
        mockListRoutines.mockResolvedValue({ routines: [] });
        render(<SchedulingBoard />);
        expect(await screen.findByTestId('permission-denied-state')).toHaveTextContent(/tasks:assign/);
    });

    it('renders an error state with a working Retry button', async () => {
        mockList.mockRejectedValueOnce(new Error('boom'));
        mockListRoutines.mockResolvedValue({ routines: [] });
        // Second call succeeds
        mockList.mockResolvedValueOnce({ items: [], nextCursor: null });
        render(<SchedulingBoard />);
        expect(await screen.findByTestId('error-state')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    });

    it('loads routines from K8 API and shows them with generate/edit/delete buttons', async () => {
        mockList.mockResolvedValue({ items: [], nextCursor: null });
        mockListRoutines.mockResolvedValue({ routines });
        render(<SchedulingBoard initialTab="routines" />);

        // Should show the routines loading state first, then the list
        expect(await screen.findByTestId('routine-list')).toBeInTheDocument();
        expect(screen.getAllByTestId('routine-row')[0]).toHaveTextContent('Daily standup notes');
        expect(screen.getByTestId('generate-routine')).toBeInTheDocument();
        // Edit button should be present
        expect(screen.getByRole('button', { name: /edit routine daily standup notes/i })).toBeInTheDocument();
    });

    it('generates tasks from a routine and reports success', async () => {
        mockList.mockResolvedValue({ items: [], nextCursor: null });
        mockListRoutines.mockResolvedValue({ routines });
        mockGenerate.mockResolvedValueOnce({ routineId: 'rt-server-1', createdIssueIds: ['i1'], lastGeneratedForDate: '2026-08-23' });
        render(<SchedulingBoard initialTab="routines" />);

        await userEvent.click(await screen.findByTestId('generate-routine'));
        expect(mockGenerate).toHaveBeenCalledWith(
            'demo-company',
            'rt-server-1',
            expect.objectContaining({ asOf: expect.any(String) }),
        );
        expect(await screen.findByTestId('toast-ok')).toHaveTextContent(/generated 1 task/i);
    });

    it('opens the New Routine modal and creates a routine via the K8 API', async () => {
        setupResolved();
        mockListRoutines.mockResolvedValue({ routines: [] });
        render(<SchedulingBoard initialTab="routines" />);

        await userEvent.click(await screen.findByTestId('new-routine-btn'));
        expect(await screen.findByTestId('routine-modal')).toBeInTheDocument();

        mockCreateRoutine.mockResolvedValueOnce({
            id: 'rt-new', companyId: 'demo-company', title: 'Test Routine',
            priority: 'medium', recurrenceRule: { kind: 'daily' }, timezone: 'UTC',
            scheduledTime: null, estimateMinutes: null, lastGeneratedForDate: null,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        await userEvent.click(screen.getByTestId('modal-create'));
        expect(mockCreateRoutine).toHaveBeenCalledWith('demo-company', expect.objectContaining({ title: 'Test Routine' }));
        expect(await screen.findByTestId('toast-ok')).toHaveTextContent(/created routine/i);
    });

    it('deletes a routine via the K8 API and removes it from the list', async () => {
        mockList.mockResolvedValue({ items: [], nextCursor: null });
        mockListRoutines.mockResolvedValue({ routines });
        mockDeleteRoutine.mockResolvedValueOnce({ deleted: true });

        // Use a proper confirm mock
        const originalConfirm = window.confirm;
        window.confirm = vi.fn(() => true);

        render(<SchedulingBoard initialTab="routines" />);
        await screen.findByTestId('routine-row');

        const deleteBtn = screen.getByRole('button', { name: /delete routine daily standup notes/i });
        await userEvent.click(deleteBtn);

        expect(mockDeleteRoutine).toHaveBeenCalledWith('demo-company', 'rt-server-1');
        expect(await screen.findByTestId('toast-ok')).toHaveTextContent(/deleted/i);

        window.confirm = originalConfirm;
    });

    it('rolls back a drag reschedule when the API rejects it', async () => {
        setupResolved();
        mockList.mockResolvedValueOnce({
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
        mockListRoutines.mockResolvedValue({ routines: [] });
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