import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  discordGuildIntegrations,
  discordNotificationPreferences,
  discordProjectChannelMappings,
  discordUserLinks,
} from "@paperclipai/db";
import { discordIntegrationRoutes, DISCORD_NOTIFICATION_EVENTS } from "./discord-integrations.js";
import { errorHandler } from "../middleware/error-handler.js";

type TableName = string;
interface Row {
  [key: string]: unknown;
}

/**
 * Minimal drizzle-shaped fake. Only the `select().from(...).where(...)` fetch
 * and `update(...).set(...).where(...)[.returning()]` shapes exercised by the
 * settings GET, board disconnect, and bridge unlink routes are implemented.
 * Tables are dispatched by their SQL name so the test controls canned rows per
 * table regardless of which column predicates the route builds.
 */
function makeDb(options: {
  links?: Row[];
  prefs?: Row[];
  guilds?: Row[];
  mappings?: Row[];
  unlinkReturn?: Row[];
} = {}) {
  const rowsByTable: Record<TableName, Row[]> = {
    [getTableName(discordUserLinks as never)]: options.links ?? [],
    [getTableName(discordNotificationPreferences as never)]: options.prefs ?? [],
    [getTableName(discordGuildIntegrations as never)]: options.guilds ?? [],
    [getTableName(discordProjectChannelMappings as never)]: options.mappings ?? [],
  };
  const updates: { table: TableName; set: Record<string, unknown> }[] = [];
  const db = {
    updates,
    lastUpdate: () => updates.at(-1),
    select: () => ({
      from: (table: unknown) => {
        const rows = rowsByTable[getTableName(table as never)] ?? [];
        return {
          where: () => Promise.resolve(rows),
        };
      },
    }),
    update: (table: unknown) => {
      const name = getTableName(table as never);
      return {
        set: (set: Record<string, unknown>) => ({
          where: () => {
            updates.push({ table: name, set });
            for (const row of rowsByTable[name] ?? []) Object.assign(row, set);
            if (name === getTableName(discordUserLinks as never) && set.active === false) {
              rowsByTable[name] = (rowsByTable[name] ?? []).filter((row) => row.active !== false);
            }
            const pending = Promise.resolve(undefined);
            const returned = Promise.resolve(options.unlinkReturn ?? []);
            return Object.assign(pending, { returning: () => returned });
          },
        }),
      };
    },
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(undefined),
      }),
    }),
  };
  return db;
}

function createApp(db: unknown, actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", discordIntegrationRoutes(db as never));
  app.use(errorHandler);
  return app;
}

const BOARD_USER = {
  type: "board",
  userId: "U1",
  source: "session",
  companyIds: ["c1"],
  isInstanceAdmin: false,
  memberships: [{ companyId: "c1", status: "active", membershipRole: "editor" }],
};
const BUILD_BRIDGE_TOKEN = "bridge-token";
const ORIGINAL_BRIDGE_TOKEN = process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN;

const linkedRow = { companyId: "c1", userId: "U1", discordUserId: "D1", active: true };

