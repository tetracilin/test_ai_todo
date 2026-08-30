import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectHomepageView } from './ProjectHomepageView';

const getIdToken = vi.fn();

vi.mock('../context/AuthContext', () => ({
    useAuth: () => ({ firebaseUser: { getIdToken } }),
}));

const homepage = {
    project: { id: 'project-1', name: 'Apollo' },
    goals: [{ id: 'goal-1', title: 'Launch safely', companyGoalUrl: 'https://goals.example.com/goal-1' }],
    resources: [{ id: 'resource-1', title: 'Project brief', documentUrl: 'https://docs.example.com/brief', addedBy: { id: 'member-1', name: 'Ada' } }],
    channels: { discordUrl: 'https://discord.com/channels/1', whatsappUrl: 'https://chat.whatsapp.com/example' },
    documents: [],
    artifactTasks: [],
};

describe('ProjectHomepageView', () => {
    beforeEach(() => {
        getIdToken.mockReset().mockResolvedValue('firebase-token');
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => vi.unstubAllGlobals());

    it('loads overview data and protects external links', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(homepage), { status: 200 }));
        render(<ProjectHomepageView projectId="project-1" onBack={() => {}} />);

        expect(screen.getByText('Loading project homepage...')).toBeInTheDocument();
        expect(await screen.findByText('Apollo')).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledWith('/api/projects/project-1/homepage', expect.objectContaining({
            credentials: 'same-origin',
            headers: { Authorization: 'Bearer firebase-token' },
        }));

        const goalLink = screen.getByRole('link', { name: 'Launch safely' });
        expect(goalLink).toHaveAttribute('href', 'https://goals.example.com/goal-1');
        expect(goalLink).toHaveAttribute('target', '_blank');
        expect(goalLink).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByText('Added by Ada')).toBeInTheDocument();
    });

    it('shows empty goal and resource states', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...homepage, goals: [], resources: [] }), { status: 200 }));
        render(<ProjectHomepageView projectId="project-1" onBack={() => {}} />);

        expect(await screen.findByText('No project goals linked yet.')).toBeInTheDocument();
        expect(screen.getByText('No resources added by project members yet.')).toBeInTheDocument();
    });

    it('shows access denial without homepage data', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'project membership required' }), { status: 403 }));
        render(<ProjectHomepageView projectId="project-1" onBack={() => {}} />);

        expect(await screen.findByText('Project access denied')).toBeInTheDocument();
        expect(screen.queryByText('Apollo')).not.toBeInTheDocument();
    });

    it('retries a failed request', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'service unavailable' }), { status: 503 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(homepage), { status: 200 }));
        render(<ProjectHomepageView projectId="project-1" onBack={() => {}} />);

        expect(await screen.findByText('Could not load project homepage')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(screen.getByText('Apollo')).toBeInTheDocument());
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
