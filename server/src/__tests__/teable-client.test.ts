import { describe, expect, it, vi } from "vitest";
import {
  buildTeableUrl,
  classifyTeableStatus,
  createTeableClient,
  parseRetryAfterSeconds,
  parseTeableErrorEnvelope,
  parseTeableRecord,
  resolveTeableConfigFromEnv,
  retryDelayMs,
  TEABLE_DEFAULT_BASE_URL,
  TEABLE_DEFAULT_PAGE_SIZE,
  TEABLE_DEFAULT_RETRY_AFTER_SECONDS,
  type TeableClientOptions,
} from "../services/teable-client.js";
import exchanges from "./fixtures/teable-api-exchanges.json" with { type: "json" };

/**
 * F-010-1. Every case here runs WITHOUT Postgres: the client takes an injected
 * `fetch` and either a `tokenProvider` or a fake secrets dep, so `db` is never
 * touched. Do not add a `getEmbeddedPostgresTestSupport()` gate to this file.
 *
 * No test opens a socket. Production Teable is self-hosted on the app host and
 * the hosted Teable API must never be contacted from this repo, so the suite is
 * pinned entirely to the checked-in fixture.
 */

const TOKEN = "tea_pat_test_secret";
const BASE_URL = "https://teable.example.com";

type Exchange = {
  name: string;
  request: { method: string; path: string; query: Record<string, string> };
  response: { status: number; headers: Record<string, string>; body: unknown };
};

const EXCHANGES = (exchanges as { exchanges: Exchange[] }).exchanges;

function exchange(name: string): Exchange {
  const found = EXCHANGES.find((entry) => entry.name === name);
  if (!found) throw new Error(`fixture exchange not found: ${name}`);
  return found;
}

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/**
 * No DNS in tests. The address must be genuinely public: the guard rejects the
 * documentation ranges (203.0.113.0/24 and friends) along with real private space.
 */
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function client(opts: TeableClientOptions = {}) {
  const sleeps: number[] = [];
  const instance = createTeableClient({} as never, {
    tokenProvider: () => TOKEN,
    lookup: publicLookup,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...opts,
    config: { baseUrl: BASE_URL, allowPrivateNetwork: false, ...(opts.config ?? {}) },
  });
  return { instance, sleeps };
}

describe("teable config", () => {
  it("defaults to the self-hosted container and only auto-allows the private network there", () => {
    const config = resolveTeableConfigFromEnv({});
    expect(config.baseUrl).toBe(TEABLE_DEFAULT_BASE_URL);
    expect(config.allowPrivateNetwork).toBe(true);
    expect(config.requestTimeoutMs).toBe(15_000);
    expect(config.maxAttempts).toBe(3);
  });

  it("requires an explicit opt-in for any other private host", () => {
    expect(
      resolveTeableConfigFromEnv({ PAPERCLIP_TEABLE_BASE_URL: "http://10.0.0.5:3000" })
        .allowPrivateNetwork,
    ).toBe(false);
    expect(
      resolveTeableConfigFromEnv({
        PAPERCLIP_TEABLE_BASE_URL: "http://10.0.0.5:3000",
        PAPERCLIP_TEABLE_ALLOW_PRIVATE_NETWORK: "1",
      }).allowPrivateNetwork,
    ).toBe(true);
  });

  it("ignores unparseable numeric env values instead of producing NaN", () => {
    const config = resolveTeableConfigFromEnv({
      PAPERCLIP_TEABLE_REQUEST_TIMEOUT_MS: "not-a-number",
      PAPERCLIP_TEABLE_MAX_ATTEMPTS: "0",
    });
    expect(config.requestTimeoutMs).toBe(15_000);
    expect(config.maxAttempts).toBe(3);
  });

  it("throws at construction when the base URL is unusable", () => {
    expect(() => createTeableClient({} as never, { config: { baseUrl: "not a url" } })).toThrow(
      /valid http or https URL/,
    );
    expect(() =>
      createTeableClient({} as never, { config: { baseUrl: "ftp://teable.example.com" } }),
    ).toThrow(/valid http or https URL/);
  });
});

