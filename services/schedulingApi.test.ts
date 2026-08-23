import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    schedulingApi,
    ApiError,
    PermissionDeniedError,
    isPermissionDenied,
} from './schedulingApi';

// Minimal fetch mock: each test installs its own implementation.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const jsonOk = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
    mockFetch.mockReset();
});

describe('schedulingApi transport', () => {
    it('GET /scheduled-issues builds from/to/limit/cursor query params', async () => {
        mockFetch.mockResolvedValueOnce(jsonOk({ items: [], nextCursor: null }));
        await schedulingApi.listScheduledIssues('co-1', { from: '2026-08-01', to: '2026-08-31', limit: 50, cursor: 'abc' });
        const url = mockFetch.mock.calls[0][0] as string;
        expect(url).toBe('/api/companies/co-1/scheduled-issues?from=2026-08-01&to=2026-08-31&limit=50&cursor=abc');
    });

    it('omits absent filters', async () => {
        mockFetch.mockResolvedValueOnce(jsonOk({ items: [], nextCursor: null }));
        await schedulingApi.listScheduledIssues('co-1');
        expect(mockFetch.mock.calls[0][0]).toBe('/api/companies/co-1/scheduled-issues');
    });

    it('URL-encodes path segments', async () => {
        mockFetch.mockResolvedValueOnce(jsonOk({ deleted: true }));
        await schedulingApi.deleteRoutine('co/1', 'routine x');
        expect(mockFetch.mock.calls[0][0]).toBe('/api/companies/co%2F1/scheduling-routines/routine%20x');
        expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('PUT upsert sends a JSON body', async () => {
        mockFetch.mockResolvedValueOnce(jsonOk({ scheduling: {} }));
        await schedulingApi.upsertIssueScheduling('co-1', 'iss-1', { scheduledAt: '2026-08-23T09:00:00Z' });
        const init = mockFetch.mock.calls[0][1];
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body)).toEqual({ scheduledAt: '2026-08-23T09:00:00Z' });
    });
});

describe('schedulingApi error mapping', () => {
    it('maps HTTP 403 to PermissionDeniedError (tasks:assign missing)', async () => {
        mockFetch.mockResolvedValueOnce(new Response('{"message":"forbidden"}', { status: 403 }));
        const err = await schedulingApi.listRoutines('co-1').catch(e => e);
        expect(err).toBeInstanceOf(PermissionDeniedError);
        expect(isPermissionDenied(err)).toBe(true);
    });

    it('maps server error bodies with a message field', async () => {
        mockFetch.mockResolvedValueOnce(new Response('{"message":"limit must be <= 100"}', { status: 400 }));
        const err = await schedulingApi.listScheduledIssues('co-1', { limit: 500 }).catch(e => e);
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(400);
        expect(err.message).toBe('limit must be <= 100');
        expect(isPermissionDenied(err)).toBe(false);
    });

    it('maps network failures to a status-0 ApiError', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const err = await schedulingApi.listRoutines('co-1').catch(e => e);
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(0);
    });
});
