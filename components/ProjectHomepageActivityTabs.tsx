import React, { useId, useState } from 'react';

export interface ProjectHomepageCreator {
  id: string;
  name: string;
}

export interface ProjectHomepageDocument {
  id: string;
  title: string;
  creator: ProjectHomepageCreator;
  type: string;
  url: string | null;
}

export interface ProjectHomepageArtifactTask {
  id: string;
  title: string;
  creator: ProjectHomepageCreator;
  status: string;
  type: string;
  url: string | null;
}

type ActivityTab = 'documents' | 'artifact-tasks';

const isSafeExternalUrl = (value: string | null): value is string => {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const DetailLink: React.FC<{ title: string; url: string | null }> = ({ title, url }) => (
  isSafeExternalUrl(url) ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded"
    >
      {title}
    </a>
  ) : <span className="font-medium">{title}</span>
);

const Metadata: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-xs text-text-secondary dark:text-text-secondary-dark">{children}</span>
);

export const ProjectHomepageActivityTabs: React.FC<{
  documents: ProjectHomepageDocument[];
  artifactTasks: ProjectHomepageArtifactTask[];
}> = ({ documents, artifactTasks }) => {
  const [activeTab, setActiveTab] = useState<ActivityTab>('documents');
  const idPrefix = useId();
  const documentPanelId = `${idPrefix}-documents-panel`;
  const artifactTaskPanelId = `${idPrefix}-artifact-tasks-panel`;

  return (
    <section aria-label="Project activity" className="bg-surface dark:bg-surface-dark rounded-lg border border-border-light dark:border-border-dark">
      <div role="tablist" aria-label="Project activity" className="flex border-b border-border-light dark:border-border-dark">
        <button
          type="button"
          role="tab"
          id={`${idPrefix}-documents-tab`}
          aria-selected={activeTab === 'documents'}
          aria-controls={documentPanelId}
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary ${activeTab === 'documents' ? 'border-b-2 border-primary text-primary' : 'text-text-secondary hover:text-text-primary dark:hover:text-text-primary-dark'}`}
        >
          All documents ({documents.length})
        </button>
        <button
          type="button"
          role="tab"
          id={`${idPrefix}-artifact-tasks-tab`}
          aria-selected={activeTab === 'artifact-tasks'}
          aria-controls={artifactTaskPanelId}
          onClick={() => setActiveTab('artifact-tasks')}
          className={`px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary ${activeTab === 'artifact-tasks' ? 'border-b-2 border-primary text-primary' : 'text-text-secondary hover:text-text-primary dark:hover:text-text-primary-dark'}`}
        >
          Artifact tasks ({artifactTasks.length})
        </button>
      </div>

      <div
        role="tabpanel"
        id={documentPanelId}
        aria-labelledby={`${idPrefix}-documents-tab`}
        hidden={activeTab !== 'documents'}
        className="p-4"
      >
        {documents.length === 0 ? (
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">No documents created by project members.</p>
        ) : (
          <ul className="divide-y divide-border-light dark:divide-border-dark">
            {documents.map((document) => (
              <li key={document.id} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-1">
                <DetailLink title={document.title} url={document.url} />
                <Metadata>Created by {document.creator.name} · {document.type}</Metadata>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        role="tabpanel"
        id={artifactTaskPanelId}
        aria-labelledby={`${idPrefix}-artifact-tasks-tab`}
        hidden={activeTab !== 'artifact-tasks'}
        className="p-4"
      >
        {artifactTasks.length === 0 ? (
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">No artifact tasks created by project members.</p>
        ) : (
          <ul className="divide-y divide-border-light dark:divide-border-dark">
            {artifactTasks.map((artifactTask) => (
              <li key={artifactTask.id} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-1">
                <DetailLink title={artifactTask.title} url={artifactTask.url} />
                <Metadata>Created by {artifactTask.creator.name} · {artifactTask.type} · {artifactTask.status}</Metadata>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
