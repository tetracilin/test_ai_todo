import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import {
  decodeDevelopmentCommentIntakeCursor,
  developmentCommentIntakeFilterHash,
  encodeDevelopmentCommentIntakeCursor,
} from "../services/development-comment-intake-cursor.js";

const baseFilter = {
  kind: "complaint",
  status: ["new", "triaged"] as string[],
};

function expectBadRequest(fn: () => unknown, messageFragment: string) {
  try {
    fn();
    expect.unreachable("expected a 400 HttpError");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect(String((error as HttpError).message)).toContain(messageFragment);
  }
}

describe("development comment intake cursor", () => {
  it("round-trips through base64url preserving position and binding hash", () => {
    const encoded = encodeDevelopmentCommentIntakeCursor({
      v: 1,
      f: developmentCommentIntakeFilterHash(baseFilter),
      t: "2026-08-30T10:00:00.000Z",
      i: "11111111-1111-4111-8111-111111111111",
    });

    const decoded = decodeDevelopmentCommentIntakeCursor(encoded, baseFilter);
    expect(decoded.t).toBe("2026-08-30T10:00:00.000Z");
    expect(decoded.i).toBe("11111111-1111-4111-8111-111111111111");
    expect(decoded.f).toBe(developmentCommentIntakeFilterHash(baseFilter));
  });

  it("produces the same binding hash regardless of filter ordering", () => {
    const hashA = developmentCommentIntakeFilterHash({
      status: ["triaged", "new"],
      kind: "complaint",
      createdAfter: "2026-01-01T00:00:00.000Z",
      createdBefore: "2026-02-01T00:00:00.000Z",
    });
    const hashB = developmentCommentIntakeFilterHash({
      createdBefore: "2026-02-01T00:00:00.000Z",
      kind: "complaint",
      status: ["new", "triaged"],
      createdAfter: "2026-01-01T00:00:00.000Z",
    });
    expect(hashA).toBe(hashB);
  });

  it("changes the binding hash when any filter value changes", () => {
    expect(developmentCommentIntakeFilterHash({ kind: "complaint" })).not.toBe(
      developmentCommentIntakeFilterHash({ kind: "suggestion" }),
    );
    expect(developmentCommentIntakeFilterHash({ status: ["new"] })).not.toBe(
      developmentCommentIntakeFilterHash({ status: ["triaged"] }),
    );
    expect(developmentCommentIntakeFilterHash({ createdAfter: "2026-01-01T00:00:00.000Z" })).not.toBe(
      developmentCommentIntakeFilterHash({ createdAfter: "2026-01-02T00:00:00.000Z" }),
    );
  });

  it("rejects a cursor minted under a different filter set", () => {
    const encoded = encodeDevelopmentCommentIntakeCursor({
      v: 1,
      f: developmentCommentIntakeFilterHash({ kind: "suggestion" }),
      t: "2026-08-30T10:00:00.000Z",
      i: "11111111-1111-4111-8111-111111111111",
    });
    expectBadRequest(
      () => decodeDevelopmentCommentIntakeCursor(encoded, { kind: "complaint" }),
      "does not match the requested filters",
    );
  });

  it("rejects malformed cursors", () => {
    expectBadRequest(() => decodeDevelopmentCommentIntakeCursor("not-base64-!!", baseFilter), "invalid");
    expectBadRequest(
      () => decodeDevelopmentCommentIntakeCursor(Buffer.from("not json").toString("base64url"), baseFilter),
      "invalid",
    );
  });

  it("rejects a structurally valid payload with an unsupported version or missing fields", () => {
    const wrongVersion = Buffer.from(
      JSON.stringify({ v: 2, f: "x", t: "2026-08-30T10:00:00.000Z", i: "11111111-1111-4111-8111-111111111111" }),
    ).toString("base64url");
    expectBadRequest(() => decodeDevelopmentCommentIntakeCursor(wrongVersion, baseFilter), "invalid");

    const missingFields = Buffer.from(JSON.stringify({ v: 1, f: "x" })).toString("base64url");
    expectBadRequest(() => decodeDevelopmentCommentIntakeCursor(missingFields, baseFilter), "invalid");
  });

  it("accepts a client-repositioned cursor as long as the filter binding still matches (position is not signed)", () => {
    const honest = encodeDevelopmentCommentIntakeCursor({
      v: 1,
      f: developmentCommentIntakeFilterHash(baseFilter),
      t: "2026-08-30T10:00:00.000Z",
      i: "11111111-1111-4111-8111-111111111111",
    });
    // Flip the position field inside the base64 payload while keeping the hash.
    const json = Buffer.from(honest, "base64url").toString("utf8");
    const tamperedJson = json.replace("11111111-1111-4111-8111-111111111111", "99999999-9999-4999-8999-999999999999");
    const tampered = Buffer.from(tamperedJson).toString("base64url");
    const decoded = decodeDevelopmentCommentIntakeCursor(tampered, baseFilter);
    expect(decoded.i).toBe("99999999-9999-4999-8999-999999999999");
  });
});