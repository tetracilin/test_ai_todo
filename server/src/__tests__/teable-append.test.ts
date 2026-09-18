import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import {
  TEABLE_BOT_ACCOUNT_SECRET_NAME,
  TEABLE_WRITE_TABLE_SECRET_NAME,
  isPaperclipBotAuthored,
  teableAppendService,
} from "../services/teable-append.js";
import type { TeableClient, TeableRecord, TeableSecretsDeps } from "../services/teable-client.js";

/**
 * F-010-2. Every case here runs WITHOUT Postgres, mirroring teable-client.test.ts: the service
 * takes an injected fake `client` and a fake `secrets` dep, so `db` is never touched. Do not add
 * a `getEmbeddedPostgresTestSupport()` gate to this file.
 *
 * No test contacts a live Teable instance -- the fake `client` never issues HTTP at all.
 */

const COMPANY_ID = "company-1";
const ALLOWLISTED_TABLE_ID = "tblSlice1Pilot";
const BOT_ACCOUNT_NAME = "Paperclip Bot";

function fakeSecrets(values: Record<string, string | undefined>): TeableSecretsDeps {
  return {
    getByName: async (_companyId, name) => (values[name] !== undefined ? { id: `secret-${name}` } : null),
    resolveSecretValue: async (_companyId, secretId) => {
      const name = secretId.replace(/^secret-/, "");
      return values[name] ?? "";
    },
  };
}

/** The exact shape `teable-client.test.ts`'s own `create-records-ok` fixture returns. */
function botRecord(overrides: Partial<TeableRecord> = {}): TeableRecord {
  return {
    id: "recEvidence03",
    name: "OEM row",
    fields: { "Ten cong viec": "Tim OEM", "Trang thai": "todo" },
    autoNumber: 19,
    createdTime: "2026-09-13T09:05:00.000Z",
    lastModifiedTime: null,
    createdBy: BOT_ACCOUNT_NAME,
    lastModifiedBy: null,
    modifiedAt: new Date("2026-09-13T09:05:00.000Z"),
    ...overrides,
  };
}

function fakeClient(createRecordsImpl: TeableClient["createRecords"]): TeableClient {
  return {
    listRecords: vi.fn(),
    getRecord: vi.fn(),
    createRecords: vi.fn(createRecordsImpl),
    listFields: vi.fn(),
    listTables: vi.fn(),
  } as unknown as TeableClient;
}

function service(opts: { client: TeableClient; secrets?: TeableSecretsDeps; env?: NodeJS.ProcessEnv }) {
  return teableAppendService({} as never, {
    client: opts.client,
    secrets: opts.secrets ?? fakeSecrets({ [TEABLE_WRITE_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID }),
    env: opts.env ?? {},
  });
}

describe("isPaperclipBotAuthored", () => {
  it("is true when createdBy matches the configured bot account", () => {
    expect(isPaperclipBotAuthored({ createdBy: BOT_ACCOUNT_NAME, lastModifiedBy: null }, BOT_ACCOUNT_NAME)).toBe(true);
  });

  it("is true when only lastModifiedBy matches", () => {
    expect(isPaperclipBotAuthored({ createdBy: "Someone Else", lastModifiedBy: BOT_ACCOUNT_NAME }, BOT_ACCOUNT_NAME)).toBe(true);
  });

  it("is false when neither matches", () => {
    expect(isPaperclipBotAuthored({ createdBy: "Someone Else", lastModifiedBy: null }, BOT_ACCOUNT_NAME)).toBe(false);
  });

  it("is false when no bot account name is configured, even if createdBy is set", () => {
    expect(isPaperclipBotAuthored({ createdBy: BOT_ACCOUNT_NAME, lastModifiedBy: null }, null)).toBe(false);
  });
});

describe("teableAppendService allowlist (AC1)", () => {
  it("refuses a write to a non-allowlisted table with an actionable message, and calls Teable zero times", async () => {
    const createRecords = vi.fn();
    const client = fakeClient(createRecords);
    const svc = service({ client });

    await expect(
      svc.appendRow({ companyId: COMPANY_ID, tableId: "tblSomeOtherTable", fields: { a: 1 } }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("tblSomeOtherTable"),
    });
    await expect(
      svc.appendRow({ companyId: COMPANY_ID, tableId: "tblSomeOtherTable", fields: { a: 1 } }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(ALLOWLISTED_TABLE_ID),
    });
    expect(createRecords).not.toHaveBeenCalled();
  });

  it("refuses with a distinct message when no allowlist secret is configured at all", async () => {
    const createRecords = vi.fn();
    const client = fakeClient(createRecords);
    const svc = service({ client, secrets: fakeSecrets({}) });

    await expect(
      svc.appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: { a: 1 } }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining(TEABLE_WRITE_TABLE_SECRET_NAME),
    });
    expect(createRecords).not.toHaveBeenCalled();
  });
});