describe("teable url building", () => {
  it("prefixes /api and preserves a reverse-proxy path", () => {
    expect(buildTeableUrl("https://host/teable", "/table/tbl1/record", { take: 2 })).toBe(
      "https://host/teable/api/table/tbl1/record?take=2",
    );
    expect(buildTeableUrl("https://host", "/base/bse1/table")).toBe(
      "https://host/api/base/bse1/table",
    );
  });

  it("repeats array parameters rather than joining them", () => {
    expect(buildTeableUrl("https://host", "/table/tbl1/record", { projection: ["a", "b"] })).toBe(
      "https://host/api/table/tbl1/record?projection=a&projection=b",
    );
  });
});

describe("teable request shape", () => {
  it("builds the documented list-records request", async () => {
    const fetch = vi.fn(async () => response(exchange("list-records-ok").response.body));
    const { instance } = client({ fetch });

    await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot", take: 2, skip: 0 });

    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/table/tblSlice1Pilot/record?take=2&skip=0&fieldKeyType=name`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("posts exactly the documented create body", async () => {
    const fetch = vi.fn(async () => response(exchange("create-records-ok").response.body, { status: 201 }));
    const { instance } = client({ fetch });

    await instance.createRecords({
      companyId: "company-1",
      tableId: "tblSlice1Pilot",
      records: [{ fields: { "Ten cong viec": "Tim OEM" } }],
      typecast: true,
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/api/table/tblSlice1Pilot/record`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      fieldKeyType: "name",
      typecast: true,
      records: [{ fields: { "Ten cong viec": "Tim OEM" } }],
    });
  });

  it("rejects hostile ids before any request is made", async () => {
    const fetch = vi.fn(async () => response({}));
    const { instance } = client({ fetch });

    await expect(
      instance.listRecords({ companyId: "company-1", tableId: "../../admin" }),
    ).rejects.toThrow(/Invalid Teable table id/);
    await expect(
      instance.getRecord({ companyId: "company-1", tableId: "tbl1", recordId: "rec 1" }),
    ).rejects.toThrow(/Invalid Teable record id/);
    await expect(
      instance.listTables({ companyId: "company-1", baseId: "b".repeat(65) }),
    ).rejects.toThrow(/Invalid Teable base id/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("PATCHes exactly the documented single-record update body (F-005-1)", async () => {
    const fetch = vi.fn(async () => response(exchange("update-record-ok").response.body));
    const { instance } = client({ fetch });

    const result = await instance.updateRecord({
      companyId: "company-1",
      tableId: "tblSlice1Pilot",
      recordId: "recEvidence01",
      fields: { "Trang thai": "done" },
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/api/table/tblSlice1Pilot/record/recEvidence01`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      fieldKeyType: "name",
      typecast: false,
      record: { fields: { "Trang thai": "done" } },
    });
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "recEvidence01", lastModifiedTime: "2026-09-14T03:00:00.000Z" }),
    });
  });

  it("never retries a failed update -- exactly one PATCH attempt even on a retryable error", async () => {
    const fetch = vi.fn(async () =>
      response({ message: "Too many requests", status: 429, code: "too_many_requests" }, { status: 429 }),
    );
    const { instance } = client({ fetch });

    const result = await instance.updateRecord({
      companyId: "company-1",
      tableId: "tblSlice1Pilot",
      recordId: "recEvidence01",
      fields: { "Trang thai": "done" },
    });

    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("teable credentials", () => {
  it("sends the token as a bearer header and never returns it", async () => {
    const fetch = vi.fn(async () => response(exchange("list-records-ok").response.body));
    const { instance } = client({ fetch });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${TOKEN}` }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("probes secret names in order, skips a missing one, and resolves once per company", async () => {
    const getByName = vi.fn(async (_companyId: string, name: string) =>
      name === "TEABLE_API_TOKEN" ? { id: "secret-1" } : null,
    );
    const resolveSecretValue = vi.fn(async () => `  ${TOKEN}  `);
    const fetch = vi.fn(async () => response(exchange("list-records-ok").response.body));
    const instance = createTeableClient({} as never, {
      config: { baseUrl: BASE_URL, allowPrivateNetwork: false },
      lookup: publicLookup,
      fetch,
      secrets: { getByName, resolveSecretValue },
    });

    await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });
    await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    // "read" purpose tries TEABLE_READ_TOKEN first, then TEABLE_API_TOKEN.
    expect(getByName.mock.calls.map(([, name]) => name)).toEqual([
      "TEABLE_READ_TOKEN",
      "TEABLE_API_TOKEN",
    ]);
    expect(resolveSecretValue).toHaveBeenCalledTimes(1);
    expect(resolveSecretValue).toHaveBeenCalledWith(
      "company-1",
      "secret-1",
      "latest",
      expect.objectContaining({
        accessContext: expect.objectContaining({ consumerId: "teable-client", actorType: "system" }),
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      headers: expect.objectContaining({ authorization: `Bearer ${TOKEN}` }),
    });
  });

  it("uses the write secret names for a create", async () => {
    const getByName = vi.fn(async () => ({ id: "secret-1" }));
    const resolveSecretValue = vi.fn(async () => TOKEN);
    const fetch = vi.fn(async () => response(exchange("create-records-ok").response.body, { status: 201 }));
    const instance = createTeableClient({} as never, {
      config: { baseUrl: BASE_URL, allowPrivateNetwork: false },
      lookup: publicLookup,
      fetch,
      secrets: { getByName, resolveSecretValue },
    });

    await instance.createRecords({
      companyId: "company-1",
      tableId: "tblSlice1Pilot",
      records: [{ fields: {} }],
    });

    expect(getByName.mock.calls.map(([, name]) => name)).toEqual(["TEABLE_API_TOKEN"]);
  });

  it("refuses without a token and never calls fetch", async () => {
    const fetch = vi.fn(async () => response({}));
    const { instance } = client({ fetch, tokenProvider: null });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result).toMatchObject({ ok: false, error: { code: "teable_not_configured", retryable: false } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fall back to a server-wide env token", async () => {
    const getByName = vi.fn(async () => null);
    const fetch = vi.fn(async () => response({}));
    const instance = createTeableClient({} as never, {
      config: { baseUrl: BASE_URL, allowPrivateNetwork: false },
      lookup: publicLookup,
      fetch,
      env: { TEABLE_API_TOKEN: "env-token" } as NodeJS.ProcessEnv,
      secrets: { getByName, resolveSecretValue: vi.fn(async () => "env-token") },
    });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result).toMatchObject({ ok: false, error: { code: "teable_not_configured" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("teable error mapping", () => {
  it.each([
    [400, null, "teable_invalid_request", false],
    [401, "unauthorized", "teable_auth_required", false],
    [403, "restricted_resource", "teable_forbidden", false],
    [404, "not_found", "teable_not_found", false],
    [429, "too_many_requests", "teable_rate_limited", true],
    [500, null, "teable_server_error", true],
    [503, null, "teable_server_error", true],
  ])("maps HTTP %s to %s", async (status, code, expectedCode, retryable) => {
    const fetch = vi.fn(async () =>
      response({ message: "row content that must not leak", status, code }, { status }),
    );
    // maxAttempts 1 so retryable statuses resolve in a single call here.
    const { instance } = client({ fetch, config: { maxAttempts: 1 } });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(expectedCode);
    expect(result.error.retryable).toBe(retryable);
    expect(result.error.status).toBe(status);
    expect(result.error.message).not.toContain("row content");
  });

  it("keeps an unrecognised code on its status rather than guessing not-found", () => {
    expect(classifyTeableStatus(403, parseTeableErrorEnvelope({ code: "brand_new_code" }))).toBe(
      "teable_forbidden",
    );
    expect(classifyTeableStatus(418, parseTeableErrorEnvelope(null))).toBe("teable_invalid_request");
  });

  it("classifies on the documented code even when the status is unusual", () => {
    expect(classifyTeableStatus(403, parseTeableErrorEnvelope({ code: "not_found" }))).toBe(
      "teable_not_found",
    );
  });

  it("turns a transport failure into an unreachable result rather than a rejection", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const { instance } = client({ fetch, config: { maxAttempts: 1 } });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "teable_unreachable", retryable: true, status: null },
    });
  });

  it("reports invalid_response for a 200 that does not carry the documented shape", async () => {
    const fetch = vi.fn(async () => response({ notRecords: [] }));
    const { instance } = client({ fetch });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result).toMatchObject({ ok: false, error: { code: "teable_invalid_response" } });
  });
});

describe("teable retry policy", () => {
  it("retries a read after 429 and honours Retry-After", async () => {
    const rateLimited = exchange("list-records-429");
    const fetch = vi
      .fn<[string, RequestInit?], Promise<Response>>()
      .mockResolvedValueOnce(
        response(rateLimited.response.body, {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )
      .mockResolvedValueOnce(response(exchange("list-records-ok").response.body));
    const { instance, sleeps } = client({ fetch });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000]);
  });

  it("stops instead of truncating a Retry-After longer than it may block for", async () => {
    // The fixture asks for 42s. Sleeping 2s and returning would ignore what the
    // server asked for; the caller reschedules on retryAfterSeconds instead.
    const rateLimited = exchange("list-records-429");
    const fetch = vi.fn(async () =>
      response(rateLimited.response.body, { status: 429, headers: rateLimited.response.headers }),
    );
    const { instance, sleeps } = client({ fetch });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "teable_rate_limited", retryAfterSeconds: 42, attempts: 1 },
    });
  });

  it("hands a long Retry-After back rather than waiting it out", () => {
    expect(retryDelayMs(1, 1)).toBe(1000);
    expect(retryDelayMs(1, 2)).toBe(2000);
    expect(retryDelayMs(1, 42)).toBeNull();
  });

  it("gives up after maxAttempts and reports how many it made", async () => {
    const fetch = vi.fn(async () => response({ message: "boom", status: 500 }, { status: 500 }));
    const { instance, sleeps } = client({ fetch });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result).toMatchObject({ ok: false, error: { code: "teable_server_error", attempts: 3 } });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
  });

  it("never retries a create, because a duplicate row cannot be undone", async () => {
    const fetch = vi.fn(async () =>
      response({ message: "slow down", status: 429, code: "too_many_requests" }, {
        status: 429,
        headers: { "retry-after": "5" },
      }),
    );
    const { instance, sleeps } = client({ fetch });

    const result = await instance.createRecords({
      companyId: "company-1",
      tableId: "tblSlice1Pilot",
      records: [{ fields: { a: 1 } }],
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "teable_rate_limited", retryable: true, retryAfterSeconds: 5, attempts: 1 },
    });
  });

  it("defaults retryAfterSeconds to the repo-wide 300 when the header is absent", async () => {
    const fetch = vi.fn(async () => response({ status: 503 }, { status: 503 }));
    const { instance } = client({ fetch, config: { maxAttempts: 1 } });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result).toMatchObject({
      ok: false,
      error: { retryAfterSeconds: TEABLE_DEFAULT_RETRY_AFTER_SECONDS },
    });
  });

  it("parses Retry-After in both delta-seconds and HTTP-date form", () => {
    const now = () => Date.parse("2026-09-13T00:00:00Z");
    expect(parseRetryAfterSeconds(response(null, { headers: { "retry-after": "42" } }))).toBe(42);
    expect(
      parseRetryAfterSeconds(
        response(null, { headers: { "retry-after": "Sun, 13 Sep 2026 00:00:30 GMT" } }),
        now,
      ),
    ).toBe(30);
    expect(parseRetryAfterSeconds(response(null, { headers: { "retry-after": "soon" } }))).toBeNull();
    expect(parseRetryAfterSeconds(response(null))).toBeNull();
  });
});

