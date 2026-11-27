import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StickyNote } from "lucide-react";
import { SCRATCH_NOTE_MAX_LENGTH, type ScratchNoteView } from "@paperclipai/shared";
import { scratchPadApi } from "../api/scratchPad";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime } from "../lib/utils";
import { Link } from "../lib/router";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function NoteCard({
  note,
  isMine,
  canModerate,
  busy,
  onEdit,
  onDelete,
  onPromote,
  onArchive,
}: {
  note: ScratchNoteView;
  isMine: boolean;
  canModerate: boolean;
  /** Returns a promise; the editor stays open, with the text, if it rejects. */
  onEdit: (body: string) => Promise<unknown>;
  /** A request is open. Controls are disabled so a double click cannot repeat it. */
  busy: boolean;
  onDelete: () => void;
  onPromote: () => void;
  onArchive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [saving, setSaving] = useState(false);

  return (
    <article className="space-y-2 border border-border bg-card p-3" data-note-id={note.id} aria-label="Note">
      {editing ? (
        <div className="space-y-2">
          <Textarea
            aria-label="Edit note"
            value={draft}
            maxLength={SCRATCH_NOTE_MAX_LENGTH}
            disabled={busy || saving}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || saving || draft.trim().length === 0}
              onClick={() => {
                if (saving) return;
                setSaving(true);
                onEdit(draft.trim())
                  .then(() => setEditing(false))
                  .catch(() => undefined) // the page shows the error
                  .finally(() => setSaving(false));
              }}
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{note.body}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{note.authorName ?? "Unknown member"}</span>
        <time dateTime={new Date(note.createdAt).toISOString()}>{relativeTime(note.createdAt)}</time>
        {note.status === "promoted" ? (
          <Badge variant="secondary">
            Promoted to a story
          </Badge>
        ) : null}
        {note.status === "archived" ? <Badge variant="outline">Archived</Badge> : null}
        {note.status === "promoted" ? (
          <Link to="/story-map" className="underline">
            View on the story map
          </Link>
        ) : null}
      </div>

      {(isMine && !editing) || (canModerate && note.status === "active") ? (
        <div className="flex flex-wrap gap-1">
          {isMine && !editing ? (
            <>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setDraft(note.body);
                  setEditing(true);
                }}
              >
                Edit
              </Button>
              <Button type="button" size="xs" variant="outline" disabled={busy} onClick={onDelete}>
                Delete
              </Button>
            </>
          ) : null}
          {canModerate && note.status === "active" ? (
            <>
              <Button type="button" size="xs" disabled={busy} onClick={onPromote}>
                Promote to story
              </Button>
              <Button type="button" size="xs" variant="outline" disabled={busy} onClick={onArchive}>
                Archive
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * The page is keyed by company, so a draft, an open editor and the archived toggle never
 * follow the user into another company.
 */
export function ScratchPad() {
  const { selectedCompanyId } = useCompany();
  return <ScratchPadForCompany key={selectedCompanyId ?? "none"} />;
}

function ScratchPadForCompany() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  // A ref, not state: it must block a second submit that arrives before React re-renders.
  const sending = useRef(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Scratch pad" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.scratchPad.list(selectedCompanyId ?? ""),
    queryFn: () => scratchPadApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const change = useMutation<unknown, Error, () => Promise<unknown>>({
    mutationFn: (action) => action(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scratchPad.list(selectedCompanyId ?? "") });
      // A promoted note adds a story to the map.
      void queryClient.invalidateQueries({ queryKey: queryKeys.storyMap.tree(selectedCompanyId ?? "") });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={StickyNote} message="Select a company to use its scratch pad." />;
  }
  if (isLoading || !data) {
    return error ? <p className="text-sm text-destructive">{error.message}</p> : <PageSkeleton variant="list" />;
  }

  const companyId = selectedCompanyId;
  const visible = data.notes.filter((note) => showArchived || note.status !== "archived");
  const hasArchived = data.notes.some((note) => note.status === "archived");

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Scratch pad</h1>
      <p role="note" className="border border-border bg-muted/30 p-3 text-sm">
        Write ideas as plain text. Do not write client names or confidential material.
      </p>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const body = draft.trim();
          if (!body || sending.current) return;
          sending.current = true;
          // Clear the box only once the note is saved, so a failed save keeps the text.
          change
            .mutateAsync(() => scratchPadApi.create(companyId, { body }))
            // Clear only what was sent. Anything typed while it saved stays.
            .then(() => setDraft((current) => (current.trim() === body ? "" : current)))
            .catch(() => undefined)
            .finally(() => {
              sending.current = false;
            });
        }}
      >
        <Textarea
          aria-label="New note"
          placeholder="Write an idea"
          value={draft}
          maxLength={SCRATCH_NOTE_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={change.isPending || draft.trim().length === 0}>
            Save
          </Button>
          <span className="text-xs text-muted-foreground">
            {draft.length} / {SCRATCH_NOTE_MAX_LENGTH}
          </span>
        </div>
      </form>

      {change.error ? <p className="text-sm text-destructive">{change.error.message}</p> : null}

      {data.canModerate && hasArchived ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          Show archived notes
        </label>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState icon={StickyNote} message="No notes yet. Write the first idea." />
      ) : (
        <div className="space-y-3" aria-label="Notes">
          {visible.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isMine={note.authorUserId === data.viewerUserId}
              canModerate={data.canModerate}
              busy={change.isPending}
              onEdit={(body) => change.mutateAsync(() => scratchPadApi.update(companyId, note.id, { body }))}
              onDelete={() => change.mutate(() => scratchPadApi.remove(companyId, note.id))}
              onPromote={() => change.mutate(() => scratchPadApi.promote(companyId, note.id))}
              onArchive={() => change.mutate(() => scratchPadApi.archive(companyId, note.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