describe("teableAppendService happy path (AC4)", () => {
  it("creates a row in the allowlisted table and returns a teable NewObjectTarget", async () => {
    const createRecords = vi.fn(async () => ({ ok: true as const, data: [botRecord()] }));
    const client = fakeClient(createRecords);
    const svc = service({ client });

    const { record, target } = await svc.appendRow({
      companyId: COMPANY_ID,
      tableId: ALLOWLISTED_TABLE_ID,
      fields: { "Ten cong viec": "Tim OEM" },
    });

    expect(createRecords).toHaveBeenCalledTimes(1);
    expect(createRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        tableId: ALLOWLISTED_TABLE_ID,
        records: [{ fields: { "Ten cong viec": "Tim OEM" } }],
      }),
    );
    expect(record.id).toBe("recEvidence03");
    expect(target).toEqual({
      providerKey: "teable",
      objectType: "record",
      externalId: `${ALLOWLISTED_TABLE_ID}/recEvidence03`,
      displayTitle: "OEM row",
      url: null,
      data: {
        tableId: ALLOWLISTED_TABLE_ID,
        recordId: "recEvidence03",
        createdBy: BOT_ACCOUNT_NAME,
        createdTime: "2026-09-13T09:05:00.000Z",
      },
    });
  });

  it("falls back to the table-qualified id as displayTitle when the row has no name", async () => {
    const createRecords = vi.fn(async () => ({ ok: true as const, data: [botRecord({ name: null })] }));
    const svc = service({ client: fakeClient(createRecords) });

    const { target } = await svc.appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} });
    expect(target.displayTitle).toBe(`${ALLOWLISTED_TABLE_ID}/recEvidence03`);
  });

  it("builds a public row URL only when PAPERCLIP_TEABLE_PUBLIC_URL is configured", async () => {
    const createRecords = vi.fn(async () => ({ ok: true as const, data: [botRecord()] }));
    const svc = service({
      client: fakeClient(createRecords),
      env: { PAPERCLIP_TEABLE_PUBLIC_URL: "https://teable.paperclip.local/" },
    });

    const { target } = await svc.appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} });
    expect(target.url).toBe(`https://teable.paperclip.local/table/${ALLOWLISTED_TABLE_ID}/recEvidence03`);
  });
});

describe("teableAppendService upstream failure mapping", () => {
  it("refuses the whole write on a rate-limited response, without creating a link target", async () => {
    const createRecords = vi.fn(async () => ({
      ok: false as const,
      error: { code: "teable_rate_limited" as const, retryable: true, status: 429, message: "Too many requests to Teable.", retryAfterSeconds: 30, attempts: 1 },
    }));
    const svc = service({ client: fakeClient(createRecords) });

    const err = await svc
      .appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} })
      .catch((e) => e as HttpError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    expect((err.details as { retryAfterSeconds: number }).retryAfterSeconds).toBe(30);
  });

  it("maps an auth failure to 502 and forwards the safe message verbatim", async () => {
    const createRecords = vi.fn(async () => ({
      ok: false as const,
      error: { code: "teable_forbidden" as const, retryable: false, status: 403, message: "Teable rejected this request.", attempts: 1 },
    }));
    const svc = service({ client: fakeClient(createRecords) });

    const err = await svc
      .appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} })
      .catch((e) => e as HttpError);
    expect(err.status).toBe(502);
    expect(err.message).toBe("Teable rejected this request.");
  });

  it("maps the not-configured code (e.g. no write token) to 422", async () => {
    const createRecords = vi.fn(async () => ({
      ok: false as const,
      error: { code: "teable_not_configured" as const, retryable: false, status: null, message: "Teable is not configured for this company.", attempts: 0 },
    }));
    const svc = service({ client: fakeClient(createRecords) });

    const err = await svc
      .appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} })
      .catch((e) => e as HttpError);
    expect(err.status).toBe(422);
  });

  it("never retries a failed create -- the client is called exactly once even on failure", async () => {
    const createRecords = vi.fn(async () => ({
      ok: false as const,
      error: { code: "teable_unreachable" as const, retryable: true, status: null, message: "Teable did not respond.", attempts: 1 },
    }));
    const svc = service({ client: fakeClient(createRecords) });

    await svc.appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} }).catch(() => {});
    expect(createRecords).toHaveBeenCalledTimes(1);
  });
});

describe("teableAppendService bot attribution (AC6)", () => {
  it("does not warn when the row's createdBy matches the configured bot account", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const createRecords = vi.fn(async () => ({ ok: true as const, data: [botRecord({ createdBy: BOT_ACCOUNT_NAME })] }));
    const svc = service({
      client: fakeClient(createRecords),
      secrets: fakeSecrets({
        [TEABLE_WRITE_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID,
        [TEABLE_BOT_ACCOUNT_SECRET_NAME]: BOT_ACCOUNT_NAME,
      }),
    });

    await expect(
      svc.appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} }),
    ).resolves.toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("logs a warning but still succeeds when createdBy does not match the configured bot account", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const createRecords = vi.fn(async () => ({ ok: true as const, data: [botRecord({ createdBy: "A Human Editor" })] }));
    const svc = service({
      client: fakeClient(createRecords),
      secrets: fakeSecrets({
        [TEABLE_WRITE_TABLE_SECRET_NAME]: ALLOWLISTED_TABLE_ID,
        [TEABLE_BOT_ACCOUNT_SECRET_NAME]: BOT_ACCOUNT_NAME,
      }),
    });

    const { record } = await svc.appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} });
    expect(record.createdBy).toBe("A Human Editor");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("logs a warning when no bot account secret is configured at all", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const createRecords = vi.fn(async () => ({ ok: true as const, data: [botRecord()] }));
    const svc = service({ client: fakeClient(createRecords) }); // no TEABLE_BOT_ACCOUNT_NAME configured

    await svc.appendRow({ companyId: COMPANY_ID, tableId: ALLOWLISTED_TABLE_ID, fields: {} });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
