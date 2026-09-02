import type {
  Project,
  ProjectWorkspace,
  WorkspaceOperation,
  WorkspaceRuntimeControlTarget,
} from "@paperclipai/shared";
import { api } from "./client";
import { sanitizeWorkspaceRuntimeControlTarget } from "./workspace-runtime-control";

export interface ProjectMinioStorageConfig {
  enabled: boolean;
  consoleUrl: string | null;
  bucket: string | null;
  nasFolder: string | null;
}

export interface ProjectStorageConfig {
  projectId: string;
  repoLocalFolder: string | null;
  minio: ProjectMinioStorageConfig;
}

export interface ProjectStorageConfigUpdate {
  repoLocalFolder?: string | null;
  nasFolder?: string | null;
}

export interface ProjectMinioFoldersResponse {
  folders: string[];
}

function withCompanyScope(path: string, companyId?: string) {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}companyId=${encodeURIComponent(companyId)}`;
}

function projectPath(id: string, companyId?: string, suffix = "") {
  return withCompanyScope(`/projects/${encodeURIComponent(id)}${suffix}`, companyId);
}

export const projectsApi = {
  list: (companyId: string, opts: { includeArchived?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (opts.includeArchived) params.set("includeArchived", "true");
    const query = params.toString();
    return api.get<Project[]>("/companies/" + encodeURIComponent(companyId) + "/projects" + (query ? "?" + query : ""));
  },
  get: (id: string, companyId?: string) => api.get<Project>(projectPath(id, companyId)),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/companies/${companyId}/projects`, data),
  update: (id: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<Project>(projectPath(id, companyId), data),
  getStorageConfig: (projectId: string) =>
    api.get<ProjectStorageConfig>(`/projects/${encodeURIComponent(projectId)}/storage-config`),
  updateStorageConfig: (projectId: string, data: ProjectStorageConfigUpdate) =>
    api.put<ProjectStorageConfig>(`/projects/${encodeURIComponent(projectId)}/storage-config`, data),
  listMinioFolders: (projectId: string) =>
    api.get<ProjectMinioFoldersResponse>(`/projects/${encodeURIComponent(projectId)}/minio-folders`),
  listWorkspaces: (projectId: string, companyId?: string) =>
    api.get<ProjectWorkspace[]>(projectPath(projectId, companyId, "/workspaces")),
  createWorkspace: (projectId: string, data: Record<string, unknown>, companyId?: string) =>
    api.post<ProjectWorkspace>(projectPath(projectId, companyId, "/workspaces"), data),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<ProjectWorkspace>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`),
      data,
    ),
  controlWorkspaceRuntimeServices: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart",
    companyId?: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}`),
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  controlWorkspaceCommands: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart" | "run",
    companyId?: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-commands/${action}`),
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  removeWorkspace: (projectId: string, workspaceId: string, companyId?: string) =>
    api.delete<ProjectWorkspace>(projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  remove: (id: string, companyId?: string) => api.delete<Project>(projectPath(id, companyId)),
};
