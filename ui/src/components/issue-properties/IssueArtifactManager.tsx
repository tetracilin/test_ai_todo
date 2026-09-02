import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Artifact, ArtifactVersionSummary, ExternalStorageSource } from "@paperclipai/shared";
import {
  Download,

  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  History,
  MessageSquare,
  Paperclip,
  Save,
  Upload,
} from "lucide-react";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { cn, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function artifactContentPath(companyId: string, artifact: Artifact) {
  return `/api/companies/${companyId}/artifacts/${artifact.id}/content`;
}

function artifactIcon(artifact: Artifact) {
  if (artifact.format === "xlsx") return FileSpreadsheet;
  if (artifact.format === "markdown") return FileCode2;
  if (artifact.format === "docx") return FileText;
  return Paperclip;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function versionLabel(version: ArtifactVersionSummary) {
  return version.versionName?.trim() || (version.isAutomatic ? "Automatic Markdown save" : `Version ${version.versionNumber}`);
}

type OpenFileDialogProps = {
  companyId: string;
  issueId: string;
  onDone: () => void;
};

function OpenFileDialog({ companyId, issueId, onDone }: OpenFileDialogProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"internal" | "external">("internal");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedObjectKey, setSelectedObjectKey] = useState<string | null>(null);
  const [versionName, setVersionName] = useState("");
  const [prefix, setPrefix] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: storageSources } = useQuery({
    queryKey: queryKeys.issues.artifactStorageSources(companyId),
    queryFn: () => issuesApi.listArtifactStorageSources(companyId),
    enabled: open,
  });
  const externalSource = storageSources?.sources.find((entry) => entry.id === "external");
  const { data: externalObjects, isFetching: externalObjectsLoading, error: externalObjectsError } = useQuery({
    queryKey: queryKeys.issues.externalArtifactObjects(companyId, prefix),
    queryFn: () => issuesApi.listExternalArtifactObjects(companyId, prefix),
    enabled: open && source === "external" && externalSource?.configured === true,
  });
  const upload = useMutation({
    mutationFn: () => {
      if (!selectedFile) throw new Error("Choose a file from internal storage first.");
      return issuesApi.uploadArtifact(companyId, issueId, selectedFile, versionName);
    },
    onSuccess: () => {
      onDone();
      setOpen(false);
      setSelectedFile(null);
      setVersionName("");
    },
  });
  const openExternal = useMutation({
    mutationFn: () => {
      if (!selectedObjectKey) throw new Error("Choose an external storage object first.");
      return issuesApi.openArtifact(companyId, issueId, { source: "external", objectKey: selectedObjectKey, versionName });
    },
    onSuccess: () => {
      onDone();
      setOpen(false);
      setSelectedObjectKey(null);
      setVersionName("");
    },
  });
  const error = upload.error ?? openExternal.error;
  const pending = upload.isPending || openExternal.isPending;
  const configuredSources = storageSources?.sources ?? [];

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
        Open file
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-(--sz-calc-18) overflow-y-auto sm:max-w-(--sz-560px)">
          <DialogHeader>
            <DialogTitle>Open artifact file</DialogTitle>
            <DialogDescription>Attach file from internal storage or configured external NAS storage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={source === "internal" ? "default" : "outline"} onClick={() => setSource("internal")}>
                Internal storage
              </Button>
              <Button
                type="button"
                variant={source === "external" ? "default" : "outline"}
                disabled={externalSource?.configured === false}
                onClick={() => setSource("external")}
              >
                External NAS MinIO
              </Button>
            </div>
            {configuredSources.length > 0 ? (
              <p className="text-(length:--text-micro) text-muted-foreground">
                {configuredSources.map((entry: ExternalStorageSource) => `${entry.label}: ${entry.configured ? "ready" : "not configured"}`).join(" · ")}
              </p>
            ) : null}
            {source === "internal" ? (
              <div className="space-y-2">
                <Input
                  ref={fileRef}
                  type="file"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                <p className="text-(length:--text-micro) text-muted-foreground">
                  Selected file is copied into Purpose Robot internal artifact storage.
                </p>
              </div>
            ) : externalSource?.configured ? (
              <div className="space-y-2">
                <Input value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="Filter object path" />
                <div className="max-h-(--sz-220px) space-y-1 overflow-y-auto rounded-md border border-border p-1">
                  {externalObjectsLoading ? <p className="p-2 text-sm text-muted-foreground">Loading MinIO objects…</p> : null}
                  {externalObjectsError ? <p className="p-2 text-sm text-destructive">Could not load external objects.</p> : null}
                  {!externalObjectsLoading && !externalObjectsError && (externalObjects?.objects.length ?? 0) === 0 ? (
                    <p className="p-2 text-sm text-muted-foreground">No objects found.</p>
                  ) : null}
                  {externalObjects?.objects.map((object) => (
                    <button
                      type="button"
                      key={object.key}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                        selectedObjectKey === object.key && "bg-accent",
                      )}
                      onClick={() => setSelectedObjectKey(object.key)}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{object.name}</span>
                      <span className="shrink-0 text-(length:--text-micro) text-muted-foreground">{formatBytes(object.byteSize)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                External NAS MinIO storage is not configured for this server.
              </p>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="artifact-open-version-name">Initial version name</label>
              <Input id="artifact-open-version-name" value={versionName} onChange={(event) => setVersionName(event.target.value)} placeholder="Optional initial version name" />
            </div>
            {error ? <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Could not open artifact."}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button
              disabled={pending || (source === "internal" ? !selectedFile : !selectedObjectKey)}
              onClick={() => source === "internal" ? upload.mutate() : openExternal.mutate()}
            >
              {pending ? "Opening…" : "Open file"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ArtifactEditor({ artifact, companyId, onDone }: { artifact: Artifact; companyId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [markdownLoaded, setMarkdownLoaded] = useState(false);
  const [comment, setComment] = useState("");
  const [versionName, setVersionName] = useState("");
  const [editorVersionName, setEditorVersionName] = useState("");
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [editorSession, setEditorSession] = useState<{ actionUrl: string; formParameters: Record<string, string> } | null>(null);
  const replacementRef = useRef<HTMLInputElement>(null);
  const editorFormRef = useRef<HTMLFormElement>(null);
  const editorFrameName = `artifact-editor-${useId().replaceAll(":", "")}`;
  const contentPath = artifactContentPath(companyId, artifact);
  const queryClient = useQueryClient();
  const { data: versions } = useQuery({
    queryKey: queryKeys.issues.artifactVersions(companyId, artifact.id),
    queryFn: () => issuesApi.listArtifactVersions(companyId, artifact.id),
    enabled: open,
    refetchInterval: editorSession ? 5_000 : false,
  });
  const { data: comments } = useQuery({
    queryKey: queryKeys.issues.artifactComments(companyId, artifact.id),
    queryFn: () => issuesApi.listArtifactComments(companyId, artifact.id),
    enabled: open && artifact.kind === "document",
  });
  useEffect(() => {
    if (!open || artifact.format !== "markdown" || markdownLoaded) return;
    let cancelled = false;
    fetch(contentPath)
      .then((response) => response.ok ? response.text() : Promise.reject(new Error("Could not load Markdown.")))
      .then((body) => { if (!cancelled) { setMarkdown(body); setMarkdownLoaded(true); } })
      .catch(() => { if (!cancelled) setMarkdownLoaded(true); });
    return () => { cancelled = true; };
  }, [artifact.format, contentPath, markdownLoaded, open]);
  useEffect(() => {
    if (!open) setMarkdownLoaded(false);
  }, [open]);
  useEffect(() => {
    if (editorSession) editorFormRef.current?.requestSubmit();
  }, [editorSession]);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.artifacts(companyId, artifact.issueId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.artifactVersions(companyId, artifact.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.artifactComments(companyId, artifact.id) }),
    ]);
    onDone();
  };
  const saveMarkdown = useMutation({
    mutationFn: () => issuesApi.saveMarkdownArtifact(companyId, artifact.id, markdown),
    onSuccess: async () => { await invalidate(); },
  });
  const saveOfficeVersion = useMutation({
    mutationFn: () => {
      if (!replacementFile) throw new Error("Choose the edited file exported from OpenOffice.");
      if (!versionName.trim()) throw new Error("Version name is required for DOCX/XLSX saves.");
      return issuesApi.uploadArtifactVersion(companyId, artifact.id, replacementFile, versionName);
    },
    onSuccess: async () => { setReplacementFile(null); setVersionName(""); await invalidate(); },
  });
  const createEditorSession = useMutation({
    mutationFn: () => {
      if (!editorVersionName.trim()) throw new Error("Version name is required for DOCX/XLSX saves.");
      return issuesApi.createArtifactEditorSession(companyId, artifact.id, editorVersionName.trim());
    },
    onSuccess: (session) => {
      setEditorSession({ actionUrl: session.actionUrl, formParameters: session.formParameters });
    },
  });
  const addComment = useMutation({
    mutationFn: () => {
      if (!comment.trim()) throw new Error("Comment cannot be empty.");
      return issuesApi.addArtifactComment(companyId, artifact.id, comment.trim());
    },
    onSuccess: async () => { setComment(""); await queryClient.invalidateQueries({ queryKey: queryKeys.issues.artifactComments(companyId, artifact.id) }); },
  });
  const error = saveMarkdown.error ?? saveOfficeVersion.error ?? createEditorSession.error ?? addComment.error;
  const Icon = artifactIcon(artifact);
  const isOffice = artifact.format === "docx" || artifact.format === "xlsx";
  const isDocument = artifact.kind === "document";
  const closeEditor = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setEditorSession(null);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {artifact.format === "markdown" ? "Edit" : isOffice ? "Open editor" : "View versions"}
      </Button>
      <Dialog open={open} onOpenChange={closeEditor}>
        <DialogContent className="flex h-(--artifact-editor-canvas-h) w-(--artifact-editor-canvas-w) max-w-none flex-col gap-0 overflow-hidden p-0 sm:!max-w-none">
          <DialogHeader className="border-b border-border px-6 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2"><Icon className="h-5 w-5" />{artifact.name}</DialogTitle>
            <DialogDescription>
              {artifact.format === "markdown" ? "Markdown editor — each save creates an automatic version." : isOffice ? "OpenOffice document workspace — upload exported edit with a named version." : "Attachment-only artifact — version-controlled, not editable in app."}
            </DialogDescription>
          </DialogHeader>
          <div className="artifact-editor-layout grid min-h-0 flex-1">
            <main data-testid="artifact-editor-primary" className="min-h-0 overflow-auto p-4">
              {artifact.format === "markdown" ? (
                <Textarea
                  aria-label={`Edit ${artifact.name}`}
                  className="h-full min-h-(--sz-560px) resize-none font-mono"
                  value={markdown}
                  disabled={!markdownLoaded || saveMarkdown.isPending}
                  onChange={(event) => setMarkdown(event.target.value)}
                  placeholder={markdownLoaded ? "" : "Loading Markdown…"}
                />
              ) : isOffice ? (
                <div className="flex h-full min-h-(--sz-560px) flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
                    <label className="min-w-(--sz-220px) flex-1">
                      <span className="sr-only">Version name for OpenOffice save</span>
                      <Input
                        aria-label="Version name for OpenOffice save"
                        value={editorVersionName}
                        onChange={(event) => setEditorVersionName(event.target.value)}
                        placeholder="Required version name"
                      />
                    </label>
                    <Button size="sm" disabled={!editorVersionName.trim() || createEditorSession.isPending} onClick={() => createEditorSession.mutate()}>
                      {createEditorSession.isPending ? "Opening editor…" : "Edit with OpenOffice"}
                    </Button>
                    <Button asChild variant="outline" size="sm"><a href={contentPath} download={artifact.name}><Download className="mr-1.5 h-3.5 w-3.5" />Download</a></Button>
                  </div>
                  {editorSession ? (
                    <>
                      <form ref={editorFormRef} action={editorSession.actionUrl} method="post" target={editorFrameName} className="hidden" aria-hidden="true">
                        {Object.entries(editorSession.formParameters).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
                        <button type="submit">Open OpenOffice editor</button>
                      </form>
                      <iframe
                        data-testid="artifact-editor-frame"
                        name={editorFrameName}
                        title={`OpenOffice editing area for ${artifact.name}`}
                        className="min-h-0 flex-1 rounded-md border border-border bg-muted/20"
                      />
                    </>
                  ) : (
                    <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                      Select Edit with OpenOffice to start a secure browser editor session.
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-(--sz-560px) flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted/20 text-center">
                  <Paperclip className="h-8 w-8 text-muted-foreground" />
                  <div><p className="font-medium">Attachment-only artifact</p><p className="text-sm text-muted-foreground">Download file or upload a named replacement version.</p></div>
                  <Button asChild variant="outline"><a href={contentPath} download={artifact.name}>Download attachment</a></Button>
                </div>
              )}
            </main>
            <aside className="min-h-0 overflow-y-auto border-l border-border p-4">
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4" />Versions</h3>
                <div className="space-y-1">
                  {versions?.versions.map((version) => (
                    <a key={version.id} href={`/api/companies/${companyId}/artifacts/${artifact.id}/versions/${version.id}/content`} target="_blank" rel="noreferrer" className="block rounded-md border border-border p-2 text-sm hover:bg-accent">
                      <p className="truncate font-medium">v{version.versionNumber} · {versionLabel(version)}</p>
                      <p className="text-(length:--text-micro) text-muted-foreground">{version.isAutomatic ? "Automatic" : "Named"} · {formatBytes(version.byteSize)} · {relativeTime(version.createdAt)}</p>
                    </a>
                  )) ?? <p className="text-sm text-muted-foreground">Loading versions…</p>}
                </div>
              </section>
              {isOffice || artifact.kind === "attachment" ? (
                <section className="mt-5 space-y-2 border-t border-border pt-4">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Upload className="h-4 w-4" />Save new version</h3>
                  <Input ref={replacementRef} type="file" accept={artifact.format === "docx" ? ".docx" : artifact.format === "xlsx" ? ".xlsx" : undefined} onChange={(event) => setReplacementFile(event.target.files?.[0] ?? null)} />
                  <Input value={versionName} onChange={(event) => setVersionName(event.target.value)} placeholder="Required version name" />
                  <Button className="w-full" size="sm" disabled={!replacementFile || !versionName.trim() || saveOfficeVersion.isPending} onClick={() => saveOfficeVersion.mutate()}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />{saveOfficeVersion.isPending ? "Saving…" : "Save version"}
                  </Button>
                </section>
              ) : null}
              {isDocument ? (
                <section className="mt-5 space-y-2 border-t border-border pt-4">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="h-4 w-4" />Comments</h3>
                  <div className="max-h-(--sz-220px) space-y-2 overflow-y-auto">
                    {comments?.comments.map((entry) => <div key={entry.id} className="rounded-md bg-muted/50 p-2 text-sm"><p>{entry.body}</p><p className="mt-1 text-(length:--text-micro) text-muted-foreground">{relativeTime(entry.createdAt)}</p></div>)}
                    {(comments?.comments.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
                  </div>
                  <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add document comment" />
                  <Button className="w-full" variant="outline" size="sm" disabled={!comment.trim() || addComment.isPending} onClick={() => addComment.mutate()}>{addComment.isPending ? "Posting…" : "Post comment"}</Button>
                </section>
              ) : null}
            </aside>
          </div>
          {error ? <p className="border-t border-destructive/30 bg-destructive/5 px-6 py-2 text-sm text-destructive">{error instanceof Error ? error.message : "Artifact action failed."}</p> : null}
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => closeEditor(false)}>Close</Button>
            {artifact.format === "markdown" ? <Button disabled={!markdownLoaded || saveMarkdown.isPending} onClick={() => saveMarkdown.mutate()}><Save className="mr-1.5 h-3.5 w-3.5" />{saveMarkdown.isPending ? "Saving…" : "Save automatic version"}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function IssueArtifactManager({ companyId, issueId }: { companyId: string; issueId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.artifacts(companyId, issueId),
    queryFn: () => issuesApi.listArtifacts(companyId, issueId),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.issues.artifacts(companyId, issueId) });
  const artifacts = useMemo(() => data?.artifacts ?? [], [data?.artifacts]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div><h3 className="text-sm font-semibold">Artifact files</h3><p className="text-(length:--text-micro) text-muted-foreground">Documents are editable and versioned. Other files stay version-controlled attachments.</p></div>
        <OpenFileDialog companyId={companyId} issueId={issueId} onDone={refresh} />
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading artifacts…</p> : null}
      {error ? <p className="text-sm text-destructive">Could not load artifacts.</p> : null}
      {!isLoading && !error && artifacts.length === 0 ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No artifact files. Use Open file to attach internal or MinIO storage content.</p> : null}
      <div className="space-y-2">
        {artifacts.map((artifact) => {
          const Icon = artifactIcon(artifact);
          return <div key={artifact.id} className="flex items-center gap-3 rounded-md border border-border bg-card/50 p-3"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{artifact.name}</p><p className="text-(length:--text-micro) text-muted-foreground">{artifact.kind === "document" ? `${artifact.format?.toUpperCase()} document` : "Attachment"} · v{artifact.currentVersionNumber}</p></div><ArtifactEditor artifact={artifact} companyId={companyId} onDone={refresh} /></div>;
        })}
      </div>
    </section>
  );
}
