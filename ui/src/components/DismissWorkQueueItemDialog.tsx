import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WORK_QUEUE_ITEM_STATUSES, type WorkQueueItem } from "@paperclipai/shared";
import { workQueuesApi } from "../api/workQueues";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface DismissWorkQueueItemDialogProps {
  companyId: string;
  queueId: string;
  item: WorkQueueItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DismissWorkQueueItemDialog({
  companyId,
  queueId,
  item,
  open,
  onOpenChange,
}: DismissWorkQueueItemDialogProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [reason, setReason] = useState("");

  const dismissItem = useMutation({
    mutationFn: () => {
      if (!item) throw new Error("No item selected");
      return workQueuesApi.dismissItem(companyId, queueId, item.id, {
        reason: reason.trim() || undefined,
      });
    },
    onSuccess: () => {
      // See PromoteWorkQueueItemDialog.tsx: the fetched items query key always
      // carries a concrete status, so invalidation must target each status
      // explicitly rather than the status-less "__all" placeholder key.
      for (const status of WORK_QUEUE_ITEM_STATUSES) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workQueues.items(companyId, queueId, status) });
      }
      setReason("");
      onOpenChange(false);
    },
    onError: (error) => {
      pushToast({
        title: "Failed to dismiss item",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!dismissItem.isPending) { setReason(""); onOpenChange(next); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dismiss item</AlertDialogTitle>
          <AlertDialogDescription>
            {item ? `"${item.title}" will be marked dismissed and removed from the open queue.` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="dismiss-item-reason">Reason (optional)</Label>
          <Textarea
            id="dismiss-item-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being dismissed?"
            className="min-h-(--sz-80px)"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={dismissItem.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={dismissItem.isPending || !item}
            onClick={(event) => {
              event.preventDefault();
              dismissItem.mutate();
            }}
          >
            {dismissItem.isPending ? "Dismissing…" : "Dismiss"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