describe("teable record parsing", () => {
  it("requires id and fields and derives modifiedAt from lastModifiedTime", () => {
    const parsed = parseTeableRecord({
      id: "rec1",
      fields: { a: 1 },
      createdTime: "2026-09-01T00:00:00.000Z",
      lastModifiedTime: "2026-09-02T00:00:00.000Z",
    });
    expect(parsed?.modifiedAt?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(parseTeableRecord({ fields: {} })).toBeNull();
    expect(parseTeableRecord({ id: "rec1" })).toBeNull();
  });

  it("falls back to createdTime, then to null, for a row that was never edited", () => {
    expect(
      parseTeableRecord({
        id: "rec1",
        fields: {},
        createdTime: "2026-09-01T00:00:00.000Z",
        lastModifiedTime: null,
      })?.modifiedAt?.toISOString(),
    ).toBe("2026-09-01T00:00:00.000Z");
    expect(parseTeableRecord({ id: "rec1", fields: {} })?.modifiedAt).toBeNull();
  });

  it("reports hasMore against the page size that was actually requested", async () => {
    const body = exchange("list-records-ok").response.body;
    const fetch = vi.fn(async () => response(body));
    const { instance } = client({ fetch });

    const full = await instance.listRecords({ companyId: "c", tableId: "tblSlice1Pilot", take: 2 });
    const partial = await instance.listRecords({ companyId: "c", tableId: "tblSlice1Pilot", take: 50 });

    expect(full.ok && full.data).toMatchObject({ hasMore: true, pageSize: 2 });
    expect(partial.ok && partial.data).toMatchObject({ hasMore: false, pageSize: 50 });
  });

  it("always sends an explicit take, so hasMore never guesses at Teable's own limit", async () => {
    // A caller that omits `take` still has to learn there is a second page.
    // Reporting hasMore:false here would silently hide the rest of the table.
    const fullPage = {
      records: Array.from({ length: TEABLE_DEFAULT_PAGE_SIZE }, (_, index) => ({
        id: `rec${index}`,
        fields: {},
      })),
    };
    const fetch = vi.fn(async () => response(fullPage));
    const { instance } = client({ fetch });

    const result = await instance.listRecords({ companyId: "c", tableId: "tblSlice1Pilot" });

    expect(String(fetch.mock.calls[0]![0])).toContain(`take=${TEABLE_DEFAULT_PAGE_SIZE}`);
    expect(result.ok && result.data).toMatchObject({
      hasMore: true,
      pageSize: TEABLE_DEFAULT_PAGE_SIZE,
    });
  });
});

describe("teable private-network guard", () => {
  it("refuses a private base URL and names the env var that allows it", async () => {
    const fetch = vi.fn(async () => response({}));
    const instance = createTeableClient({} as never, {
      config: { baseUrl: "http://10.0.0.5:3000", allowPrivateNetwork: false },
      tokenProvider: () => TOKEN,
      fetch,
    });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("PAPERCLIP_TEABLE_ALLOW_PRIVATE_NETWORK");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows the self-hosted sibling container when the flag is on, and checks once", async () => {
    const lookup = vi.fn(async () => [{ address: "10.0.0.5", family: 4 }]);
    const fetch = vi.fn(async () => response(exchange("list-records-ok").response.body));
    const instance = createTeableClient({} as never, {
      config: { baseUrl: "http://teable:3000", allowPrivateNetwork: true },
      tokenProvider: () => TOKEN,
      lookup,
      fetch,
    });

    const first = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });
    const second = await instance.listRecords({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

/**
 * The "one recorded integration pinned to a fixture" required by F-010-1.
 *
 * A replay fetch asserts the outgoing request matches the recorded one and then
 * answers with the recorded status, headers and body. When a staging instance
 * exists, re-record the fixture from real responses and leave these assertions
 * alone: anything the documentation got wrong shows up here as a failure.
 */
describe("teable recorded exchanges", () => {
  function replayFetch(name: string) {
    const recorded = exchange(name);
    return vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      expect(init?.method ?? "GET").toBe(recorded.request.method);
      expect(parsed.pathname).toBe(recorded.request.path);
      for (const [key, value] of Object.entries(recorded.request.query)) {
        expect(parsed.searchParams.get(key)).toBe(value);
      }
      return new Response(JSON.stringify(recorded.response.body), {
        status: recorded.response.status,
        headers: recorded.response.headers,
      });
    });
  }

  it("parses the recorded list-records page", async () => {
    const { instance } = client({ fetch: replayFetch("list-records-ok") });

    const result = await instance.listRecords({
      companyId: "company-1",
      tableId: "tblSlice1Pilot",
      take: 2,
      skip: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.records).toHaveLength(2);
    expect(result.data.hasMore).toBe(true);
    expect(result.data.records[0]).toMatchObject({
      id: "recEvidence01",
      name: "WP-1 evidence",
      autoNumber: 17,
      createdBy: "Paperclip Bot",
      lastModifiedBy: "Nguyen Van A",
      lastModifiedTime: "2026-09-12T08:31:44.000Z",
    });
    expect(result.data.records[0]!.fields["Ten cong viec"]).toBe("Lap rap phan co khi");
    expect(result.data.records[0]!.modifiedAt?.toISOString()).toBe("2026-09-12T08:31:44.000Z");
    // The never-edited row still has a comparable timestamp for F-005-1.
    expect(result.data.records[1]!.modifiedAt?.toISOString()).toBe("2026-09-11T01:00:00.000Z");
  });

  it("parses the recorded create-records response", async () => {
    const { instance } = client({ fetch: replayFetch("create-records-ok") });

    const result = await instance.createRecords({
      companyId: "company-1",
      tableId: "tblSlice1Pilot",
      records: [{ fields: { "Ten cong viec": "Tim OEM" } }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: "recEvidence03", createdBy: "Paperclip Bot" });
  });

  it("accepts a bare array create response as well as the enveloped one", async () => {
    const enveloped = exchange("create-records-ok").response.body as { records: unknown[] };
    const fetch = vi.fn(async () => response(enveloped.records, { status: 201 }));
    const { instance } = client({ fetch });

    const result = await instance.createRecords({
      companyId: "company-1",
      tableId: "tblSlice1Pilot",
      records: [{ fields: {} }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.id).toBe("recEvidence03");
  });

  it("maps the recorded 403 restricted_resource without claiming the row is absent", async () => {
    const { instance } = client({ fetch: replayFetch("list-records-403-restricted") });

    const result = await instance.listRecords({ companyId: "company-1", tableId: "tblNotMine" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "teable_forbidden", status: 403, retryable: false },
    });
    if (result.ok) return;
    expect(result.error.message).not.toContain("tblNotMine");
  });

  it("parses the recorded field list", async () => {
    const { instance } = client({ fetch: replayFetch("list-fields-ok") });

    const result = await instance.listFields({ companyId: "company-1", tableId: "tblSlice1Pilot" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      expect.objectContaining({ id: "fldTenCongViec", type: "singleLineText", isPrimary: true }),
      expect.objectContaining({ id: "fldTrangThai", type: "singleSelect", isPrimary: false }),
    ]);
  });

  it("parses the recorded table list", async () => {
    const { instance } = client({ fetch: replayFetch("list-tables-ok") });

    const result = await instance.listTables({ companyId: "company-1", baseId: "bseTecotecCN" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]).toMatchObject({
      id: "tblSlice1Pilot",
      name: "Tecotec CN",
      dbTableName: "tecotec_cn",
      defaultViewId: "viwDefault01",
    });
  });
});
