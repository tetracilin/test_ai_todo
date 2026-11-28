import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { TaskChatThread } from "./TaskChatThread";

export interface DocumentPanelChatProps {
  issueId?: string | null;
  companyId?: string | null;
  projectId?: string | null;
}

/** Draft key of the panel chat only (the composer adds the work mode); a half-typed message survives closing the panel. */
export function taskChatDraftKey(issueId: string) {
  return `paperclip:document-panel-chat-draft:${issueId}`;
}

/** Own cache entry: the task page stores an infinite query under queryKeys.issues.comments(issueId). */
export function documentPanelCommentsKey(issueId: string) {
  return [...queryKeys.issues.comments(issueId), "document-panel"] as const;
}

/**
 * The chat of the task a document belongs to, shown in the document panel.
 * Reuses the task chat thread of the task page; it only supplies the comments and the send action.
 */
export function DocumentPanelChat({ issueId, companyId, projectId }: DocumentPanelChatProps) {
  const queryClient = useQueryClient();
  const { data: comments = [], isError } = useQuery({
    queryKey: documentPanelCommentsKey(issueId ?? ""),
    queryFn: () => issuesApi.listComments(issueId as string, { order: "asc" }),
    enabled: !!issueId,
    refetchInterval: 3000,
  });
  const { data: issue } = useQuery({
    queryKey: queryKeys.issues.detail(issueId ?? ""),
    queryFn: () => issuesApi.get(issueId as string),
    enabled: !!issueId,
  });
  const updateWorkMode = useMutation({
    mutationFn: (workMode: string) => issuesApi.update(issueId as string, { workMode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId as string) }),
  });
  if (!issueId) return <div className="text-muted-foreground">Task chat</div>;
  if (isError) return <div role="alert" className="text-destructive">The task chat could not be loaded.</div>;
  const currentMode = issue?.workMode ?? "standard";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TaskChatThread
        comments={comments}
        issueId={issueId}
        companyId={companyId}
        projectId={projectId}
        draftKey={taskChatDraftKey(issueId)}
        issueWorkMode={currentMode}
        onWorkModeChange={async (nextMode) => {
          if (nextMode === currentMode) return;
          await updateWorkMode.mutateAsync(nextMode);
        }}
        onAdd={async (body, reopen) => {
          await issuesApi.addComment(issueId, body, reopen);
          await queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
        }}
      />
    </div>
  );
}
