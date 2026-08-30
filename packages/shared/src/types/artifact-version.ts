import type {
  ArtifactEditableFormat,
  ArtifactKind,
  ArtifactVersionSource,
  StorageProvider,
} from "../constants.js";

export interface ArtifactVersionSummary {
  id: string;
  artifactId: string;
  versionNumber: number;
  versionName: string | null;
  source: ArtifactVersionSource;
  provider: StorageProvider;
  contentType: string;
  byteSize: number;
  changeSummary: string | null;
  isAutomatic: boolean;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: string;
}

export interface ArtifactComment {
  id: string;
  artifactId: string;
  body: string;
  authorUserId: string | null;
  authorAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  companyId: string;
  issueId: string;
  kind: ArtifactKind;
  format: ArtifactEditableFormat | null;
  name: string;
  contentType: string;
  currentVersionId: string | null;
  currentVersionNumber: number;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  contentPath: string;
}

export interface ArtifactWithCurrentVersion extends Artifact {
  currentVersion: ArtifactVersionSummary | null;
}

export interface ArtifactVersionsResponse {
  artifact: Artifact;
  versions: ArtifactVersionSummary[];
}

export interface ArtifactCommentsResponse {
  artifact: Artifact;
  comments: ArtifactComment[];
}

export interface ExternalStorageObject {
  key: string;
  name: string;
  byteSize: number;
  lastModified: string | null;
  contentType: string | null;
}

export interface ExternalStorageSource {
  id: string;
  label: string;
  provider: StorageProvider;
  configured: boolean;
}
