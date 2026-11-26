import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListTree } from "lucide-react";
import type { StoryMapStory, StoryMapStoryStatus, StoryMapTree } from "@paperclipai/shared";
import { STORY_MAP_STORY_STATUSES } from "@paperclipai/shared";
import { storyMapApi } from "../api/storyMap";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import {
  FILTER_UNSCHEDULED,
  STORY_STATUS_LABELS,
  buildBacklogTree,
  type BacklogFilters,
} from "../lib/storyMapBacklog";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StoryMapTabs } from "../components/StoryMapTabs";
import { Badge } from "@/components/ui/badge";

const ALL = "all";
const selectClass = "h-9 border border-input bg-background px-2 text-sm";

function releaseName(tree: StoryMapTree, story: StoryMapStory) {
  return tree.releases.find((release) => release.id === story.releaseId)?.name ?? "Unscheduled";
}

function StoryRow({ story, tree }: { story: StoryMapStory; tree: StoryMapTree }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-0.5">
      <span>{story.title}</span>
      <Badge variant="outline">{releaseName(tree, story)}</Badge>
      <Badge variant="secondary">{STORY_STATUS_LABELS[story.status]}</Badge>
    </li>
  );
}

export function StoryMapBacklog() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [release, setRelease] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  useEffect(() => {
    setBreadcrumbs([{ label: "Story map", href: "/story-map" }, { label: "Product backlog" }]);
  }, [setBreadcrumbs]);

  const { data: tree, isLoading, error } = useQuery({
    queryKey: queryKeys.storyMap.tree(selectedCompanyId ?? ""),
    queryFn: () => storyMapApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={ListTree} message="Select a company to view its product backlog." />;
  }
  if (isLoading || !tree) {
    return error ? <p className="text-sm text-destructive">{error.message}</p> : <PageSkeleton variant="list" />;
  }

  const filters: BacklogFilters = {
    release: release === ALL ? null : release,
    status: status === ALL ? null : (status as StoryMapStoryStatus),
  };
  const backlog = buildBacklogTree(tree, filters);
  const filtering = filters.release !== null || filters.status !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Product backlog</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            Release
            <select
              aria-label="Filter by release"
              className={selectClass}
              value={release}
              onChange={(event) => setRelease(event.target.value)}
            >
              <option value={ALL}>All releases</option>
              {tree.releases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              <option value={FILTER_UNSCHEDULED}>Unscheduled</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-sm">
            Status
            <select
              aria-label="Filter by status"
              className={selectClass}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value={ALL}>All statuses</option>
              {STORY_MAP_STORY_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {STORY_STATUS_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <StoryMapTabs />

      {backlog.activities.length === 0 ? (
        <EmptyState
          icon={ListTree}
          message={filtering ? "No stories match these filters." : "The backlog is empty. Add activities in the story map."}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="backlog-count">
            {backlog.storyCount} {backlog.storyCount === 1 ? "story" : "stories"}
          </p>
          <ul className="space-y-3" aria-label="Product backlog">
            {backlog.activities.map((activityNode) => (
              <li key={activityNode.activity.id}>
                <div className="font-semibold">{activityNode.activity.name}</div>
                <ul className="ml-4 space-y-2 border-l border-border pl-3">
                  {activityNode.tasks.map((taskNode) => (
                    <li key={taskNode.task.id}>
                      <div className="font-medium">{taskNode.task.name}</div>
                      <ul className="ml-4 space-y-1 border-l border-border pl-3">
                        {taskNode.epics.map((epicNode) => (
                          <li key={epicNode.epic.id}>
                            <div className="text-muted-foreground">{epicNode.epic.name}</div>
                            <ul className="ml-4 border-l border-border pl-3">
                              {epicNode.stories.map((story) => (
                                <StoryRow key={story.id} story={story} tree={tree} />
                              ))}
                            </ul>
                          </li>
                        ))}
                        {taskNode.stories.map((story) => (
                          <StoryRow key={story.id} story={story} tree={tree} />
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
