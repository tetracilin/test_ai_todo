/**
 * Thin wrapper over Paperclip's public HTTP API. The bridge never touches
 * Paperclip's database or internal build — every operation here is a plain
 * authenticated fetch against documented endpoints, using this bridge's own
 * long-lived agent API key.
 */

export interface PaperclipIssueSummary {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
}

export interface PaperclipComment {
  id: string;
  issueId: string;
  body: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  onBehalfOfUserId: string | null;
  createdAt: string;
}

export interface PaperclipInteraction {
  id: string;
  issueId: string;
  kind: string;
  status: string;
  title: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class PaperclipApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: unknown,
  ) {
    super(`Paperclip API ${status} on ${path}: ${JSON.stringify(body)}`);
    this.name = "PaperclipApiError";
  }
}

export interface PaperclipClientOptions {
  apiUrl: string;
  apiKey: string;
  companyId: string;
}

export class PaperclipClient {
  constructor(private opts: PaperclipClientOptions) {}

  private async request<T>(
    path: string,
    init: RequestInit & { runId?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    const res = await fetch(`${this.opts.apiUrl}${path}`, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new PaperclipApiError(res.status, path, body);
    }
    return body as T;
  }

  /** "What's on my plate" — the same Mine-tab issue set the dashboard shows for this user. */
  async getMineInbox(paperclipUserId: string): Promise<PaperclipIssueSummary[]> {
    return this.request<PaperclipIssueSummary[]>(
      `/api/agents/me/inbox/mine?userId=${encodeURIComponent(paperclipUserId)}`,
    );
  }

  /** Resolve "T-10"-style identifiers via full-text search, then exact-match the identifier. */
  async findIssueByIdentifier(identifier: string): Promise<PaperclipIssueSummary | null> {
    const results = await this.request<PaperclipIssueSummary[]>(
      `/api/companies/${this.opts.companyId}/issues?q=${encodeURIComponent(identifier)}`,
    );
    const norm = identifier.trim().toLowerCase();
    return results.find((issue) => issue.identifier.toLowerCase() === norm) ?? null;
  }

  async getIssue(issueId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/issues/${issueId}`);
  }

  async getHeartbeatContext(issueId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/issues/${issueId}/heartbeat-context`);
  }

  async getComments(
    issueId: string,
    opts: { after?: string; order?: "asc" | "desc" } = {},
  ): Promise<PaperclipComment[]> {
    const params = new URLSearchParams();
    if (opts.after) params.set("after", opts.after);
    if (opts.order) params.set("order", opts.order);
    const qs = params.toString();
    return this.request<PaperclipComment[]>(`/api/issues/${issueId}/comments${qs ? `?${qs}` : ""}`);
  }

  /**
   * Post a reply as an issue comment.
   *
   * NOTE: `onBehalfOfUserId` is NOT settable by an agent-authenticated caller —
   * confirmed live against the real API, which rejects it with
   * `issue_write_attribution_spoof_rejected`: "onBehalfOfUserId is derived
   * from the authenticated actor, never from the request body — an agent
   * cannot pick the human whose authority it rides." Comments posted through
   * this bridge are therefore attributed to the bridge's own agent identity;
   * callers should fold the human's identity into the comment body (see
   * `handlers.ts#handleReply`) so provenance stays visible to readers even
   * though `authorAgentId` won't literally be the linked human.
   */
  async postComment(issueId: string, body: string): Promise<PaperclipComment> {
    return this.request<PaperclipComment>(`/api/issues/${issueId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async listInteractions(issueId: string): Promise<PaperclipInteraction[]> {
    return this.request<PaperclipInteraction[]>(`/api/issues/${issueId}/interactions`);
  }

  async acceptInteraction(
    issueId: string,
    interactionId: string,
    body: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.request(`/api/issues/${issueId}/interactions/${interactionId}/accept`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async rejectInteraction(
    issueId: string,
    interactionId: string,
    body: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.request(`/api/issues/${issueId}/interactions/${interactionId}/reject`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** Used for the worked end-to-end example: a human creates a ticket from Discord. */
  async createIssue(payload: {
    title: string;
    description?: string;
    assigneeUserId?: string;
    createdByUserId?: string;
    priority?: string;
    parentId?: string;
    goalId?: string;
  }): Promise<PaperclipIssueSummary> {
    return this.request<PaperclipIssueSummary>(`/api/companies/${this.opts.companyId}/issues`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}
