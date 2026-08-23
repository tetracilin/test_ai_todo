import { describe, expect, it, vi } from 'vitest';

// Regression tests for the E2E-mode branch in useTaskStore: with ?e2e=1 the
// store must skip Firestore entirely (no onSnapshot subscription) and expose
// working routine CRUD against local state.

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})) }));
vi.mock('firebase/firestore', () => ({
    getFirestore: vi.fn(() => ({})),
    doc: vi.fn(),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    collection: vi.fn(),
    onSnapshot: vi.fn(),
    Timestamp: { fromDate: vi.fn() },
    serverTimestamp: vi.fn(),
    writeBatch: vi.fn(),
}));

// Import after mocks; force the E2E flag on before the module graph loads.
vi.mock('../services/runtimeMode', () => ({
    isE2EMode: true,
    E2E_DEMO_USER_ID: 'e2e-demo-user',
}));

import { renderHook, act } from '@testing-library/react';
import { useTaskStore } from './useTaskStore';
import { RecurrenceFrequency } from '../types';

describe('useTaskStore in E2E mode', () => {
    it('loads immediately without a Firebase subscription', () => {
        const { result } = renderHook(() => useTaskStore(null));
        expect(result.current.isLoaded).toBe(true);
        expect(result.current.getItems()).toEqual([]);
    });

    it('upsertRoutine creates then updates without touching Firestore', async () => {
        const { result } = renderHook(() => useTaskStore(null));

        await act(async () => {
            await result.current.upsertRoutine({
                id: 'r-1',
                title: 'Weekly report',
                recurrenceRule: { frequency: RecurrenceFrequency.Weekly, daysOfWeek: [1] },
                estimate: 30,
            }, 'user-1');
        });

        expect(result.current.getRoutines()).toHaveLength(1);
        expect(result.current.getRoutines()[0].title).toBe('Weekly report');

        await act(async () => {
            await result.current.upsertRoutine({ id: 'r-1', title: 'Weekly report v2' }, 'user-1');
        });

        const routines = result.current.getRoutines();
        expect(routines).toHaveLength(1); // update, not duplicate
        expect(routines[0].title).toBe('Weekly report v2');
        // Unspecified fields are preserved from the existing record
        expect(routines[0].estimate).toBe(30);
        expect(routines[0].recurrenceRule.daysOfWeek).toEqual([1]);
        expect(routines[0].creatorId).toBe('user-1');
    });

    it('deleteRoutine removes the routine and is a no-op for unknown ids', async () => {
        const { result } = renderHook(() => useTaskStore(null));

        await act(async () => {
            await result.current.upsertRoutine({ id: 'r-2', title: 'Temp' }, 'user-1');
        });
        await act(async () => {
            await result.current.deleteRoutine('r-2', 'user-1');
            await result.current.deleteRoutine('missing', 'user-1');
        });

        expect(result.current.getRoutines()).toHaveLength(0);
    });
});
