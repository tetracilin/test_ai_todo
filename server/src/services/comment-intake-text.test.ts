import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  COMMENT_INTAKE_DEFAULT_SUBJECT,
  commentIntakeDedupeKey,
  parseCommentIntakeText,
} from "./comment-intake-text.js";

describe("comment intake text", () => {
  it("recognizes visible @dev directives and removes their separator from subject", () => {
    expect(parseCommentIntakeText("@DEV suggestion: Add CSV export"))
      .toMatchObject({ kind: "suggestion", subject: "Add CSV export" });
    expect(parseCommentIntakeText("@dev bug - Export fails"))
      .toMatchObject({ kind: "complaint", subject: "Export fails" });
  });

  it("ignores tags in inline and fenced code and rejects lookalikes", () => {
    expect(parseCommentIntakeText("`@dev bug`\n```\n@dev suggestion\n```"))
      .toBeNull();
    expect(parseCommentIntakeText("user@dev.example @developer @dev-team"))
      .toBeNull();
  });

  it("keeps eligible tags without directives as triage feedback", () => {
    expect(parseCommentIntakeText("@dev\n"))
      .toMatchObject({ kind: "needs_triage", subject: COMMENT_INTAKE_DEFAULT_SUBJECT });
  });

  it("retains tag-only content for malformed-record handling by the worker", () => {
    expect(parseCommentIntakeText("@dev")).toMatchObject({
      requestBody: "@dev",
      subject: COMMENT_INTAKE_DEFAULT_SUBJECT,
    });
  });

  it("uses the specified SHA-256 source identity key", () => {
    const input = {
      companyId: "company",
      providerKey: "paperclip",
      objectType: "issue_comment",
      sourceScopeId: "company",
      sourceCommentId: "comment",
    };
    expect(commentIntakeDedupeKey(input)).toBe(
      createHash("sha256").update("company\u0000paperclip\u0000issue_comment\u0000company\u0000comment", "utf8").digest("hex"),
    );
  });
});