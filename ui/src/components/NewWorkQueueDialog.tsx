import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

export function NewWorkQueueDialog() {
  const { newWorkQueueOpen, closeNewWorkQueue } = useDialog();
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  // Optional: this dialog is mounted unconditionally in Layout, which also
  // renders in harnesses without a ToastProvider.
  const pushToast = useOptionalToastActions()?.pushToast ?? null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function reset() {
    setName("");
    setDescription("");
  }

  const createQueue = useMutation({
    mutationFn: () =>
      workQueuesApi.create(selectedCompanyId!, {
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workQueues.list(selectedCompanyId!) });
      reset();
      closeNewWorkQueue();
    },
    onError: (error) => {
      pushToast?.({
        title: "Failed to create queue",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  function handleSubmit() {
    if (!selectedCompanyId || !name.trim()) return;
    createQueue.mutate();
  }

  return (
    <Dialog
      open={newWorkQueueOpen}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          closeNewWorkQueue();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New work queue</DialogTitle>
          <DialogDescription>
            Create a named holding area for freeform intake items you can later promote to tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="work-queue-name">Name</Label>
            <Input
              id="work-queue-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Support inbox"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="work-queue-description">Description</Label>
            <Textarea
              id="work-queue-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What lands in this queue?"
              className="min-h-(--sz-80px)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); closeNewWorkQueue(); }}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || createQueue.isPending} onClick={handleSubmit}>
            {createQueue.isPending ? "Creating…" : "Create queue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
