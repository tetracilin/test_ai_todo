import { describe, expect, it } from "vitest";
import { createWopiSessionStore, normalizeWopiToken, wopiEditorSessionPayload, wopiTokenMatches } from "./wopi.js";

const actor = { createdByUserId: "user-1", createdByAgentId: null };

describe("WOPI session store", () => {
  it("binds opaque short-lived tokens to artifact and rotates same editing scope", () => {
    let clock = 1_000;
    const store = createWopiSessionStore({ now: () => clock, ttlMs: 100 });
    const first = store.create({ companyId: "company-a", artifactId: "artifact-a", versionId: "version-a", versionName: "Editorial review", format: "docx", actor });
    expect(normalizeWopiToken(first.token)).toBe(first.token);
    expect(store.get(first.token, "artifact-a")).not.toBeNull();
    expect(store.get(first.token, "artifact-b")).toBeNull();
    const rotated = store.create({ companyId: "company-a", artifactId: "artifact-a", versionId: "version-a", versionName: "Editorial review", format: "docx", actor });
    expect(store.get(first.token, "artifact-a")).toBeNull();
    expect(store.get(rotated.token, "artifact-a")).not.toBeNull();
    clock += 101;
    expect(store.get(rotated.token, "artifact-a")).toBeNull();
  });

  it("implements WOPI lock lifecycle and rejects stale/conflicting locks", () => {
    const store = createWopiSessionStore();
    const session = store.create({ companyId: "company-a", artifactId: "artifact-a", versionId: "version-a", versionName: "Finance review", format: "xlsx", actor });
    expect(store.lock(session, "lock-a", 60)).toEqual({ ok: true });
    expect(store.getLock(session)).toBe("lock-a");
    expect(store.lock(session, "lock-b", 60)).toEqual({ ok: false, current: "lock-a" });
    expect(store.relock(session, "wrong", "lock-b", 60)).toEqual({ ok: false, current: "lock-a" });
    expect(store.relock(session, "lock-a", "lock-b", 60)).toEqual({ ok: true });
    expect(store.unlock(session, "lock-a")).toEqual({ ok: false, current: "lock-b" });
    expect(store.unlock(session, "lock-b")).toEqual({ ok: true });
    expect(store.getLock(session)).toBeNull();
  });

  it("compares tokens in constant-time-compatible form and rejects malformed values", () => {
    const token = "a".repeat(43);
    expect(wopiTokenMatches(token, token)).toBe(true);
    expect(wopiTokenMatches(token, "b".repeat(43))).toBe(false);
    expect(normalizeWopiToken("bad")).toBeNull();
  });

  it("returns session metadata and action URL from the configured editor origin", () => {
    const editorOrigin = "https://office.isolated.example.test:8446";
    const callbackUrl = "https://app.isolated.example.test:8445/api/wopi/files/artifact-a";

    expect(wopiEditorSessionPayload({
      format: "docx",
      callbackUrl,
      token: "opaque-token",
      expiresAt: 123,
    }, editorOrigin)).toEqual({
      actionUrl: `${editorOrigin}/browser/dist/cool.html?WOPISrc=${encodeURIComponent(callbackUrl)}&action=edit`,
      formParameters: { access_token: "opaque-token", access_token_ttl: "123" },
      editorOrigin,
    });
  });
});
