import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertEngineerCardDoneGate,
  countIssueEvidenceFromRows,
} from "../services/issues.ts";
import * as activityLogModule from "../services/activity-log.ts";
import { issueAttachments, issueComments } from "@paperclipai/db";

const fakeLogCalls: Array<{ action: string; entityId: string; details: unknown }> = [];

beforeEach(() => {
  fakeLogCalls.length = 0;
  vi.spyOn(activityLogModule, "logActivity").mockImplementation(async (db: unknown, input: any) => {
    fakeLogCalls.push({
      action: input.action,
      entityId: input.entityId,
      details: input.details,
    });
    return { id: "activity-1" } as never;
  });
});

describe("countIssueEvidenceFromRows", () => {
  it("counts zero when there is no attachment and the dossier has no evidence link", () => {
    const comments = [
      {
        id: "c1",
        body: "## Job order\nInstall the guard.\n\n## Evidence\n(no files yet)\n\n## Scope changes\n\n## Related Teable rows\n",
      },
    ];
    expect(countIssueEvidenceFromRows(comments, [])).toBe(0);
  });

  it("counts each attachment as one evidence item", () => {
    const comments = [{ id: "c1", body: "## Evidence\n" }];
    const attachments = [{ id: "a1" }, { id: "a2" }];
    expect(countIssueEvidenceFromRows(comments, attachments)).toBe(2);
  });

  it("counts evidence: links recorded under the dossier's ## Evidence heading", () => {
    const comments = [
      {
        id: "c1",
        body: `## Job order
Install the guard.

## Evidence
- 2026-08-31T04:20:00Z — guard-fit.jpg — evidence: t3-evidence/<card-id>/20260831-guard-fit.jpg
- 2026-08-31T04:35:00Z — meter-reading.jpg — evidence: t3-evidence/<card-id>/20260831-meter-reading.jpg

## Scope changes

## Related Teable rows
`,
      },
    ];
    expect(countIssueEvidenceFromRows(comments, [])).toBe(2);
  });

  it("does not count PENDING STORAGE placeholders as evidence", () => {
    const comments = [
      {
        id: "c1",
        body: `## Evidence
- 2026-08-31T04:20:00Z — guard-fit.jpg — PENDING STORAGE: guard-fit.jpg (evidence backend unavailable)
`,
      },
    ];
    expect(countIssueEvidenceFromRows(comments, [])).toBe(0);
  });

  it("ignores evidence: links outside the Evidence heading", () => {
    const comments = [
      {
        id: "c1",
        body: `## Job order
Install the guard. See evidence: https://example.com/spec.pdf

## Evidence

## Scope changes
`,
      },
    ];
    expect(countIssueEvidenceFromRows(comments, [])).toBe(0);
  });

  it("does not count evidence from a dossier posted after other comments (contract §1.4: dossier.md must be the first comment)", () => {
    const comments = [
      { id: "c1", body: "just a note, not a dossier" },
      {
        id: "c2",
        body: "## dossier.md\n\n## Job order\n\n## Evidence\n- 2026-08-31T04:20:00Z — x.jpg — evidence: t3-evidence/c/20260831-x.jpg\n",
      },
    ];
    expect(countIssueEvidenceFromRows(comments, [])).toBe(0);
  });
});

describe("assertEngineerCardDoneGate", () => {
  function fakeDb(comments: Array<{ id: string; body: string }>, attachments: Array<{ id: string }>) {
    const dbOrTx = {
      select: (selector: unknown) => {
        void selector;
        let table: unknown = null;
        const handler: any = {
          from: (fromTable: unknown) => {
            table = fromTable;
            return handler;
          },
          where: () => handler,
          orderBy: () => handler,
          limit: () => handler,
          then: (resolve: (rows: unknown) => unknown) => {
            const rows = table === issueAttachments ? attachments : comments;
            return Promise.resolve(resolve(rows));
          },
        };
        return handler;
      },
    };
    // The gate needs a db-shaped log target; the real logActivity is mocked
    // module-wide, so this only has to look like a database handle.
    const logTarget = { __fakeDb: true };
    return { dbOrTx, logTarget };
  }

  const gateInput = (overrides: Record<string, unknown> = {}) => ({
    companyId: "company-1",
    issueId: "11111111-1111-4111-8111-111111111111",
    identifier: "T-1",
    labelNames: ["tier:open", "owner:hai"],
    currentStatus: "in_progress",
    requestedStatus: "done",
    actorUserId: "pm-user",
    ...overrides,
  });

  it("refuses done on an engineer card with zero evidence and logs the denial", async () => {
    const { dbOrTx, logTarget } = fakeDb(
      [{ id: "c1", body: "## Evidence\n(no files yet)\n" }],
      [],
    );

    await expect(
      assertEngineerCardDoneGate(dbOrTx, logTarget, gateInput()),
    ).rejects.toMatchObject({ status: 422, details: { code: "issue_done_requires_evidence" } });

    expect(fakeLogCalls).toHaveLength(1);
    expect(fakeLogCalls[0].action).toBe("issue.evidence_gate_denied");
    expect(fakeLogCalls[0].entityId).toBe(gateInput().issueId);
    const details = fakeLogCalls[0].details as Record<string, unknown>;
    expect(details.evidenceCount).toBe(0);
    expect(details.source).toBe("engineer_card_done_gate");
  });

  it("allows done with evidence", async () => {
    const { dbOrTx, logTarget } = fakeDb(
      [{ id: "c1", body: "## Evidence\n- x.jpg — evidence: t3-evidence/c/x.jpg\n" }],
      [],
    );

    const result = await assertEngineerCardDoneGate(dbOrTx, logTarget, gateInput());

    expect(result).toBeUndefined();
    expect(fakeLogCalls).toHaveLength(0);
  });

  it("does not gate cards without a tier label", async () => {
    const { dbOrTx, logTarget } = fakeDb([{ id: "c1", body: "## Evidence\n" }], []);

    await assertEngineerCardDoneGate(dbOrTx, logTarget, gateInput({ labelNames: [] }));

    expect(fakeLogCalls).toHaveLength(0);
  });

  it("does nothing when the card is already done or the update is not to done", async () => {
    const { dbOrTx, logTarget } = fakeDb([], []);

    await assertEngineerCardDoneGate(dbOrTx, logTarget, gateInput({ currentStatus: "done" }));
    await assertEngineerCardDoneGate(dbOrTx, logTarget, gateInput({ requestedStatus: "cancelled" }));

    expect(fakeLogCalls).toHaveLength(0);
  });
});