import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanyArtifact } from "../api/artifacts";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { MarkdownEditor } from "./MarkdownEditor";
import { Button } from "@/components/ui/button";

export interface DocumentPanelEditorProps {
  artifact: CompanyArtifact;
  /** Called whenever the unsaved state of this document changes. */
  onDirtyChange: (id: string, dirty: boolean) => void;
}

/** The task document an artifact stands for, or null when it is not a document. */
export function artifactDocumentId(artifact: CompanyArtifact): string | null {
  return artifact.id.startsWith("document:") ? artifact.id.slice("document:".length) : null;
}

/** Edit pane editor for a Markdown task document: same MarkdownEditor and upsert (revisions) as the task page. */
export function DocumentPanelEditor({ artifact, onDirtyChange }: DocumentPanelEditorProps) {
  const queryClient = useQueryClient();
  const documentId = artifactDocumentId(artifact);
  const issueId = artifact.issue.id;
  const listQuery = useQuery({
    queryKey: queryKeys.issues.documents(issueId),
    queryFn: () => issuesApi.listDocuments(issueId),
    enabled: documentId !== null,
  });
  const summary = listQuery.data?.find((doc) => doc.id === documentId) ?? null;
  const docKey = [...queryKeys.issues.documents(issueId), "panel", summary?.key ?? ""];
  const docQuery = useQuery({
    queryKey: docKey,
    queryFn: () => issuesApi.getDocument(issueId, summary!.key),
    enabled: summary !== null && summary.format === "markdown",
  });
  const doc = docQuery.data ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = doc !== null && draft !== null && draft !== doc.body;

  useEffect(() => {
    onDirtyChange(artifact.id, dirty);
  }, [artifact.id, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(artifact.id, false), [artifact.id, onDirtyChange]);

  const save = useMutation({
    mutationFn: () =>
      issuesApi.upsertDocument(issueId, doc!.key, {
        title: doc!.title ?? null,
        format: "markdown",
        body: draft ?? doc!.body,
        baseRevisionId: doc!.latestRevisionId,
      }),
    onSuccess: (saved) => {
      setError(null);
      setDraft(null);
      queryClient.setQueryData(docKey, saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(issueId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.documentRevisions(issueId, saved.key) });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not save the document."),
  });

  // Files that are not task documents have no editor yet: show the name only.
  if (documentId === null) return <>{artifact.title}</>;
  if (listQuery.isLoading || docQuery.isLoading) return <p>Loading…</p>;
  if (listQuery.error || docQuery.error) return <p role="alert">Could not load the document.</p>;
  if (!summary || summary.format !== "markdown" || !doc) return <p>Only Markdown documents can be edited here.</p>;

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <MarkdownEditor
        value={draft ?? doc.body}
        onChange={setDraft}
        placeholder="Markdown body"
        onSubmit={() => {
          if (dirty) save.mutate();
        }}
      />
      <div>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
