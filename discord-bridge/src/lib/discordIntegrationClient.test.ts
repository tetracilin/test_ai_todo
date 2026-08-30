import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DiscordIntegrationApiError, DiscordIntegrationClient } from "./discordIntegrationClient.js";

describe("DiscordIntegrationClient", () => {
  let server: Server;
  let baseUrl: string;
  let nextResponse: { status: number; body: unknown };
  let requests: Array<{ url: string | undefined; method: string | undefined; authorization: string | undefined; body: unknown }>;

  beforeAll(async () => {
    server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        requests.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
        res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(nextResponse.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server unavailable");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => server.close());
  beforeEach(() => {
    requests = [];
    nextResponse = { status: 200, body: { duplicate: false, issue: { id: "i1", identifier: "T-1", title: "Task", projectName: "Core", url: "https://pc/T-1" } } };
  });

  const client = () => new DiscordIntegrationClient({ apiUrl: baseUrl, apiKey: "test-key" });
  const request = {
    discordInteractionId: "discord-interaction-1", discordUserId: "discord-user-1", guildId: "guild-1", channelId: "channel-1",
    parentChannelId: null, commandName: "paperclip task create" as const, title: "Task", priority: "high" as const,
  };

  it("calls only bridge-scoped task-create endpoint with normalized Discord context", async () => {
    await client().createTask(request);

    expect(requests).toEqual([{ method: "POST", url: "/api/integrations/discord/commands/task-create", authorization: "Bearer test-key", body: request }]);
  });

  it("returns sanitized integration error code", async () => {
    nextResponse = { status: 403, body: { code: "project_access_denied", detail: "do not expose" } };

    await expect(client().createTask(request)).rejects.toEqual(new DiscordIntegrationApiError(403, "project_access_denied"));
  });

  it("uses bridge-only delivery endpoints without exposing generic issue writes", async () => {
    nextResponse = { status: 200, body: [] };
    await client().getPendingDiscordDeliveries();
    expect(requests[0]).toMatchObject({ method: "GET", url: "/api/integrations/discord/deliveries/pending" });

    nextResponse = { status: 200, body: { ok: true } };
    await client().acknowledgeDiscordDelivery("event 1", "delivery 1", { outcome: "suppressed" });
    expect(requests[1]).toMatchObject({
      method: "POST",
      url: "/api/integrations/discord/events/event%201/deliveries/delivery%201",
      body: { outcome: "suppressed" },
    });
  });
});