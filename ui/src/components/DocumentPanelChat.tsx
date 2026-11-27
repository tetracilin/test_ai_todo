import { useQuery, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { TaskChatThread } from "./TaskChatThread";

export interface DocumentPanelChatProps {
  issueId?: string | null;
  companyId?: string | null;
  projectId?: string | null;
}

/** Same draft key as the task page, so a half-typed message survives closing the panel. */
export function taskChatDraftKey(issueId: string) {
  return `paperclip:issue-comment-draft:${issueId}`;
}

/**
 * The chat of the task a document belongs to, shown in the document panel.
 * Reuses the task chat thread of the task page; it only supplies the comments and the send action.
 */
export function DocumentPanelChat({ issueId, companyId, projectId }: DocumentPanelChatProps) {
  const queryClient = useQueryClient();
  const { data: comments = [], isError } = useQuery({
    queryKey: queryKeys.issues.comments(issueId ?? ""),
    queryFn: () => issuesApi.listComments(issueId as string, { order: "asc" }),
    enabled: !!issueId,
    refetchInterval: 3000,
  });
  if (!issueId) return <div className="text-muted-foreground">Task chat</div>;
  if (isError) return <div role="alert" className="text-destructive">The task chat could not be loaded.</div>;
  return (
    <TaskChatThread
      comments={comments}
      issueId={issueId}
      companyId={companyId}
      projectId={projectId}
      draftKey={taskChatDraftKey(issueId)}
      showJumpToLatest={false}
      onAdd={async (body, reopen) => {
        await issuesApi.addComment(issueId, body, reopen);
        await queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
      }}
    />
  );
}
