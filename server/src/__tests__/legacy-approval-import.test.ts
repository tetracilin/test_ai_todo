import { describe, expect, it, vi } from "vitest";
import {
  legacyApprovalImporter,
  type LegacyApprovalImportCheckpoint,
  type LegacyApprovalImportCheckpointEntry,
  type LegacyApprovalImportStore,
} from "../services/legacy-approval-import.ts";

class MemoryCheckpoint implements LegacyApprovalImportCheckpoint {
  readonly entries = new Map<string, LegacyApprovalImportCheckpointEntry>();

  async get(companyId: string, sourceId: string) {
    return this.entries.get(`${companyId}:${sourceId}`) ?? null;
  }

  async put(companyId: string, sourceId: string, entry: LegacyApprovalImportCheckpointEntry) {
    this.entries.set(`${companyId}:${sourceId}`, entry);
  }
}

function createStore(): LegacyApprovalImportStore & {
  withCompanyLock: ReturnType<typeof vi.fn>;
  findIssue: ReturnType<typeof vi.fn>;
  resolveActiveUserMembership: ReturnType<typeof vi.fn>;
  isCheckpointEntryApplied: ReturnType<typeof vi.fn>;
  insertApproval: ReturnType<typeof vi.fn>;
  insertIssueComment: ReturnType<typeof vi.fn>;
} {
  const store: LegacyApprovalImportStore & {
    withCompanyLock: ReturnType<typeof vi.fn>;
    findIssue: ReturnType<typeof vi.fn>;
    resolveActiveUserMembership: ReturnType<typeof vi.fn>;
    isCheckpointEntryApplied: ReturnType<typeof vi.fn>;
    insertApproval: ReturnType<typeof vi.fn>;
    insertIssueComment: ReturnType<typeof vi.fn>;
  } = {
    withCompanyLock: vi.fn(async (_companyId, operation) => operation(store)),
    findIssue: vi.fn(async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId: "11111111-1111-4111-8111-111111111111", title: "Ship safer approvals" })),
    resolveActiveUserMembership: vi.fn(async () => null),
    isCheckpointEntryApplied: vi.fn(async () => true),
    insertApproval: vi.fn(async (approval) => approval),
    insertIssueComment: vi.fn(async (comment) => comment),
  };
  return store;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    companyId: "11111111-1111-4111-8111-111111111111",
    sourceId: "legacy-1",
    issueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "Pending" as const,
    reason: null,
    requesterUserId: null,
    approverUserId: null,
    response: null,
    resolvedAt: null,
    updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  };
}

