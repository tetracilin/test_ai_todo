import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import { TEABLE_WRITE_TABLE_SECRET_NAME } from "../services/teable-append.js";
import { teableReadService } from "../services/teable-read.js";
import type { TeableClient, TeableRecordPage, TeableSecretsDeps } from "../services/teable-client.js";

/**
 * F-010-3. Every case here runs WITHOUT Postgres, mirroring teable-append.test.ts: the service
 * takes an injected fake `client` and a fake `secrets` dep, so `db` is never touched. Do not add
 * a `getEmbeddedPostgresTestSupport()` gate to this file.
 *
 * No test contacts a live Teable instance -- the fake `client` never issues HTTP at all.
 */

const COMPANY_ID = "company-1";
const ALLOWLISTED_TABLE_ID = "tblSlice1Pilot";

function fakeSecrets(values: Record<string, string | undefined>): TeableSecretsDeps {
  return {
    getByName: async (_companyId, name) => (values[name] !== undefined ? { id: `secret-${name}` } : null),
    resolveSecretValue: async (_companyId, secretId) => {
      const name = secretId.replace(/^secret-/, "");
      return values[name] ?? "";
    },
  };
}

function fakePage(overrides: Partial<TeableRecordPage> = {}): TeableRecordPage {
  return {
    records: [
      {
        id: "recEvidence01",
        name: "WP-1 evidence",
        fields: { "Ten cong viec": "Lap rap phan co khi" },
        autoNumber: 17,
        createdTime: "2026-09-11T01:00:00.000Z",
        lastModifiedTime: "2026-09-12T08:31:44.000Z",
        createdBy: "Paperclip Bot",
        lastModifiedBy: "Nguyen Van A",
        modifiedAt: new Date("2026-09-12T08:31:44.000Z"),
      },
    ],
    hasMore: false,
    pageSize: 100,
    ...overrides,
  };
}

function fakeClient(listRecordsImpl: TeableClient["listRecords"]): TeableClient {
  return {
    listRecords: vi.fn(listRecordsImpl),
    getRecord: vi.fn(),
    createRecords: vi.fn(),
    listFields: vi.fn(),
    listTables: vi.fn(),
  } as unknown as TeableClient;
}

function service(opts: { client: TeableClient; secrets?: TeableSecretsDeps; env?: NodeJS.ProcessEnv }) {
  return teableReadService({} as never, {
    client: opts.client,
    secrets: opts.secrets ?? fakeSecrets({ [TEABLE_WRITE_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID }),
    env: opts.env ?? {},
  });
}

describe("teableReadService allowlist (AC5, reusing F-010-1/2's allowlist)", () => {
  it("refuses a query against a non-allowlisted table with an actionable message, and calls Teable zero times", async () => {
    const listRecords = vi.fn();
    const client = fakeClient(listRecords);
    const svc = service({ client });

    await expect(
      svc.queryRows({ companyId: COMPANY_ID, tableId: "tblSomeOtherTable" }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("tblSomeOtherTable"),
    });
    await expect(
      svc.queryRows({ companyId: COMPANY_ID, tableId: "tblSomeOtherTable" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(ALLOWLISTED_TABLE_ID),
    });
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("refuses with a distinct message when no allowlist secret is configured at all", async () => {
    const listRecords = vi.fn();
    const client = fakeClient(listRecords);
    const svc = service({ client, secrets: fakeSecrets({}) });

    await expect(
      svc.queryRows({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining(TEABLE_WRITE_TABLE_SECRET_NAME),
    });
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("never grants write scope -- the client's createRecords is never referenced by this service", async () => {
    const createRecords = vi.fn();
    const client = {
      listRecords: vi.fn(async () => ({ ok: true as const, data: fakePage() })),
      getRecord: vi.fn(),
      createRecords,
      listFields: vi.fn(),
      listTables: vi.fn(),
    } as unknown as TeableClient;
    const svc = service({ client });

    await svc.queryRows({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID });
    expect(createRecords).not.toHaveBeenCalled();
  });
});

describe("teableReadService happy path (AC5)", () => {
  it("queries the allowlisted table and returns the page as-is", async () => {
    const listRecords = vi.fn(async () => ({ ok: true as const, data: fakePage() }));
    const client = fakeClient(listRecords);
    const svc = service({ client });

    const page = await svc.queryRows({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID });

    expect(listRecords).toHaveBeenCalledTimes(1);
    expect(listRecords).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID }),
    );
    expect(page.records).toHaveLength(1);
    expect(page.records[0]!.fields["Ten cong viec"]).toBe("Lap rap phan co khi");
  });

  it("forwards search, take and skip to the client", async () => {
    const listRecords = vi.fn(async () => ({ ok: true as const, data: fakePage() }));
    const client = fakeClient(listRecords);
    const svc = service({ client });

    await svc.queryRows({
      companyId: COMPANY_ID,
      tableId: ALLOWLISTED_TABLE_ID,
      search: "Tim OEM",
      take: 5,
      skip: 10,
    });

    expect(listRecords).toHaveBeenCalledWith(
      expect.objectContaining({ search: "Tim OEM", take: 5, skip: 10 }),
    );
  });
});

describe("teableReadService upstream failure mapping (shared with F-010-2)", () => {
  it("maps a not-found result to an HttpError, same mapping as the write path", async () => {
    const listRecords = vi.fn(async () => ({
      ok: false as const,
      error: { code: "teable_not_found" as const, retryable: false, status: 404, message: "Teable has no such resource.", attempts: 1 },
    }));
    const svc = service({ client: fakeClient(listRecords) });

    const err = await svc
      .queryRows({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID })
      .catch((e) => e as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(502);
    expect(err.message).toBe("Teable has no such resource.");
  });

  it("maps a rate-limited result to 503 with retryAfterSeconds in details", async () => {
    const listRecords = vi.fn(async () => ({
      ok: false as const,
      error: { code: "teable_rate_limited" as const, retryable: true, status: 429, message: "Teable is rate limiting this integration.", retryAfterSeconds: 20, attempts: 1 },
    }));
    const svc = service({ client: fakeClient(listRecords) });

    const err = await svc
      .queryRows({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID })
      .catch((e) => e as HttpError);
    expect(err.status).toBe(503);
    expect((err.details as { retryAfterSeconds: number }).retryAfterSeconds).toBe(20);
  });

  it("maps the not-configured code (e.g. no read token) to 422", async () => {
    const listRecords = vi.fn(async () => ({
      ok: false as const,
      error: { code: "teable_not_configured" as const, retryable: false, status: null, message: "Teable is not configured for this company.", attempts: 0 },
    }));
    const svc = service({ client: fakeClient(listRecords) });

    const err = await svc
      .queryRows({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID })
      .catch((e) => e as HttpError);
    expect(err.status).toBe(422);
  });
});
