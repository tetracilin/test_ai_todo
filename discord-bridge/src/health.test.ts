import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { startHealthServer } from "./health.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("bridge health endpoint", () => {
  it("reports starting until the Discord client is ready", async () => {
    let ready = false;
    const server = startHealthServer(0, () => ready);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP health listener");

    let response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "starting" });

    ready = true;
    response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("returns 404 for paths other than /health", async () => {
    const server = startHealthServer(0, () => true);
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP health listener");

    const response = await fetch(`http://127.0.0.1:${address.port}/other`);
    expect(response.status).toBe(404);
  });
});
