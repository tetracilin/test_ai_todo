import React, { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectHomepageData } from "@paperclipai/shared";
import { projectsApi } from "../api/projects";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "../lib/utils";

type HomepageTab = "documents" | "artifacts";

const isSafeExternalUrl = (value: string | null | undefined): value is string => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const ExternalLink: React.FC<{
  href: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}> = ({ href, children, className }) => {
  if (!isSafeExternalUrl(href)) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(className, "focus:outline-none focus:ring-2 focus:ring-primary rounded")}
    >
      {children}
    </a>
  );
};

const EmptySection: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-sm text-muted-foreground py-3">{children}</p>
);

export const ProjectHomepage: React.FC<{
  projectId: string;
  companyId: string;
}> = ({ projectId, companyId }) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<HomepageTab>("documents");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const idPrefix = useId();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.projects.homepage(projectId),
    queryFn: () => projectsApi.homepage(projectId, companyId),
    enabled: Boolean(projectId && companyId),
  });

  const addResource = useMutation({
    mutationFn: () => projectsApi.addHomepageResource(projectId, { title: resourceTitle, url: resourceUrl }, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.homepage(projectId) });
      setResourceTitle("");
      setResourceUrl("");
      setFormError(null);
    },
  });

  const handleAddResource = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!resourceTitle.trim()) {
      setFormError("Give the resource a title.");
      return;
    }
    if (!isSafeExternalUrl(resourceUrl)) {
      setFormError("Resource URL must use HTTP or HTTPS.");
      return;
    }
    addResource.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Loading project homepage...</p>
      </div>
    );
  }

  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm">
        <h3 className="font-semibold">Project access denied</h3>
        <p className="mt-1 text-muted-foreground">You are not authorized to view this project homepage.</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm">
        <h3 className="font-semibold">Could not load project homepage</h3>
        <p className="mt-1 text-muted-foreground">{error instanceof Error ? error.message : "Unable to load project homepage."}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const { project, goals, resources, channels, documents, artifacts } = data;
  const documentPanelId = `${idPrefix}-documents-panel`;
  const artifactPanelId = `${idPrefix}-artifacts-panel`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{project.name}</h2>
          <p className="text-sm text-muted-foreground">Project homepage</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExternalLink
            href={channels.discordUrl}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            Discord
          </ExternalLink>
          <ExternalLink
            href={channels.whatsappUrl}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            WhatsApp
          </ExternalLink>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5 dark:bg-surface-dark">
        <h3 className="text-lg font-semibold">Project goals</h3>
        {goals.length === 0 ? (
          <EmptySection>No goals linked yet.</EmptySection>
        ) : (
          <ul className="mt-3 space-y-2">
            {goals.map((goal) => (
              <li key={goal.id}>
                <a href={goal.href} className="text-primary hover:underline">
                  {goal.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5 dark:bg-surface-dark">
        <h3 className="text-lg font-semibold">Resources</h3>
        {resources.length === 0 ? (
          <EmptySection>No resources added yet.</EmptySection>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {resources.map((resource) => (
              <li key={resource.id} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <ExternalLink href={resource.url} className="font-medium text-primary hover:underline">
                  {resource.title}
                </ExternalLink>
                <span className="text-sm text-muted-foreground">
                  Added by {resource.addedBy.name}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddResource} className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-medium">Add a resource</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Resource title"
              placeholder="Title"
              value={resourceTitle}
              onChange={(event) => setResourceTitle(event.target.value)}
              className="h-9 sm:max-w-56"
            />
            <Input
              aria-label="Resource URL"
              placeholder="https://..."
              type="url"
              value={resourceUrl}
              onChange={(event) => setResourceUrl(event.target.value)}
              className="h-9 flex-1"
            />
            <Button type="submit" size="sm" disabled={addResource.isPending}>
              {addResource.isPending ? "Adding..." : "Add"}
            </Button>
          </div>
          {formError && <p className="mt-2 text-xs text-destructive">{formError}</p>}
          {addResource.isError && (
            <p className="mt-2 text-xs text-destructive">
              {addResource.error instanceof Error ? addResource.error.message : "Could not add resource."}
            </p>
          )}
        </form>
      </section>

      <section aria-label="Project activity" className="rounded-lg border border-border bg-surface dark:bg-surface-dark">
        <div role="tablist" aria-label="Project activity" className="flex border-b border-border">
          <button
            type="button"
            role="tab"
            id={`${idPrefix}-documents-tab`}
            aria-selected={activeTab === "documents"}
            aria-controls={documentPanelId}
            onClick={() => setActiveTab("documents")}
            className={cn(
              "px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary",
              activeTab === "documents"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All documents ({documents.length})
          </button>
          <button
            type="button"
            role="tab"
            id={`${idPrefix}-artifacts-tab`}
            aria-selected={activeTab === "artifacts"}
            aria-controls={artifactPanelId}
            onClick={() => setActiveTab("artifacts")}
            className={cn(
              "px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary",
              activeTab === "artifacts"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Artifacts ({artifacts.length})
          </button>
        </div>

        <div
          role="tabpanel"
          id={documentPanelId}
          aria-labelledby={`${idPrefix}-documents-tab`}
          hidden={activeTab !== "documents"}
          className="p-4"
        >
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents created by project members.</p>
          ) : (
            <ul className="divide-y divide-border">
              {documents.map((document) => (
                <li key={document.id} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-1">
                  <a href={document.href} className="font-medium text-primary hover:underline">
                    {document.title}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    Created by {document.creator.name} · {document.type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          role="tabpanel"
          id={artifactPanelId}
          aria-labelledby={`${idPrefix}-artifacts-tab`}
          hidden={activeTab !== "artifacts"}
          className="p-4"
        >
          {artifacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No artifacts created by project members.</p>
          ) : (
            <ul className="divide-y divide-border">
              {artifacts.map((artifact) => (
                <li key={artifact.id} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-1">
                  <a href={artifact.href} className="font-medium text-primary hover:underline">
                    {artifact.title}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    Created by {artifact.creator.name} · {artifact.type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};

export default ProjectHomepage;