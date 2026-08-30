import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectHomepageActivityTabs } from './ProjectHomepageActivityTabs';

describe('ProjectHomepageActivityTabs', () => {
  const documents = [{
    id: 'document-1',
    title: 'Project brief',
    creator: { id: 'member-1', name: 'Ada Lovelace' },
    type: 'brief',
    url: 'https://example.test/documents/document-1',
  }];
  const artifactTasks = [{
    id: 'artifact-task-1',
    title: 'Publish report',
    creator: { id: 'member-2', name: 'Grace Hopper' },
    type: 'artifact-task',
    status: 'open',
    url: 'https://example.test/tasks/artifact-task-1',
  }];

  it('switches accessible tabs and exposes creator, type, status, and safe detail links', async () => {
    const user = userEvent.setup();
    render(<ProjectHomepageActivityTabs documents={documents} artifactTasks={artifactTasks} />);

    const documentsTab = screen.getByRole('tab', { name: 'All documents (1)' });
    const artifactTasksTab = screen.getByRole('tab', { name: 'Artifact tasks (1)' });
    expect(documentsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'Project brief' })).toHaveAttribute('href', documents[0].url);
    expect(screen.getByText('Created by Ada Lovelace · brief')).toBeInTheDocument();

    await user.click(artifactTasksTab);
    expect(artifactTasksTab).toHaveAttribute('aria-selected', 'true');
    expect(documentsTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('link', { name: 'Publish report' })).toHaveAttribute('href', artifactTasks[0].url);
    expect(screen.getByText('Created by Grace Hopper · artifact-task · open')).toBeInTheDocument();
  });

  it('renders empty states and does not create unsafe links', async () => {
    const user = userEvent.setup();
    render(<ProjectHomepageActivityTabs documents={[]} artifactTasks={[{ ...artifactTasks[0], url: 'javascript:alert(1)' }]} />);

    expect(screen.getByText('No documents created by project members.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Artifact tasks (1)' }));
    expect(screen.queryByRole('link', { name: 'Publish report' })).not.toBeInTheDocument();
    expect(screen.getByText('Publish report')).toBeInTheDocument();
  });
});