describe("Discord integration browser contracts", () => {
  beforeEach(() => {
    delete process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN;
  });
  afterEach(() => {
    if (ORIGINAL_BRIDGE_TOKEN === undefined) delete process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN;
    else process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN = ORIGINAL_BRIDGE_TOKEN;
  });

  describe("GET /api/integrations/discord/settings", () => {
    it("returns the caller link plus configured guild/channel mappings for an authorized board user", async () => {
      const db = makeDb({
        links: [linkedRow],
        prefs: [{ companyId: "c1", userId: "U1", eventType: "issue.created", enabled: true, deliveryMode: "channel", channelId: "ch1" }],
        guilds: [
          { companyId: "c1", guildId: "g1", enabled: true },
          { companyId: "c1", guildId: "g2", enabled: false },
        ],
        mappings: [
          { companyId: "c1", guildId: "g1", channelId: "ch1", projectId: "p1", enabled: true, allowTaskCreate: false, notificationEvents: ["issue.created"] },
          { companyId: "c1", guildId: "g1", channelId: "ch2", projectId: "p2", enabled: true, allowTaskCreate: true, notificationEvents: [] },
        ],
      });
      const app = createApp(db, BOARD_USER);
      const res = await request(app).get("/api/integrations/discord/settings?companyId=c1");

      expect(res.status).toBe(200);
      expect(res.body.link).toEqual({ status: "linked", discordUserId: "D1" });
      expect(res.body.guilds).toEqual([{ guildId: "g1", enabled: true }]); // disabled g2 filtered out
      expect(res.body.channels).toEqual([
        { guildId: "g1", channelId: "ch1", projectId: "p1", enabled: true, allowTaskCreate: false, notificationEvents: ["issue.created"] },
        { guildId: "g1", channelId: "ch2", projectId: "p2", enabled: true, allowTaskCreate: true, notificationEvents: [] },
      ]);
      expect(res.body.preferences.find((p: { eventType: string }) => p.eventType === "issue.created"))
        .toEqual({ eventType: "issue.created", enabled: true, deliveryMode: "channel", channelId: "ch1" });
      expect(res.body.preferences).toHaveLength(DISCORD_NOTIFICATION_EVENTS.length);
      // No display labels — the server owns none.
      expect(res.body.guilds[0]).not.toHaveProperty("name");
      expect(res.body.channels[0]).not.toHaveProperty("name");
    });

    it("reports the caller as unlinked with empty mappings when nothing is configured", async () => {
      const app = createApp(makeDb(), BOARD_USER);
      const res = await request(app).get("/api/integrations/discord/settings?companyId=c1");

      expect(res.status).toBe(200);
      expect(res.body.link).toEqual({ status: "unlinked", discordUserId: null });
      expect(res.body.guilds).toEqual([]);
      expect(res.body.channels).toEqual([]);
    });

    it("requires board authentication", async () => {
      const app = createApp(makeDb(), { type: "none" });
      const res = await request(app).get("/api/integrations/discord/settings?companyId=c1");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("board_auth_required");
    });

    it("returns a stable permission-denied code for companies the user cannot access", async () => {
      const app = createApp(makeDb(), { ...BOARD_USER, companyIds: ["c2"] });
      const res = await request(app).get("/api/integrations/discord/settings?companyId=c1");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("permission_denied");
    });

    it("requires the companyId query parameter", async () => {
      const app = createApp(makeDb(), BOARD_USER);
      const res = await request(app).get("/api/integrations/discord/settings");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/integrations/discord/disconnect", () => {
    it("deactivates only the caller's link and disables caller preferences without bridge credentials", async () => {
      const db = makeDb({ links: [linkedRow] });
      const app = createApp(db, BOARD_USER);
      // No Authorization header is set: the board-disconnect endpoint must not
      // require bridge bearer credentials (it returns 200 with none supplied).
      const res = await request(app).post("/api/integrations/discord/disconnect").send({ companyId: "c1" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        link: { status: "unlinked", discordUserId: null },
        preferences: DISCORD_NOTIFICATION_EVENTS.map((eventType) => ({ eventType, enabled: false, deliveryMode: "dm", channelId: null })),
        guilds: [],
        channels: [],
      });
      const linkUpdate = db.updates.find((u) => u.table === getTableName(discordUserLinks as never));
      const prefsUpdate = db.updates.find((u) => u.table === getTableName(discordNotificationPreferences as never));
      expect(linkUpdate?.set).toMatchObject({ active: false });
      expect(prefsUpdate?.set).toMatchObject({ enabled: false });
    });

    it("is idempotent when the caller has no active link", async () => {
      const db = makeDb();
      const app = createApp(db, BOARD_USER);
      const res = await request(app).post("/api/integrations/discord/disconnect").send({ companyId: "c1" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        link: { status: "unlinked", discordUserId: null },
        preferences: DISCORD_NOTIFICATION_EVENTS.map((eventType) => ({ eventType, enabled: false, deliveryMode: "dm", channelId: null })),
        guilds: [],
        channels: [],
      });
    });

    it("requires board authentication", async () => {
      const app = createApp(makeDb(), { type: "none" });
      const res = await request(app).post("/api/integrations/discord/disconnect").send({ companyId: "c1" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("board_auth_required");
    });

    it("returns a stable permission-denied code for companies the user cannot access", async () => {
      const app = createApp(makeDb(), { ...BOARD_USER, companyIds: ["c2"] });
      const res = await request(app).post("/api/integrations/discord/disconnect").send({ companyId: "c1" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("permission_denied");
    });

    it("requires the companyId body field", async () => {
      const app = createApp(makeDb(), BOARD_USER);
      const res = await request(app).post("/api/integrations/discord/disconnect").send({});
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/integrations/discord/preferences", () => {
    it("accepts the exact browser envelope and returns full Discord settings", async () => {
      const db = makeDb({ links: [linkedRow] });
      const app = createApp(db, BOARD_USER);
      const res = await request(app)
        .patch("/api/integrations/discord/preferences")
        .send({ companyId: "c1", preferences: [] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        link: { status: "linked", discordUserId: "D1" },
        preferences: DISCORD_NOTIFICATION_EVENTS.map((eventType) => ({ eventType, enabled: false, deliveryMode: "dm", channelId: null })),
        guilds: [],
        channels: [],
      });
    });

    it("rejects unknown fields in the browser envelope", async () => {
      const app = createApp(makeDb(), BOARD_USER);
      const res = await request(app)
        .patch("/api/integrations/discord/preferences")
        .send({ companyId: "c1", preferences: [], unexpected: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation error");
    });
  });

  describe("POST /api/integrations/discord/unlink (bridge flow preserved)", () => {
    it("still requires bridge bearer credentials and rejects without a configured token", async () => {
      const app = createApp(makeDb(), BOARD_USER);
      const res = await request(app).post("/api/integrations/discord/unlink").send({ discordUserId: "D1" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("bridge_not_configured");
    });

    it("rejects an invalid bridge token with a stable code", async () => {
      process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN = BUILD_BRIDGE_TOKEN;
      const app = createApp(makeDb(), BOARD_USER);
      const res = await request(app)
        .post("/api/integrations/discord/unlink")
        .set("authorization", "Bearer wrong-token")
        .send({ discordUserId: "D1" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("bridge_auth_required");
    });

    it("accepts a valid bridge token and mutes preferences for the unlinked row", async () => {
      process.env.PAPERCLIP_DISCORD_BRIDGE_TOKEN = BUILD_BRIDGE_TOKEN;
      const db = makeDb({
        links: [{ companyId: "c1", userId: "U1", discordUserId: "D1", active: true }],
        unlinkReturn: [linkedRow],
      });
      const app = createApp(db, BOARD_USER);
      const res = await request(app)
        .post("/api/integrations/discord/unlink")
        .set("authorization", `Bearer ${BUILD_BRIDGE_TOKEN}`)
        .send({ discordUserId: "D1" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "unlinked" });
      const prefsUpdate = db.updates.find((u) => u.table === getTableName(discordNotificationPreferences));
      expect(prefsUpdate?.set).toMatchObject({ enabled: false });
    });
  });
});