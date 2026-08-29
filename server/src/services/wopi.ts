import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ArtifactActor } from "./artifacts.js";

const DEFAULT_WOPI_EDITOR_ORIGIN = "https://hostinger-kvm8-host.tail9831b.ts.net:8444";
const DEFAULT_WOPI_STAGING_CALLBACK_ORIGIN = "https://hostinger-kvm8-host.tail9831b.ts.net:8445";

// These explicit staging-only deployment values prevent an isolated test
// container from sending Collabora callbacks to another staging instance.
// Production keeps the reviewed defaults unless it opts in at deployment time.
export const WOPI_EDITOR_ORIGIN = process.env.PAPERCLIP_WOPI_EDITOR_ORIGIN?.trim() || DEFAULT_WOPI_EDITOR_ORIGIN;
export const WOPI_STAGING_CALLBACK_ORIGIN =
  process.env.PAPERCLIP_WOPI_CALLBACK_ORIGIN?.trim() || DEFAULT_WOPI_STAGING_CALLBACK_ORIGIN;
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;

export type WopiDocumentFormat = "docx" | "xlsx";
export type WopiLock = { value: string; expiresAt: number };

export interface WopiSession {
  token: string;
  companyId: string;
  artifactId: string;
  versionId: string;
  format: WopiDocumentFormat;
  actor: ArtifactActor;
  expiresAt: number;
  lock: WopiLock | null;
}

export function normalizeWopiToken(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  return value;
}

export function wopiTokenMatches(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function wopiEditorActionUrl(format: WopiDocumentFormat): string {
  const action = format === "docx" ? "edit" : "edit";
  return `${WOPI_EDITOR_ORIGIN}/browser/dist/cool.html?WOPISrc={{WOPISrc}}&action=${action}`;
}

export function createWopiSessionStore(input: { now?: () => number; ttlMs?: number } = {}) {
  const now = input.now ?? Date.now;
  const ttlMs = input.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessions = new Map<string, WopiSession>();

  function getLock(session: WopiSession): string | null {
    if (session.lock && session.lock.expiresAt <= now()) session.lock = null;
    return session.lock?.value ?? null;
  }

  function prune() {
    const timestamp = now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(token);
    }
  }

  return {
    create(input: Omit<WopiSession, "token" | "expiresAt" | "lock">): WopiSession {
      prune();
      for (const [token, session] of sessions) {
        if (
          session.companyId === input.companyId
          && session.artifactId === input.artifactId
          && session.versionId === input.versionId
          && session.actor.createdByUserId === input.actor.createdByUserId
          && session.actor.createdByAgentId === input.actor.createdByAgentId
        ) sessions.delete(token);
      }
      const session: WopiSession = {
        ...input,
        token: randomBytes(32).toString("base64url"),
        expiresAt: now() + ttlMs,
        lock: null,
      };
      sessions.set(session.token, session);
      return session;
    },
    get(token: string | null, artifactId: string): WopiSession | null {
      prune();
      if (!token) return null;
      const session = sessions.get(token);
      if (!session || session.artifactId !== artifactId || !wopiTokenMatches(session.token, token)) return null;
      return session;
    },
    lock(session: WopiSession, value: string, durationSeconds: number): { ok: true } | { ok: false; current: string } {
      const timestamp = now();
      if (session.lock && session.lock.expiresAt <= timestamp) session.lock = null;
      if (session.lock && session.lock.value !== value) return { ok: false, current: session.lock.value };
      session.lock = { value, expiresAt: timestamp + durationSeconds * 1000 };
      return { ok: true };
    },
    getLock(session: WopiSession): string | null {
      return getLock(session);
    },
    unlock(session: WopiSession, value: string): { ok: true } | { ok: false; current: string | null } {
      const current = getLock(session);
      if (!current || current !== value) return { ok: false, current };
      session.lock = null;
      return { ok: true };
    },
    relock(session: WopiSession, oldValue: string, newValue: string, durationSeconds: number): { ok: true } | { ok: false; current: string | null } {
      const current = getLock(session);
      if (!current || current !== oldValue) return { ok: false, current };
      session.lock = { value: newValue, expiresAt: now() + durationSeconds * 1000 };
      return { ok: true };
    },
  };
}

export type WopiSessionStore = ReturnType<typeof createWopiSessionStore>;
