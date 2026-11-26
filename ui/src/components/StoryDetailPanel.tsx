import { type ReactNode, useState } from "react";
import type { StoryMapStoryStatus, StoryMapTree } from "@paperclipai/shared";
import { STORY_MAP_STORY_STATUSES } from "@paperclipai/shared";
import { STORY_STATUS_LABELS } from "../lib/storyMapBacklog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const STORY_SIZES = ["XS", "S", "M", "L", "XL"] as const;

export type DetailTarget = { kind: "story" | "epic"; id: string };

export interface StoryPatch {
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  size: string | null;
  status: StoryMapStoryStatus;
  epicId: string | null;
}

export interface EpicPatch {
  name: string;
  description: string | null;
}

const NONE = "";
const selectClass = "h-9 w-full border border-input bg-background px-2 text-sm";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function StoryForm({
  tree,
  storyId,
  onSave,
}: {
  tree: StoryMapTree;
  storyId: string;
  onSave: (patch: StoryPatch) => void;
}) {
  const story = tree.stories.find((item) => item.id === storyId);
  const [title, setTitle] = useState(story?.title ?? "");
  const [description, setDescription] = useState(story?.description ?? "");
  const [acceptance, setAcceptance] = useState(story?.acceptanceCriteria ?? "");
  const [size, setSize] = useState(story?.size ?? NONE);
  const [status, setStatus] = useState<StoryMapStoryStatus>(story?.status ?? "planned");
  const [epicId, setEpicId] = useState(story?.epicId ?? NONE);
  if (!story) return <p className="p-4 text-sm text-muted-foreground">This story no longer exists.</p>;

  const epics = tree.epics.filter((epic) => epic.taskId === story.taskId);
  const knownSize = size === NONE || (STORY_SIZES as readonly string[]).includes(size);

  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedTitle = title.trim();
        if (!trimmedTitle) return;
        onSave({
          title: trimmedTitle,
          description: description.trim() || null,
          acceptanceCriteria: acceptance.trim() || null,
          size: size || null,
          status,
          epicId: epicId || null,
        });
      }}
    >
      <Field label="Title">
        <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea value={description} maxLength={10000} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label="Acceptance criteria">
        <Textarea value={acceptance} maxLength={10000} onChange={(event) => setAcceptance(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Size">
          <select className={selectClass} value={size} onChange={(event) => setSize(event.target.value)}>
            <option value={NONE}>Not sized</option>
            {!knownSize ? <option value={size}>{size}</option> : null}
            {STORY_SIZES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className={selectClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as StoryMapStoryStatus)}
          >
            {STORY_MAP_STORY_STATUSES.map((item) => (
              <option key={item} value={item}>
                {STORY_STATUS_LABELS[item]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {epics.length > 0 ? (
        <Field label="Epic">
          <select className={selectClass} value={epicId} onChange={(event) => setEpicId(event.target.value)}>
            <option value={NONE}>No epic</option>
            {epics.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Button type="submit">Save story</Button>
    </form>
  );
}

function EpicForm({
  tree,
  epicId,
  onSave,
}: {
  tree: StoryMapTree;
  epicId: string;
  onSave: (patch: EpicPatch) => void;
}) {
  const epic = tree.epics.find((item) => item.id === epicId);
  const [name, setName] = useState(epic?.name ?? "");
  const [description, setDescription] = useState(epic?.description ?? "");
  if (!epic) return <p className="p-4 text-sm text-muted-foreground">This epic no longer exists.</p>;

  const children = tree.stories
    .filter((story) => story.epicId === epic.id)
    .sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4 p-4">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          onSave({ name: trimmed, description: description.trim() || null });
        }}
      >
        <Field label="Epic name">
          <Input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea value={description} maxLength={10000} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Button type="submit">Save epic</Button>
      </form>

      <section aria-label="Child stories" className="space-y-2">
        <h3 className="text-sm font-medium">
          Child stories ({children.length})
        </h3>
        {children.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stories in this epic yet.</p>
        ) : (
          <ul className="space-y-1">
            {children.map((story) => (
              <li key={story.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{story.title}</span>
                <Badge variant="outline">
                  {tree.releases.find((release) => release.id === story.releaseId)?.name ?? "Unscheduled"}
                </Badge>
                <Badge variant="secondary">{STORY_STATUS_LABELS[story.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Side panel with the details of one story or epic. */
export function StoryDetailPanel({
  tree,
  target,
  onClose,
  onSaveStory,
  onSaveEpic,
}: {
  tree: StoryMapTree;
  target: DetailTarget | null;
  onClose: () => void;
  onSaveStory: (id: string, patch: StoryPatch) => void;
  onSaveEpic: (id: string, patch: EpicPatch) => void;
}) {
  const heading = target?.kind === "epic" ? "Epic details" : "Story details";
  return (
    <Sheet open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" aria-label={heading}>
        <SheetHeader>
          <SheetTitle>{heading}</SheetTitle>
          <SheetDescription>
            {target?.kind === "epic" ? "Describe the epic and see the stories inside it." : "Describe the story and how to accept it."}
          </SheetDescription>
        </SheetHeader>
        {target?.kind === "story" ? (
          <StoryForm key={target.id} tree={tree} storyId={target.id} onSave={(patch) => onSaveStory(target.id, patch)} />
        ) : null}
        {target?.kind === "epic" ? (
          <EpicForm key={target.id} tree={tree} epicId={target.id} onSave={(patch) => onSaveEpic(target.id, patch)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
