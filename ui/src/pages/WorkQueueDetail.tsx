import { useEffect, useState } from "react";
import { Link, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import type { WorkQueueItem, WorkQueueItemStatus } from "@paperclipai/shared";
import { workQueuesApi } from "../api/workQueues";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { formatDateTime } from "../lib/utils";
import { EntityRow } from "../components/EntityRow";
import { PageSkeleton } from "../components/PageSkeleton";
import { PromoteWorkQueueItemDialog } from "../components/PromoteWorkQueueItemDialog";
import { DismissWorkQueueItemDialog } from "../components/DismissWorkQueueItemDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";

const TABS: { value: WorkQueueItemStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "promoted", label: "Promoted" },
  { value: "dismissed", label: "Dismissed" },
];

export function WorkQueueDetail() {
  const { queueId } = useParams<{ queueId: string }>();
  const { selectedCompanyId } = useCompany();
  const { openNewWorkQueueItem } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [activeTab, setActiveTab] = useState<WorkQueueItemStatus>("open");
  const [promoteItem, setPromoteItem] = useState<WorkQueueItem | null>(null);
  const [dismissItem, setDismissItem] = useState<WorkQueueItem | null>(null);

  const { data: queues } = useQuery({
    queryKey: queryKeys.workQueues.list(selectedCompanyId!),
    queryFn: () => workQueuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const queue = (queues ?? []).find((q) => q.id === queueId);

  const {
    data: items,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.workQueues.items(selectedCompanyId!, queueId!, activeTab),
    queryFn: () => workQueuesApi.listItems(selectedCompanyId!, queueId!, activeTab),
    enabled: !!selectedCompanyId && !!queueId,
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Work Queues", href: "/work-queues" },
      { label: queue?.name ?? queueId ?? "Queue" },
    ]);
  }, [setBreadcrumbs, queue, queueId]);

  if (!selectedCompanyId || !queueId) return null;
  if (isLoading && !items) return <PageSkeleton variant="detail" />;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">{queue?.name ?? "Queue"}</h2>
        {queue?.description && (
          <p className="text-sm text-muted-foreground">{queue.description}</p>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as WorkQueueItemStatus)}>
        <div className="flex items-center justify-between">
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button size="sm" variant="outline" onClick={() => openNewWorkQueueItem({ queueId })}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Item
          </Button>
        </div>

        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-4">
            {error && <p className="text-sm text-destructive">{error.message}</p>}
            {items && items.length === 0 && (
              <p className="text-sm text-muted-foreground">No {tab.label.toLowerCase()} items.</p>
            )}
            {items && items.length > 0 && (
              <div className="border border-border">
                {items.map((item) => (
                  <EntityRow
                    key={item.id}
                    leading={
                      item.sourceLabel ? (
                        <Badge variant="outline">{item.sourceLabel}</Badge>
                      ) : undefined
                    }
                    title={item.title}
                    subtitle={item.body ?? undefined}
                    meta={
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(item.createdAt)}
                      </span>
                    }
                    trailing={
                      item.status === "open" ? (
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setPromoteItem(item)}>
                            Promote
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDismissItem(item)}>
                            Dismiss
                          </Button>
                        </div>
                      ) : item.status === "promoted" && item.promotedIssueId ? (
                        <Link
                          to={`/issues/${item.promotedIssueId}`}
                          className="text-xs font-medium underline underline-offset-4"
                        >
                          View task
                        </Link>
                      ) : item.status === "dismissed" && item.dismissReason ? (
                        <span className="text-xs text-muted-foreground max-w-(--sz-240px) truncate" title={item.dismissReason}>
                          {item.dismissReason}
                        </span>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <PromoteWorkQueueItemDialog
        companyId={selectedCompanyId}
        queueId={queueId}
        item={promoteItem}
        open={!!promoteItem}
        onOpenChange={(open) => { if (!open) setPromoteItem(null); }}
      />
      <DismissWorkQueueItemDialog
        companyId={selectedCompanyId}
        queueId={queueId}
        item={dismissItem}
        open={!!dismissItem}
        onOpenChange={(open) => { if (!open) setDismissItem(null); }}
      />
    </div>
  );
}
