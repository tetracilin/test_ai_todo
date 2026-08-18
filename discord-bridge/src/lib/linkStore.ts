import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Bridge-owned local persistence: Discord user <-> Paperclip user linking, and
 * per-recipient "what have we already notified about" state. This is state
 * the bridge needs to do its job — it is not a change to Paperclip's own
 * issue/comment/interaction schema.
 *
 * Backed by a single JSON file rather than SQLite: expected volume is a
 * handful of linked users and their watched issues, so a flat file avoids
 * forcing a native-module build toolchain (better-sqlite3) onto whoever
 * deploys this standalone service.
 */

export interface Link {
  discordUserId: string;
  paperclipUserId: string;
  notifyChannelId: string | null;
  linkedAt: string;
}

export interface WatchState {
  discordUserId: string;
  issueId: string;
  lastStatus: string | null;
  lastCommentId: string | null;
  lastSeenInteractionIds: string[];
  updatedAt: string;
}

interface StoreShape {
  links: Record<string, Link>;
  watchState: Record<string, WatchState>;
}

function emptyStore(): StoreShape {
  return { links: {}, watchState: {} };
}

function watchKey(discordUserId: string, issueId: string): string {
  return `${discordUserId}::${issueId}`;
}

export class LinkStore {
  private data: StoreShape;

  constructor(private path: string) {
    this.data = this.load();
  }

  private load(): StoreShape {
    if (this.path === ":memory:" || !existsSync(this.path)) {
      return emptyStore();
    }
    try {
      const raw = readFileSync(this.path, "utf8");
      return raw.trim() ? (JSON.parse(raw) as StoreShape) : emptyStore();
    } catch (err) {
      console.error(`linkStore: failed to read ${this.path}, starting fresh:`, err);
      return emptyStore();
    }
  }

  private persist(): void {
    if (this.path === ":memory:") return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmpPath = `${this.path}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    renameSync(tmpPath, this.path);
  }

  linkUser(discordUserId: string, paperclipUserId: string, notifyChannelId: string | null): Link {
    const link: Link = {
      discordUserId,
      paperclipUserId,
      notifyChannelId,
      linkedAt: new Date().toISOString(),
    };
    this.data.links[discordUserId] = link;
    this.persist();
    return link;
  }

  unlinkUser(discordUserId: string): void {
    delete this.data.links[discordUserId];
    for (const key of Object.keys(this.data.watchState)) {
      if (key.startsWith(`${discordUserId}::`)) delete this.data.watchState[key];
    }
    this.persist();
  }

  getLinkByDiscordUser(discordUserId: string): Link | null {
    return this.data.links[discordUserId] ?? null;
  }

  getAllLinks(): Link[] {
    return Object.values(this.data.links);
  }

  getWatchState(discordUserId: string, issueId: string): WatchState | null {
    return this.data.watchState[watchKey(discordUserId, issueId)] ?? null;
  }

  upsertWatchState(state: WatchState): void {
    this.data.watchState[watchKey(state.discordUserId, state.issueId)] = state;
    this.persist();
  }

  close(): void {
    // No open handle to release; persist() writes synchronously on every mutation.
  }
}
