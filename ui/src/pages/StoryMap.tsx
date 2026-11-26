import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, Plus } from "lucide-react";
import { storyMapApi } from "../api/storyMap";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import {
  UNSCHEDULED_ROW,
  buildStoryMapLayout,
  formatReleaseDate,
  type StoryMapColumn,
} from "../lib/storyMapLayout";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A name that turns into a text box on click. Enter saves, Escape cancels. */
function InlineText({
  value,
  label,
  onSave,
  className,
}: {
  value: string;
  label: string;
  onSave: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        type="button"
        className={`text-left hover:underline ${className ?? ""}`}
        aria-label={`Rename ${label}`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  }

  function finish(save: boolean) {
    const next = draft.trim();
    setEditing(false);
    if (save && next && next !== value) onSave(next);
  }

  return (
    <Input
      autoFocus
      aria-label={`Name of ${label}`}
      value={draft}
      maxLength={200}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
    />
  );
}

/** A small "+ Add ..." button that opens a one-line form. */
function AddInline({
  label,
  withDate = false,
  onAdd,
}: {
  label: string;
  withDate?: boolean;
  onAdd: (name: string, date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="xs" aria-label={label} onClick={() => setOpen(true)}>
        <Plus />
        {label}
      </Button>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, date || null);
    setName("");
    setDate("");
    setOpen(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <Input
        autoFocus
        aria-label={`${label}: name`}
        value={name}
        maxLength={200}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {withDate ? (
        <Input
          type="date"
          aria-label={`${label}: target date`}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      ) : null}
      <div className="flex gap-1">
        <Button type="submit" size="xs">
          Add
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const ROW_LABEL_COLUMN = "10rem";
const TASK_COLUMN = "14rem";

export function StoryMap() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Story map" }]);
  }, [setBreadcrumbs]);

  const { data: tree, isLoading, error } = useQuery({
    queryKey: queryKeys.storyMap.tree(selectedCompanyId ?? ""),
    queryFn: () => storyMapApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const change = useMutation<unknown, Error, () => Promise<unknown>>({
    mutationFn: (action) => action(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.storyMap.tree(selectedCompanyId ?? "") }),
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={MapIcon} message="Select a company to view its story map." />;
  }
  if (isLoading || !tree) {
    return error ? <p className="text-sm text-destructive">{error.message}</p> : <PageSkeleton variant="list" />;
  }

  const companyId = selectedCompanyId;
  const layout = buildStoryMapLayout(tree);
  const run = (action: () => Promise<unknown>) => change.mutate(action);

  // One grid slot per task. An activity without tasks still gets one empty slot.
  const slots = layout.groups.flatMap((group): Array<{ column: StoryMapColumn | null }> =>
    group.columns.length > 0 ? group.columns.map((column) => ({ column })) : [{ column: null }],
  );
  const gridTemplateColumns = `${ROW_LABEL_COLUMN} repeat(${Math.max(slots.length, 1)}, ${TASK_COLUMN})`;

  const cell = "border-b border-r border-border p-2 space-y-1";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-lg font-semibold">Story map</h1>
        <div className="flex flex-wrap items-start gap-2">
          <AddInline
            label="Add activity"
            onAdd={(name) => run(() => storyMapApi.createActivity(companyId, { name }))}
          />
          <AddInline
            label="Add release"
            withDate
            onAdd={(name, targetDate) => run(() => storyMapApi.createRelease(companyId, { name, targetDate }))}
          />
        </div>
      </div>

      {change.error ? <p className="text-sm text-destructive">{change.error.message}</p> : null}

      {layout.groups.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          message="No activities yet. Add the first step of your user's journey."
        />
      ) : (
        <div className="overflow-x-auto border-t border-l border-border">
          <div className="grid" style={{ gridTemplateColumns }} role="grid" aria-label="Story map">
            {/* Activities */}
            <div className={`${cell} text-xs text-muted-foreground`}>Activities</div>
            {layout.groups.map(({ activity, columns }) => (
              <div
                key={activity.id}
                className={`${cell} bg-muted/30`}
                style={{ gridColumn: `span ${Math.max(columns.length, 1)}` }}
              >
                <InlineText
                  value={activity.name}
                  label={`activity ${activity.name}`}
                  className="font-medium"
                  onSave={(name) => run(() => storyMapApi.updateActivity(companyId, activity.id, { name }))}
                />
                <AddInline
                  label={`Add task to ${activity.name}`}
                  onAdd={(name) => run(() => storyMapApi.createTask(companyId, { activityId: activity.id, name }))}
                />
              </div>
            ))}

            {/* Tasks */}
            <div className={`${cell} text-xs text-muted-foreground`}>Tasks</div>
            {slots.map(({ column }, index) => (
              <div key={column?.task.id ?? `empty-${index}`} className={`${cell} bg-muted/20`}>
                {column ? (
                  <InlineText
                    value={column.task.name}
                    label={`task ${column.task.name}`}
                    onSave={(name) => run(() => storyMapApi.updateTask(companyId, column.task.id, { name }))}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">No tasks yet</span>
                )}
              </div>
            ))}

            {/* Epics (optional level) */}
            <div className={`${cell} text-xs text-muted-foreground`}>Epics</div>
            {slots.map(({ column }, index) => (
              <div key={column?.task.id ?? `epics-${index}`} className={cell}>
                {column ? (
                  <>
                    {column.epics.map((epic) => (
                      <InlineText
                        key={epic.id}
                        value={epic.name}
                        label={`epic ${epic.name}`}
                        className="text-sm text-muted-foreground"
                        onSave={(name) => run(() => storyMapApi.updateEpic(companyId, epic.id, { name }))}
                      />
                    ))}
                    <AddInline
                      label={`Add epic to ${column.task.name}`}
                      onAdd={(name) => run(() => storyMapApi.createEpic(companyId, { taskId: column.task.id, name }))}
                    />
                  </>
                ) : null}
              </div>
            ))}

            {/* Release rows, then Unscheduled */}
            {layout.rows.map((row) => {
              const rowName = row.release?.name ?? "Unscheduled";
              const date = formatReleaseDate(row.release?.targetDate ?? null);
              return (
                <div key={row.key} className="contents" role="row" aria-label={rowName}>
                  <div className={`${cell} bg-muted/30`}>
                    {row.release ? (
                      <InlineText
                        value={row.release.name}
                        label={`release ${row.release.name}`}
                        className="font-medium"
                        onSave={(name) => run(() => storyMapApi.updateRelease(companyId, row.release!.id, { name }))}
                      />
                    ) : (
                      <span className="font-medium">Unscheduled</span>
                    )}
                    {date ? <div className="text-xs text-muted-foreground">{date}</div> : null}
                  </div>
                  {slots.map(({ column }, index) => (
                    <div key={column?.task.id ?? `${row.key}-${index}`} className={cell}>
                      {column ? (
                        <>
                          {layout.storiesAt(column.task.id, row.key).map((story) => {
                            const epic = layout.epicById(story.epicId);
                            return (
                              <div key={story.id} className="border border-border bg-card p-2 text-sm">
                                {epic ? <div className="text-xs text-muted-foreground">{epic.name}</div> : null}
                                <InlineText
                                  value={story.title}
                                  label={`story ${story.title}`}
                                  onSave={(title) => run(() => storyMapApi.updateStory(companyId, story.id, { title }))}
                                />
                              </div>
                            );
                          })}
                          <AddInline
                            label={`Add story to ${column.task.name} in ${rowName}`}
                            onAdd={(title) =>
                              run(() =>
                                storyMapApi.createStory(companyId, {
                                  taskId: column.task.id,
                                  title,
                                  releaseId: row.key === UNSCHEDULED_ROW ? null : row.key,
                                }),
                              )
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
