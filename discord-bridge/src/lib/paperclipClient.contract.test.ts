import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PaperclipApiError, PaperclipClient } from "./paperclipClient.js";

/**
 * Contract test for the HTTP client layer, standing in for Paperclip's public
 * API with a tiny in-process stub. Complements (does not replace) the
 * existing handlers.test.ts fake-object tests, which never exercise fetch().
 */
interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: unknown;
}

describe("PaperclipClient contract", () => {
  let server: Server;
  let baseUrl: string;
  let requests: RecordedRequest[];
  let nextResponse: { status: number; body: unknown };

  beforeAll(async () => {
    server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: raw ? JSON.parse(raw) : null,
        });
        res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(nextResponse.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server not listening");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    requests = [];
    nextResponse = { status: 200, body: {} };
  });

  const client = () =>
    new PaperclipClient({ apiUrl: baseUrl, apiKey: "test-key", companyId: "company-1" });

  it("sends an authenticated JSON GET for getIssue", async () => {
    nextResponse = { status: 200, body: { id: "i1", identifier: "T-10" } };
    const result = await client().getIssue("i1");

    expect(result).toEqual({ id: "i1", identifier: "T-10" });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe("/api/issues/i1");
    expect(requests[0].headers.authorization).toBe("Bearer test-key");
    expect(requests[0].headers["content-type"]).toBe("application/json");
  });

  it("sends a JSON POST body for postComment", async () => {
    nextResponse = { status: 200, body: { id: "c1", body: "hi" } };
    await client().postComment("i1", "hi");

    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe("/api/issues/i1/comments");
    expect(requests[0].body).toEqual({ body: "hi" });
  });

  it("builds a company-scoped search query for findIssueByIdentifier and exact-matches the identifier", async () => {
    nextResponse = {
      status: 200,
      body: [
        { id: "i2", identifier: "T-100", title: "Other" },
        { id: "i1", identifier: "T-10", title: "Match" },
      ],
    };
    const result = await client().findIssueByIdentifier("t-10");

    // The search query is sent as typed; only the final exact-match is case-insensitive.
    expect(requests[0].url).toBe("/api/companies/company-1/issues?q=t-10");
    expect(result).toEqual({ id: "i1", identifier: "T-10", title: "Match" });
  });

  it("returns null when no exact identifier match is found (edge case)", async () => {
    nextResponse = { status: 200, body: [{ id: "i2", identifier: "T-100", title: "Other" }] };
    const result = await client().findIssueByIdentifier("T-10");
    expect(result).toBeNull();
  });

  it("maps a non-2xx response to a typed PaperclipApiError", async () => {
    nextResponse = { status: 403, body: { error: "board_only" } };

    await expect(client().getIssue("i1")).rejects.toMatchObject({
      name: "PaperclipApiError",
      status: 403,
      path: "/api/issues/i1",
      body: { error: "board_only" },
    });
    await expect(client().getIssue("i1")).rejects.toBeInstanceOf(PaperclipApiError);
  });
});
