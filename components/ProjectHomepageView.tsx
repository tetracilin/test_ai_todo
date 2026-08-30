import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export interface ProjectHomepageGoal {
    id: string;
    title: string;
    companyGoalUrl: string | null;
}

export interface ProjectHomepageResource {
    id: string;
    title: string;
    documentUrl: string | null;
    addedBy: { id: string; name: string };
}

export interface ProjectHomepageData {
    project: { id: string; name: string };
    goals: ProjectHomepageGoal[];
    resources: ProjectHomepageResource[];
    channels: { discordUrl: string | null; whatsappUrl: string | null };
    documents: Array<{ id: string; title: string; type: string; creator: { id: string; name: string }; url: string | null }>;
    artifactTasks: Array<{ id: string; title: string; status: string; type: string; creator: { id: string; name: string }; url: string | null }>;
}

type HomepageState =
    | { status: 'loading' }
    | { status: 'ready'; data: ProjectHomepageData }
    | { status: 'unauthorized' }
    | { status: 'error'; message: string };

const isSafeExternalUrl = (value: string | null): value is string => {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};

const ExternalLink: React.FC<{ href: string | null; children: React.ReactNode; className?: string }> = ({ href, children, className }) => {
    if (!isSafeExternalUrl(href)) {
        return <span className={className}>{children}</span>;
    }

    return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
};

const EmptySection: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-sm text-text-secondary dark:text-text-secondary-dark py-3">{children}</p>
);

export const ProjectHomepageView: React.FC<{
    projectId: string;
    onBack: () => void;
}> = ({ projectId, onBack }) => {
    const { firebaseUser } = useAuth();
    const [state, setState] = useState<HomepageState>({ status: 'loading' });
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let isCurrent = true;
        const controller = new AbortController();

        const loadHomepage = async () => {
            setState({ status: 'loading' });
            try {
                const token = firebaseUser ? await firebaseUser.getIdToken() : null;
                const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/homepage`, {
                    signal: controller.signal,
                    credentials: 'same-origin',
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                });

                if (!isCurrent) return;
                if (response.status === 401 || response.status === 403) {
                    setState({ status: 'unauthorized' });
                    return;
                }
                if (!response.ok) {
                    const body = await response.json().catch(() => null);
                    setState({ status: 'error', message: body?.error || `Unable to load project homepage (${response.status}).` });
                    return;
                }

                setState({ status: 'ready', data: await response.json() as ProjectHomepageData });
            } catch (error) {
                if (!isCurrent || (error instanceof DOMException && error.name === 'AbortError')) return;
                setState({ status: 'error', message: error instanceof Error ? error.message : 'Unable to load project homepage.' });
            }
        };

        void loadHomepage();
        return () => {
            isCurrent = false;
            controller.abort();
        };
    }, [firebaseUser, projectId, reloadKey]);

    const retry = useCallback(() => setReloadKey(key => key + 1), []);

    if (state.status === 'loading') {
        return <div className="flex-1 flex items-center justify-center p-6"><p className="text-text-secondary dark:text-text-secondary-dark">Loading project homepage...</p></div>;
    }

    if (state.status === 'unauthorized') {
        return (
            <div className="flex-1 p-4 md:p-6">
                <button onClick={onBack} className="text-sm text-primary hover:underline mb-6">← All projects</button>
                <div className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    <h2 className="font-semibold">Project access denied</h2>
                    <p className="mt-1 text-sm">You are not authorized to view this project homepage.</p>
                </div>
            </div>
        );
    }

    if (state.status === 'error') {
        return (
            <div className="flex-1 p-4 md:p-6">
                <button onClick={onBack} className="text-sm text-primary hover:underline mb-6">← All projects</button>
                <div className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    <h2 className="font-semibold">Could not load project homepage</h2>
                    <p className="mt-1 text-sm">{state.message}</p>
                    <button onClick={retry} className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90">Try again</button>
                </div>
            </div>
        );
    }

    const { data } = state;
    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <button onClick={onBack} className="text-sm text-primary hover:underline mb-2">← All projects</button>
                    <h2 className="text-2xl font-bold">{data.project.name}</h2>
                    <p className="text-sm text-text-secondary dark:text-text-secondary-dark">Project homepage</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <ExternalLink href={data.channels.discordUrl} className="rounded-md border border-border-light px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 dark:border-border-dark">
                        Discord
                    </ExternalLink>
                    <ExternalLink href={data.channels.whatsappUrl} className="rounded-md border border-border-light px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 dark:border-border-dark">
                        WhatsApp
                    </ExternalLink>
                </div>
            </div>

            <section className="rounded-lg border border-border-light bg-surface p-5 dark:border-border-dark dark:bg-surface-dark">
                <h3 className="text-lg font-semibold">Project goals</h3>
                {data.goals.length === 0 ? <EmptySection>No project goals linked yet.</EmptySection> : (
                    <ul className="mt-3 space-y-2">
                        {data.goals.map(goal => (
                            <li key={goal.id}>
                                <ExternalLink href={goal.companyGoalUrl} className="text-primary hover:underline">{goal.title}</ExternalLink>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="rounded-lg border border-border-light bg-surface p-5 dark:border-border-dark dark:bg-surface-dark">
                <h3 className="text-lg font-semibold">Resources</h3>
                {data.resources.length === 0 ? <EmptySection>No resources added by project members yet.</EmptySection> : (
                    <ul className="mt-3 divide-y divide-border-light dark:divide-border-dark">
                        {data.resources.map(resource => (
                            <li key={resource.id} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <ExternalLink href={resource.documentUrl} className="font-medium text-primary hover:underline">{resource.title}</ExternalLink>
                                <span className="text-sm text-text-secondary dark:text-text-secondary-dark">Added by {resource.addedBy.name}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
};

export default ProjectHomepageView;
