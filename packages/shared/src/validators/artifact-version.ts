import { z } from "zod";
import {
  ARTIFACT_EDITABLE_FORMATS,
  ARTIFACT_KINDS,
  ARTIFACT_VERSION_SOURCES,
} from "../constants.js";
import { multilineTextSchema } from "./text.js";

export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export const artifactEditableFormatSchema = z.enum(ARTIFACT_EDITABLE_FORMATS);
export const artifactVersionSourceSchema = z.enum(ARTIFACT_VERSION_SOURCES);

export const ARTIFACT_NAME_MAX_LENGTH = 255;
export const ARTIFACT_VERSION_NAME_MAX_LENGTH = 200;
export const ARTIFACT_CHANGE_SUMMARY_MAX_LENGTH = 500;
export const ARTIFACT_COMMENT_MAX_LENGTH = 10_000;

// Metadata supplied alongside the multipart upload when creating an artifact.
export const createArtifactSchema = z.object({
  issueId: z.string().guid(),
  versionName: z.string().trim().min(1).max(ARTIFACT_VERSION_NAME_MAX_LENGTH).optional(),
});

export type CreateArtifact = z.infer<typeof createArtifactSchema>;

// Body for opening an existing object from a storage source (internal/external)
// and attaching it to a task as a new artifact.
export const openArtifactSchema = z.object({
  issueId: z.string().guid(),
  source: artifactVersionSourceSchema,
  objectKey: z.string().min(1).max(4096),
  versionName: z.string().trim().min(1).max(ARTIFACT_VERSION_NAME_MAX_LENGTH).optional(),
});

export type OpenArtifact = z.infer<typeof openArtifactSchema>;

// Body for saving a markdown edit. Markdown saves always create a new version.
export const saveMarkdownArtifactSchema = z.object({
  body: multilineTextSchema.pipe(z.string().max(524288)),
  changeSummary: z.string().trim().max(ARTIFACT_CHANGE_SUMMARY_MAX_LENGTH).nullable().optional(),
});

export type SaveMarkdownArtifact = z.infer<typeof saveMarkdownArtifactSchema>;

// Body for creating a manually named version (docx/xlsx), carried with the
// multipart upload of the new content.
export const createArtifactVersionSchema = z.object({
  versionName: z.string().trim().min(1).max(ARTIFACT_VERSION_NAME_MAX_LENGTH),
  changeSummary: z.string().trim().max(ARTIFACT_CHANGE_SUMMARY_MAX_LENGTH).nullable().optional(),
});

export type CreateArtifactVersion = z.infer<typeof createArtifactVersionSchema>;

// A browser Office editor cannot be trusted to send a user-controlled name
// with its WOPI PutFile callback. Capture and validate it before issuing the
// opaque editor session token, then bind it to that server-side session.
export const createArtifactEditorSessionSchema = z.object({
  versionName: z.string().trim().min(1).max(ARTIFACT_VERSION_NAME_MAX_LENGTH),
});

export type CreateArtifactEditorSession = z.infer<typeof createArtifactEditorSessionSchema>;

export const restoreArtifactVersionSchema = z.object({
  versionName: z.string().trim().min(1).max(ARTIFACT_VERSION_NAME_MAX_LENGTH).optional(),
});

export type RestoreArtifactVersion = z.infer<typeof restoreArtifactVersionSchema>;

export const createArtifactCommentSchema = z.object({
  body: multilineTextSchema.pipe(z.string().trim().min(1).max(ARTIFACT_COMMENT_MAX_LENGTH)),
});

export type CreateArtifactComment = z.infer<typeof createArtifactCommentSchema>;

export const listExternalStorageObjectsSchema = z.object({
  prefix: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(200),
});

export type ListExternalStorageObjects = z.infer<typeof listExternalStorageObjectsSchema>;

// Derive an artifact's editable document kind from its content type and file name.
// Returns null for attachment-only file types.
export function classifyArtifactFormat(input: {
  contentType?: string | null;
  filename?: string | null;
}): typeof ARTIFACT_EDITABLE_FORMATS[number] | null {
  const contentType = (input.contentType ?? "").toLowerCase();
  const filename = (input.filename ?? "").toLowerCase();

  if (contentType === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) {
    return "markdown";
  }
  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.endsWith(".docx")
  ) {
    return "docx";
  }
  if (
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    filename.endsWith(".xlsx")
  ) {
    return "xlsx";
  }
  return null;
}
