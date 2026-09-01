import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { workQueuesApi } from "../api/workQueues";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { EntityRow } from "../components/EntityRow";
import { Button } from "@/components/ui/button";
import { Inbox, Plus } from "lucide-react";

export function WorkQueues() {
  const { selectedCompanyId } = useCompany();
  const { openNewWorkQueue } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Work Queues" }]);
  }, [setBreadcrumbs]);

  const { data: queues, isLoading, error } = useQuery({
    queryKey: queryKeys.workQueues.list(selectedCompanyId!),
    queryFn: () => workQueuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Inbox} message="Select a company to view work queues." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {queues && queues.length === 0 && (
        <EmptyState
          icon={Inbox}
          message="No work queues yet."
          description="Create a queue to hold freeform intake items you can later promote to tasks."
          action="New Queue"
          onAction={() => openNewWorkQueue()}
        />
      )}

      {queues && queues.length > 0 && (
        <>
          <div className="flex items-center justify-start">
            <Button size="sm" variant="outline" onClick={() => openNewWorkQueue()}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Queue
            </Button>
          </div>
          <div className="border border-border">
            {queues.map((queue) => (
              <EntityRow
                key={queue.id}
                title={queue.name}
                subtitle={queue.description ?? undefined}
                to={`/work-queues/${queue.id}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
