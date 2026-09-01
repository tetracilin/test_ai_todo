import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WORK_QUEUE_ITEM_STATUSES, type WorkQueueItem } from "@paperclipai/shared";
import { workQueuesApi } from "../api/workQueues";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { issueUrl } from "../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface PromoteWorkQueueItemDialogProps {
  companyId: string;
  queueId: string;
  item: WorkQueueItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PromoteWorkQueueItemDialog({
  companyId,
  queueId,
  item,
  open,
  onOpenChange,
}: PromoteWorkQueueItemDialogProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setDescription(item.body ?? "");
    }
  }, [item]);

  const promoteItem = useMutation({
    mutationFn: () => {
      if (!item) throw new Error("No item selected");
      return workQueuesApi.promoteItem(companyId, queueId, item.id, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
      });
    },
    onSuccess: ({ issue }) => {
      // The items list is fetched per status tab, so its query key always
      // ends in a concrete status (see WorkQueueDetail.tsx) — react-query's
      // partial-match invalidation requires every key element up to the
      // filter's length to match, so a status-less call here (which resolves
      // to a literal "__all" placeholder token) would never match any of the
      // three real fetched keys. Invalidate each concrete status explicitly,
      // matching the queryKeys.decisions.list precedent in DecisionResolver.tsx.
      for (const status of WORK_QUEUE_ITEM_STATUSES) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workQueues.items(companyId, queueId, status) });
      }
      pushToast({
        title: "Promoted to task",
        body: issue.identifier ?? issue.title,
        tone: "success",
        action: { label: "View task", href: issueUrl(issue) },
      });
      onOpenChange(false);
    },
    onError: (error) => {
      pushToast({
        title: "Failed to promote item",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!promoteItem.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Promote to task</DialogTitle>
          <DialogDescription>
            Review the title and description before creating a task from this item.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="promote-item-title">Title</Label>
            <Input
              id="promote-item-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="promote-item-description">Description</Label>
            <Textarea
              id="promote-item-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-(--sz-120px)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={promoteItem.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || promoteItem.isPending}
            onClick={() => promoteItem.mutate()}
          >
            {promoteItem.isPending ? "Promoting…" : "Promote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
