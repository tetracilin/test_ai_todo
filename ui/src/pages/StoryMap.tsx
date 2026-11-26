import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Map as MapIcon, PanelRightOpen, Plus } from "lucide-react";
import { scratchPadApi } from "../api/scratchPad";
import { storyMapApi } from "../api/storyMap";
import { Link } from "../lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import {
  UNSCHEDULED_ROW,
  beforeIdForStep,
  buildStoryMapLayout,
  dragKey,
  formatReleaseDate,
  resolveDrop,
  type MovableKind,
  type StoryMapColumn,
} from "../lib/storyMapLayout";
import { CellDrop, DragItem, MoveMenu, type MoveMenuItem } from "../components/StoryMapDnd";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StoryMapTabs } from "../components/StoryMapTabs";
import { StoryDetailPanel, type DetailTarget } from "../components/StoryDetailPanel";
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
  /** May return a promise. The box stays open, with the text, if it rejects. */
  onSave: (next: string) => unknown;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

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
    if (saving) return;
    const next = draft.trim();
    if (!save || !next || next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    Promise.resolve(onSave(next))
      .then(() => setEditing(false))
      .catch(() => undefined) // The page shows the error; the typed text stays here.
      .finally(() => setSaving(false));
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
  /** May return a promise. The form stays open, with the text, if it rejects. */
  onAdd: (name: string, date: string | null) => unknown;
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
    Promise.resolve(onAdd(trimmed, date || null))
      .then(() => {
        setName("");
        setDate("");
        setOpen(false);
      })
      .catch(() => undefined); // The page shows the error; the typed text stays here.
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

/** Prefer the card under the pointer over the cell around it, and never the dragged card itself. */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args).filter((hit) => hit.id !== args.active.id);
  const cards = hits.filter((hit) => !String(hit.id).startsWith("cell:"));
  return cards.length > 0 ? cards : hits;
};

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

  // Stories promoted from a scratch pad note link back to the scratch pad.
  const { data: scratchPad } = useQuery({
    queryKey: queryKeys.scratchPad.list(selectedCompanyId ?? ""),
    queryFn: () => scratchPadApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const promotedStoryIds = new Set(
    (scratchPad?.notes ?? []).flatMap((note) => (note.promotedStoryId ? [note.promotedStoryId] : [])),
  );

  const change = useMutation<unknown, Error, () => Promise<unknown>>({
    mutationFn: (action) => action(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.storyMap.tree(selectedCompanyId ?? "") }),
  });

  const [detail, setDetail] = useState<DetailTarget | null>(null);

  // A small movement is a click (rename, menu); a longer one starts a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent) {
    if (!tree || !selectedCompanyId) return;
    const plan = resolveDrop(String(event.active.id), event.over ? String(event.over.id) : null, tree);
    if (plan) {
      const companyForMove = selectedCompanyId;
      void change.mutateAsync(() => storyMapApi.move(companyForMove, plan.kind, plan.id, plan.body)).catch(() => undefined);
    }
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={MapIcon} message="Select a company to view its story map." />;
  }
  if (isLoading || !tree) {
    return error ? <p className="text-sm text-destructive">{error.message}</p> : <PageSkeleton variant="list" />;
  }

  const companyId = selectedCompanyId;
  const layout = buildStoryMapLayout(tree);
  // run() waits for the result, so a form can keep its text when the save fails.
  const run = (action: () => Promise<unknown>) => change.mutateAsync(action);
  const moveTo = (kind: MovableKind, id: string, body: { beforeId?: string | null; releaseId?: string | null }) => {
    void run(() => storyMapApi.move(companyId, kind, id, body)).catch(() => undefined); // error is shown above the map
  };

  const openButton = (target: DetailTarget, label: string) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Open ${label}`}
      onClick={() => setDetail(target)}
    >
      <PanelRightOpen />
    </Button>
  );

  /** "Move earlier / later" entries for the menu, from the ordered ids of the item's siblings. */
  function stepItems(kind: MovableKind, ids: string[], id: string, earlier: string, later: string): MoveMenuItem[] {
    return (["earlier", "later"] as const).map((direction) => {
      const beforeId = beforeIdForStep(ids, id, direction);
      return {
        label: direction === "earlier" ? earlier : later,
        disabled: beforeId === undefined,
        onSelect: () => moveTo(kind, id, { beforeId: beforeId ?? null }),
      };
    });
  }

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

      <StoryMapTabs />

      {change.error ? <p className="text-sm text-destructive">{change.error.message}</p> : null}

      {layout.groups.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          message="No activities yet. Add the first step of your user's journey."
        />
      ) : (
        <div className="overflow-x-auto border-t border-l border-border">
          <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
          <div className="grid" style={{ gridTemplateColumns }} role="grid" aria-label="Story map">
            {/* Activities */}
            <div className={`${cell} text-xs text-muted-foreground`}>Activities</div>
            {layout.groups.map(({ activity, columns }) => (
              <div
                key={activity.id}
                className={`${cell} bg-muted/30`}
                style={{ gridColumn: `span ${Math.max(columns.length, 1)}` }}
              >
                <DragItem dragKey={dragKey.activity(activity.id)} label={`activity ${activity.name}`}>
                  <div className="flex items-center justify-between gap-1">
                    <InlineText
                      value={activity.name}
                      label={`activity ${activity.name}`}
                      className="font-medium"
                      onSave={(name) => run(() => storyMapApi.updateActivity(companyId, activity.id, { name }))}
                    />
                    <MoveMenu
                      label={`activity ${activity.name}`}
                      items={stepItems(
                        "activities",
                        layout.groups.map((g) => g.activity.id),
                        activity.id,
                        "Move left",
                        "Move right",
                      )}
                    />
                  </div>
                </DragItem>
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
                  <DragItem dragKey={dragKey.task(column.task.id)} label={`task ${column.task.name}`}>
                    <div className="flex items-center justify-between gap-1">
                      <InlineText
                        value={column.task.name}
                        label={`task ${column.task.name}`}
                        onSave={(name) => run(() => storyMapApi.updateTask(companyId, column.task.id, { name }))}
                      />
                      <MoveMenu
                        label={`task ${column.task.name}`}
                        items={stepItems(
                          "tasks",
                          (layout.groups.find((g) => g.activity.id === column.task.activityId)?.columns ?? []).map(
                            (c) => c.task.id,
                          ),
                          column.task.id,
                          "Move left",
                          "Move right",
                        )}
                      />
                    </div>
                  </DragItem>
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
                      <DragItem key={epic.id} dragKey={dragKey.epic(epic.id)} label={`epic ${epic.name}`}>
                        <div className="flex items-center justify-between gap-1">
                          <InlineText
                            value={epic.name}
                            label={`epic ${epic.name}`}
                            className="text-sm text-muted-foreground"
                            onSave={(name) => run(() => storyMapApi.updateEpic(companyId, epic.id, { name }))}
                          />
                          {openButton({ kind: "epic", id: epic.id }, `epic ${epic.name}`)}
                          <MoveMenu
                            label={`epic ${epic.name}`}
                            items={stepItems(
                              "epics",
                              column.epics.map((e) => e.id),
                              epic.id,
                              "Move up",
                              "Move down",
                            )}
                          />
                        </div>
                      </DragItem>
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
                        <CellDrop dropKey={dragKey.cell(column.task.id, row.key)}>
                          {layout.storiesAt(column.task.id, row.key).map((story) => {
                            const epic = layout.epicById(story.epicId);
                            return (
                              <DragItem
                                key={story.id}
                                dragKey={dragKey.story(story.id)}
                                label={`story ${story.title}`}
                                className="border border-border bg-card p-2 text-sm"
                              >
                                {epic ? <div className="text-xs text-muted-foreground">{epic.name}</div> : null}
                                {promotedStoryIds.has(story.id) ? (
                                  <Link to="/scratch-pad" className="text-xs underline">
                                    From scratch pad
                                  </Link>
                                ) : null}
                                <div className="flex items-center justify-between gap-1">
                                  <InlineText
                                    value={story.title}
                                    label={`story ${story.title}`}
                                    onSave={(title) => run(() => storyMapApi.updateStory(companyId, story.id, { title }))}
                                  />
                                  {openButton({ kind: "story", id: story.id }, `story ${story.title}`)}
                                  <MoveMenu
                                    label={`story ${story.title}`}
                                    items={stepItems(
                                      "stories",
                                      layout.storiesAt(column.task.id, row.key).map((s) => s.id),
                                      story.id,
                                      "Move up",
                                      "Move down",
                                    )}
                                    releaseHeading="Move to release"
                                    releaseItems={layout.rows.map((target) => ({
                                      label: target.release?.name ?? "Unscheduled",
                                      disabled: target.key === row.key,
                                      onSelect: () =>
                                        moveTo("stories", story.id, {
                                          releaseId: target.key === UNSCHEDULED_ROW ? null : target.key,
                                        }),
                                    }))}
                                  />
                                </div>
                              </DragItem>
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
                        </CellDrop>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          </DndContext>
        </div>
      )}

      <StoryDetailPanel
        tree={tree}
        target={detail}
        onClose={() => setDetail(null)}
        onSaveStory={(id, patch) =>
          run(() => storyMapApi.updateStory(companyId, id, patch))
            .then(() => setDetail(null))
            .catch(() => undefined)
        }
        onSaveEpic={(id, patch) =>
          run(() => storyMapApi.updateEpic(companyId, id, patch))
            .then(() => setDetail(null))
            .catch(() => undefined)
        }
      />
    </div>
  );
}
