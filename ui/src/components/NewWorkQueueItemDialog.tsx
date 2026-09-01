import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WORK_QUEUE_ITEM_STATUSES } from "@paperclipai/shared";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useOptionalToastActions } from "../context/ToastContext";
import { workQueuesApi } from "../api/workQueues";
import { queryKeys } from "../lib/queryKeys";
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

export function NewWorkQueueItemDialog() {
  const { newWorkQueueItemOpen, newWorkQueueItemDefaults, closeNewWorkQueueItem } = useDialog();
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  // Optional: this dialog is mounted unconditionally in Layout, which also
  // renders in harnesses without a ToastProvider.
  const pushToast = useOptionalToastActions()?.pushToast ?? null;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");

  const queueId = newWorkQueueItemDefaults.queueId;

  function reset() {
    setTitle("");
    setBody("");
    setSourceLabel("");
  }

  const addItem = useMutation({
    mutationFn: () =>
      workQueuesApi.addItem(selectedCompanyId!, queueId!, {
        title: title.trim(),
        body: body.trim() || undefined,
        sourceLabel: sourceLabel.trim() || undefined,
      }),
    onSuccess: () => {
      // See PromoteWorkQueueItemDialog.tsx: the fetched items query key always
      // carries a concrete status, so invalidation must target each status
      // explicitly rather than the status-less "__all" placeholder key.
      for (const status of WORK_QUEUE_ITEM_STATUSES) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workQueues.items(selectedCompanyId!, queueId!, status) });
      }
      reset();
      closeNewWorkQueueItem();
    },
    onError: (error) => {
      pushToast?.({
        title: "Failed to add item",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  function handleSubmit() {
    if (!selectedCompanyId || !queueId || !title.trim()) return;
    addItem.mutate();
  }

  return (
    <Dialog
      open={newWorkQueueItemOpen}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          closeNewWorkQueueItem();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New item</DialogTitle>
          <DialogDescription>
            Drop in a freeform intake item. You can promote it to a task or dismiss it later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="work-queue-item-title">Title</Label>
            <Input
              id="work-queue-item-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Customer asked about refund policy"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="work-queue-item-body">Details</Label>
            <Textarea
              id="work-queue-item-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Paste the raw content..."
              className="min-h-(--sz-120px)"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="work-queue-item-source">Source</Label>
            <Input
              id="work-queue-item-source"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g. email, slack, form"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); closeNewWorkQueueItem(); }}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || addItem.isPending} onClick={handleSubmit}>
            {addItem.isPending ? "Adding…" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
