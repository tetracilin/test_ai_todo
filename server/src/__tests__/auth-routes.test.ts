import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { authRoutes } from "../routes/auth.js";

function createSelectChain(rows: unknown[]) {
  return {
    from() {
      return {
        where() {
          return Promise.resolve(rows);
        },
      };
    },
  };
}

function createUpdateChain(row: unknown) {
  return {
    set(values: unknown) {
      return {
        where() {
          return {
            returning() {
              // A missing row means the UPDATE matched nothing.
              if (!row) return Promise.resolve([]);
              return Promise.resolve([{ ...(row as Record<string, unknown>), ...(values as Record<string, unknown>) }]);
            },
          };
        },
      };
    },
  };
}

function createDb(row: Record<string, unknown> | null) {
  return {
    select: () => createSelectChain(row ? [row] : []),
    update: () => (row ? createUpdateChain(row) : createUpdateChain(null)),
  } as any;
}

function createApp(actor: Express.Request["actor"], row: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api/auth", authRoutes(createDb(row)));
  app.use(errorHandler);
  return app;
}

describe.sequential("auth routes", () => {
  const baseUser = {
    id: "user-1",
    name: "Jane Example",
    email: "jane@example.com",
    image: "https://example.com/jane.png",
  };

  it("returns the persisted user profile in the session payload", async () => {
    const app = await createApp(
      {
        type: "board",
        userId: "user-1",
        source: "session",
      },
      baseUser,
    );

    const res = await request(app).get("/api/auth/get-session");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      session: {
        id: "paperclip:session:user-1",
        userId: "user-1",
      },
      user: baseUser,
    });
  });

  it("updates the signed-in profile", async () => {
    const app = await createApp(
      {
        type: "board",
        userId: "user-1",
        source: "local_implicit",
      },
      baseUser,
    );

    const res = await request(app)
      .patch("/api/auth/profile")
      .send({ name: "Board Operator", image: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "user-1",
      name: "Board Operator",
      email: "jane@example.com",
      image: null,
    });
  });

  it("preserves the existing avatar when updating only the profile name", async () => {
    const app = await createApp(
      {
        type: "board",
        userId: "user-1",
        source: "local_implicit",
      },
      baseUser,
    );

    const res = await request(app)
      .patch("/api/auth/profile")
      .send({ name: "Board Operator" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "user-1",
      name: "Board Operator",
      email: "jane@example.com",
      image: "https://example.com/jane.png",
    });
  });

  it("accepts Paperclip asset paths for avatars", async () => {
    const app = await createApp(
      {
        type: "board",
        userId: "user-1",
        source: "session",
      },
      baseUser,
    );

    const res = await request(app)
      .patch("/api/auth/profile")
      .send({ name: "Jane Example", image: "/api/assets/asset-1/content" });

    expect(res.status).toBe(200);
    expect(res.body.image).toBe("/api/assets/asset-1/content");
  });

  it("rejects invalid avatar image references", async () => {
    const app = await createApp(
      {
        type: "board",
        userId: "user-1",
        source: "session",
      },
      baseUser,
    );

    const res = await request(app)
      .patch("/api/auth/profile")
      .send({ name: "Jane Example", image: "not-a-url" });

    expect(res.status).toBe(400);
  });

  it("rejects a blank display name with 400", async () => {
    const app = createApp({ type: "board", userId: "user-1", source: "session" }, baseUser);

    const res = await request(app).patch("/api/auth/profile").send({ name: "   " });

    expect(res.status).toBe(400);
  });

  it("returns the persisted profile from GET /profile", async () => {
    const app = createApp({ type: "board", userId: "user-1", source: "session" }, baseUser);

    const res = await request(app).get("/api/auth/profile");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(baseUser);
  });

  it.each([
    { label: "agent", actor: { type: "agent", agentId: "agent-1", source: "agent_key" } },
    { label: "unauthenticated", actor: { type: "none", source: "none" } },
    { label: "board actor without a user id", actor: { type: "board", source: "board_key" } },
  ] as const)("returns 401 on every endpoint for a $label actor", async ({ actor }) => {
    const app = createApp(actor as unknown as Express.Request["actor"], baseUser);

    expect((await request(app).get("/api/auth/get-session")).status).toBe(401);
    expect((await request(app).get("/api/auth/profile")).status).toBe(401);
    expect((await request(app).patch("/api/auth/profile").send({ name: "X" })).status).toBe(401);
  });

  it("returns 401 when the signed-in user no longer exists", async () => {
    const app = createApp({ type: "board", userId: "ghost", source: "session" }, null);

    expect((await request(app).get("/api/auth/get-session")).status).toBe(401);
    expect((await request(app).patch("/api/auth/profile").send({ name: "X" })).status).toBe(401);
  });
});
