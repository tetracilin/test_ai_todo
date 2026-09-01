import type { Issue, WorkQueue, WorkQueueItem, WorkQueueItemStatus } from "@paperclipai/shared";
import { api } from "./client";

export const workQueuesApi = {
  list: (companyId: string) => api.get<WorkQueue[]>(`/companies/${companyId}/work-queues`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<WorkQueue>(`/companies/${companyId}/work-queues`, data),
  listItems: (companyId: string, queueId: string, status?: WorkQueueItemStatus) =>
    api.get<WorkQueueItem[]>(
      `/companies/${companyId}/work-queues/${queueId}/items${status ? `?status=${status}` : ""}`,
    ),
  addItem: (companyId: string, queueId: string, data: Record<string, unknown>) =>
    api.post<WorkQueueItem>(`/companies/${companyId}/work-queues/${queueId}/items`, data),
  promoteItem: (companyId: string, queueId: string, itemId: string, data: Record<string, unknown>) =>
    api.post<{ item: WorkQueueItem; issue: Issue }>(
      `/companies/${companyId}/work-queues/${queueId}/items/${itemId}/promote`,
      data,
    ),
  dismissItem: (companyId: string, queueId: string, itemId: string, data: Record<string, unknown>) =>
    api.post<WorkQueueItem>(`/companies/${companyId}/work-queues/${queueId}/items/${itemId}/dismiss`, data),
};
