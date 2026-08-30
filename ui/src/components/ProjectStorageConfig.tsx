import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@paperclipai/shared";
import { ExternalLink, Loader2 } from "lucide-react";
import { projectsApi } from "../api/projects";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";

function storageErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const apiError = (error.body as { error?: unknown }).error;
    if (apiError && typeof apiError === "object" && "message" in apiError && typeof apiError.message === "string") {
      return apiError.message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Unable to load project storage configuration.";
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function ProjectStorageConfig({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [repoLocalFolder, setRepoLocalFolder] = useState("");
  const [nasFolder, setNasFolder] = useState("");
  const [showSaveError, setShowSaveError] = useState<string | null>(null);
  const configQuery = useQuery({
    queryKey: queryKeys.projects.storageConfig(project.id),
    queryFn: () => projectsApi.getStorageConfig(project.id),
  });
  const foldersQuery = useQuery({
    queryKey: queryKeys.projects.minioFolders(project.id),
    queryFn: () => projectsApi.listMinioFolders(project.id),
    enabled: configQuery.data?.minio.enabled === true,
  });

  useEffect(() => {
    if (!configQuery.data) return;
    setRepoLocalFolder(configQuery.data.repoLocalFolder ?? "");
    setNasFolder(configQuery.data.minio.nasFolder ?? "");
  }, [configQuery.data]);

  const save = useMutation({
    mutationFn: () => projectsApi.updateStorageConfig(project.id, {
      repoLocalFolder: repoLocalFolder.trim() || null,
      nasFolder: configQuery.data?.minio.enabled ? nasFolder || null : null,
    }),
    onSuccess: (config) => {
      setShowSaveError(null);
      setRepoLocalFolder(config.repoLocalFolder ?? "");
      setNasFolder(config.minio.nasFolder ?? "");
      queryClient.setQueryData(queryKeys.projects.storageConfig(project.id), config);
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(project.id) });
    },
    onError: (error) => setShowSaveError(storageErrorMessage(error)),
  });

  if (configQuery.isLoading) {
    return <p className="text-xs text-muted-foreground" role="status">Loading MinIO NAS configuration...</p>;
  }
  if (configQuery.error) {
    return <p className="text-xs text-destructive" role="alert">{storageErrorMessage(configQuery.error)}</p>;
  }
  if (!configQuery.data) return null;

  const { minio } = configQuery.data;
  const consoleUrl = safeExternalUrl(minio.consoleUrl);
  const folders = foldersQuery.data?.folders.filter((folder): folder is string => typeof folder === "string") ?? [];

  return (
    <section className="space-y-3 rounded-md border border-border/70 p-3" aria-labelledby="minio-storage-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="minio-storage-heading" className="text-sm font-medium">MinIO NAS storage</h3>
        {consoleUrl ? (
          <a href={consoleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
            Open MinIO <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        {minio.bucket ? <span className="text-xs text-muted-foreground">Bucket: {minio.bucket}</span> : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="project-repo-local-folder" className="text-(length:--text-micro) uppercase tracking-wide text-muted-foreground">REPO LOCAL FOLDER</label>
        <input
          id="project-repo-local-folder"
          className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
          value={repoLocalFolder}
          onChange={(event) => setRepoLocalFolder(event.target.value)}
          placeholder="/absolute/path/to/repository"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="project-minio-nas-folder" className="text-(length:--text-micro) uppercase tracking-wide text-muted-foreground">MinIO NAS folder</label>
        {!minio.enabled ? (
          <p className="text-xs text-muted-foreground">MinIO is not configured for this project.</p>
        ) : foldersQuery.isLoading ? (
          <p className="text-xs text-muted-foreground" role="status">Loading allowed NAS folders...</p>
        ) : foldersQuery.error ? (
          <p className="text-xs text-destructive" role="alert">{storageErrorMessage(foldersQuery.error)}</p>
        ) : folders.length === 0 ? (
          <p className="text-xs text-muted-foreground">No NAS folders are available for this project.</p>
        ) : (
          <select
            id="project-minio-nas-folder"
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
            value={nasFolder}
            onChange={(event) => setNasFolder(event.target.value)}
          >
            <option value="">No NAS folder selected</option>
            {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
          </select>
        )}
      </div>

      {showSaveError ? <p className="text-xs text-destructive" role="alert">{showSaveError}</p> : null}
      <div className="flex justify-end">
        <Button size="xs" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Saving...</> : "Save storage"}
        </Button>
      </div>
    </section>
  );
}
