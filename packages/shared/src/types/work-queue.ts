import type { WorkQueueItemStatus } from "../constants.js";

export interface WorkQueue {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  description: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkQueueItem {
  id: string;
  companyId: string;
  queueId: string;
  title: string;
  body: string | null;
  sourceLabel: string | null;
  status: WorkQueueItemStatus;
  promotedIssueId: string | null;
  promotedAt: Date | null;
  promotedByAgentId: string | null;
  promotedByUserId: string | null;
  dismissedAt: Date | null;
  dismissedByAgentId: string | null;
  dismissedByUserId: string | null;
  dismissReason: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