describe("legacyApprovalImporter", () => {
  it("maps Pending to canonical type, status, and deterministic payload", async () => {
    const store = createStore();
    const result = await legacyApprovalImporter(store, new MemoryCheckpoint()).importRow(row());

    expect(result).toMatchObject({ outcome: "imported_approval", idempotent: false });
    expect(store.insertApproval).toHaveBeenCalledWith({
      id: expect.any(String),
      companyId: "11111111-1111-4111-8111-111111111111",
      issueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "request_board_approval",
      status: "pending",
      requestedByUserId: null,
      decidedByUserId: null,
      decisionNote: null,
      decidedAt: null,
      updatedAt: new Date("2026-08-01T12:00:00.000Z"),
      payload: {
        title: "Legacy approval for: Ship safer approvals",
        summary: "No reason supplied",
        recommendedAction: "Approve or reject the linked legacy request after reviewing imported context.",
        risks: ["Imported historical request; no legacy approver authority was transferred."],
      },
    });
    expect(store.insertIssueComment).not.toHaveBeenCalled();
  });

  it("preserves an active same-company requester and reports an unresolved requester", async () => {
    const resolvedStore = createStore();
    resolvedStore.resolveActiveUserMembership.mockResolvedValueOnce("requester-1");
    const resolved = await legacyApprovalImporter(resolvedStore, new MemoryCheckpoint()).importRow(
      row({ sourceId: "resolved", requesterUserId: "requester-1" }),
    );

    expect(resolved.exceptions).toEqual([]);
    expect(resolvedStore.resolveActiveUserMembership).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "requester-1",
    );
    expect(resolvedStore.insertApproval).toHaveBeenCalledWith(
      expect.objectContaining({ requestedByUserId: "requester-1" }),
    );

    const unresolvedStore = createStore();
    const unresolved = await legacyApprovalImporter(unresolvedStore, new MemoryCheckpoint()).importRow(
      row({ sourceId: "unresolved", requesterUserId: "missing-user" }),
    );
    expect(unresolved.exceptions).toEqual([
      { code: "approval_requester_unresolved", sourceId: "unresolved" },
    ]);
    expect(unresolvedStore.insertApproval).toHaveBeenCalledWith(
      expect.objectContaining({ requestedByUserId: null }),
    );
  });

  it.each([
    ["Approved", "approved"],
    ["Rejected", "rejected"],
  ] as const)("imports authorized %s terminal history without resolution side effects", async (legacyStatus, canonicalStatus) => {
    const store = createStore();
    store.resolveActiveUserMembership.mockResolvedValueOnce("requester-1").mockResolvedValueOnce("decider-1");

    await legacyApprovalImporter(store, new MemoryCheckpoint()).importRow(
      row({
        status: legacyStatus,
        requesterUserId: "requester-1",
        approverUserId: "decider-1",
        response: "Historical decision",
        resolvedAt: new Date("2026-07-31T10:00:00.000Z"),
      }),
    );

    expect(store.resolveActiveUserMembership).toHaveBeenNthCalledWith(
      2,
      "11111111-1111-4111-8111-111111111111",
      "decider-1",
      ["owner", "admin", "operator"],
    );
    expect(store.insertApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "request_board_approval",
        status: canonicalStatus,
        decidedByUserId: "decider-1",
        decisionNote: "Historical decision",
        decidedAt: new Date("2026-07-31T10:00:00.000Z"),
      }),
    );
    expect(store.insertIssueComment).not.toHaveBeenCalled();
  });

  it("downgrades an unresolved or viewer terminal decider to a system issue comment", async () => {
    const store = createStore();
    store.resolveActiveUserMembership.mockResolvedValueOnce("requester-1").mockResolvedValueOnce(null);

    const result = await legacyApprovalImporter(store, new MemoryCheckpoint()).importRow(
      row({
        status: "Rejected",
        requesterUserId: "requester-1",
        approverUserId: "viewer-1",
        reason: "Unsafe",
        response: "Rejected historically",
        resolvedAt: new Date("2026-07-31T10:00:00.000Z"),
      }),
    );

    expect(result).toMatchObject({ outcome: "imported_comment" });
    expect(result.exceptions).toEqual([
      { code: "approval_terminal_decider_unresolved", sourceId: "legacy-1" },
    ]);
    expect(store.insertApproval).not.toHaveBeenCalled();
    expect(store.insertIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "11111111-1111-4111-8111-111111111111",
        issueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        body: expect.stringContaining("Source status: Rejected"),
      }),
    );
  });

  it.each([
    [null, "missing"],
    [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId: "22222222-2222-4222-8222-222222222222", title: "Foreign" }, "cross-company"],
  ])("skips missing and cross-company issue targets", async (issue, sourceId) => {
    const store = createStore();
    store.findIssue.mockResolvedValueOnce(issue);

    const result = await legacyApprovalImporter(store, new MemoryCheckpoint()).importRow(row({ sourceId }));

    expect(result).toEqual({
      outcome: "skipped",
      canonicalId: null,
      exceptions: [{ code: "approval_orphan_issue", sourceId }],
      idempotent: false,
    });
    expect(store.insertApproval).not.toHaveBeenCalled();
    expect(store.insertIssueComment).not.toHaveBeenCalled();
  });

  it("uses company-scoped locking and checkpointing to make reruns idempotent", async () => {
    const store = createStore();
    const checkpoint = new MemoryCheckpoint();
    const importer = legacyApprovalImporter(store, checkpoint);

    const first = await importer.importRow(row());
    const second = await importer.importRow(row());

    expect(first.idempotent).toBe(false);
    expect(second).toMatchObject({
      outcome: "imported_approval",
      canonicalId: first.canonicalId,
      idempotent: true,
    });
    expect(store.withCompanyLock).toHaveBeenCalledTimes(2);
    expect(store.withCompanyLock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", expect.any(Function));
    expect(store.insertApproval).toHaveBeenCalledTimes(1);
    expect(store.insertIssueComment).not.toHaveBeenCalled();
  });

  it("repairs a checkpoint whose canonical approval was not committed", async () => {
    const store = createStore();
    store.isCheckpointEntryApplied.mockResolvedValueOnce(false);
    const checkpoint = new MemoryCheckpoint();
    const canonicalId = "2fdd39f8-eac6-4876-8f92-c5cc87162d55";
    await checkpoint.put("11111111-1111-4111-8111-111111111111", "legacy-1", {
      outcome: "imported_approval",
      canonicalId,
    });

    const result = await legacyApprovalImporter(store, checkpoint).importRow(row());

    expect(store.isCheckpointEntryApplied).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { outcome: "imported_approval", canonicalId },
    );
    expect(result).toMatchObject({ outcome: "imported_approval", canonicalId, idempotent: false });
    expect(store.insertApproval).toHaveBeenCalledWith(expect.objectContaining({ id: canonicalId }));
  });

  it("rejects an unsupported runtime status before writing", async () => {
    const store = createStore();

    await expect(
      legacyApprovalImporter(store, new MemoryCheckpoint()).importRow(
        row({ status: "Escalated" }) as never,
      ),
    ).rejects.toThrow("Unsupported legacy approval status: Escalated");
    expect(store.insertApproval).not.toHaveBeenCalled();
    expect(store.insertIssueComment).not.toHaveBeenCalled();
  });

  it.each([
    [row({ companyId: "not-a-company-id" }), "companyId must be a UUID"],
    [row({ sourceId: "   " }), "sourceId must be non-empty"],
    [row({ updatedAt: new Date("invalid") }), "updatedAt must be a valid date"],
  ])("rejects malformed import input before locking or writing", async (input, message) => {
    const store = createStore();

    await expect(
      legacyApprovalImporter(store, new MemoryCheckpoint()).importRow(input as never),
    ).rejects.toThrow(message);
    expect(store.withCompanyLock).not.toHaveBeenCalled();
    expect(store.insertApproval).not.toHaveBeenCalled();
    expect(store.insertIssueComment).not.toHaveBeenCalled();
  });

  it("scopes identical source ids independently by company", async () => {
    const store = createStore();
    store.findIssue
      .mockResolvedValueOnce({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId: "11111111-1111-4111-8111-111111111111", title: "Company one" })
      .mockResolvedValueOnce({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", companyId: "22222222-2222-4222-8222-222222222222", title: "Company two" });
    const checkpoint = new MemoryCheckpoint();
    const importer = legacyApprovalImporter(store, checkpoint);

    const first = await importer.importRow(row());
    const second = await importer.importRow(
      row({ companyId: "22222222-2222-4222-8222-222222222222", issueId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    );

    expect(first.canonicalId).not.toBe(second.canonicalId);
    expect(store.withCompanyLock).toHaveBeenNthCalledWith(1, "11111111-1111-4111-8111-111111111111", expect.any(Function));
    expect(store.withCompanyLock).toHaveBeenNthCalledWith(2, "22222222-2222-4222-8222-222222222222", expect.any(Function));
    expect(store.insertApproval).toHaveBeenCalledTimes(2);
  });
});
