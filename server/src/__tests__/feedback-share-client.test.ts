import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedbackTraceShareClientFromConfig } from "../services/feedback-share-client.js";

describe("feedback trace share client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ objectKey: "feedback-traces/test.json" }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defaults to telemetry.paperclip.ing when no backend url is configured", async () => {
    const client = createFeedbackTraceShareClientFromConfig({
      feedbackExportBackendUrl: undefined,
      feedbackExportBackendToken: undefined,
    });

    await client.uploadTraceBundle({
      traceId: "trace-1",
      exportId: "export-1",
      companyId: "company-1",
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      adapterType: "codex_local",
      captureStatus: "full",
      notes: [],
      envelope: {},
      surface: null,
      paperclipRun: null,
      rawAdapterTrace: null,
      normalizedAdapterTrace: null,
      privacy: null,
      integrity: {},
      files: [],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://telemetry.paperclip.ing/feedback-traces",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("wraps the feedback trace payload as gzip+base64 json before upload", async () => {
    const client = createFeedbackTraceShareClientFromConfig({
      feedbackExportBackendUrl: "https://telemetry.paperclip.ing",
      feedbackExportBackendToken: "test-token",
    });

    await client.uploadTraceBundle({
      traceId: "trace-1",
      exportId: "export-1",
      companyId: "company-1",
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      adapterType: "codex_local",
      captureStatus: "full",
      notes: [],
      envelope: { hello: "world" },
      surface: null,
      paperclipRun: null,
      rawAdapterTrace: null,
      normalizedAdapterTrace: null,
      privacy: null,
      integrity: {},
      files: [],
    });

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toBe("https://telemetry.paperclip.ing/feedback-traces");
    expect(call?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
    });

    const body = JSON.parse(String(call?.[1]?.body ?? "{}")) as {
      encoding?: string;
      payload?: string;
    };
    expect(body.encoding).toBe("gzip+base64+json");
    expect(typeof body.payload).toBe("string");

    const decoded = gunzipSync(Buffer.from(body.payload ?? "", "base64")).toString("utf8");
    const parsed = JSON.parse(decoded) as {
      objectKey: string;
      bundle: { envelope: { hello: string } };
    };
    expect(parsed.objectKey).toContain("feedback-traces/company-1/");
    expect(parsed.objectKey.endsWith("/export-1.json")).toBe(true);
    expect(parsed.bundle.envelope).toEqual({ hello: "world" });
  });

  const minimalBundle = {
    traceId: "trace-1",
    exportId: "export-1",
    companyId: "company-1",
    issueId: "issue-1",
    issueIdentifier: "PAP-1",
    adapterType: "codex_local",
    captureStatus: "full",
    notes: [],
    envelope: {},
    surface: null,
    paperclipRun: null,
    rawAdapterTrace: null,
    normalizedAdapterTrace: null,
    privacy: null,
    integrity: {},
    files: [],
  } as unknown as Parameters<ReturnType<typeof createFeedbackTraceShareClientFromConfig>["uploadTraceBundle"]>[0];

  it("posts to a configured backend url and omits authorization when no token is set", async () => {
    const client = createFeedbackTraceShareClientFromConfig({
      feedbackExportBackendUrl: "https://feedback.example.test/base",
      feedbackExportBackendToken: undefined,
    });

    await client.uploadTraceBundle(minimalBundle);

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toBe("https://feedback.example.test/feedback-traces");
    expect((call?.[1]?.headers as Record<string, string>)).not.toHaveProperty("authorization");
  });

  it("rejects with the response detail, or the HTTP status when there is none, on a failed upload", async () => {
    const client = createFeedbackTraceShareClientFromConfig({
      feedbackExportBackendUrl: "https://feedback.example.test",
      feedbackExportBackendToken: undefined,
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 413,
      text: vi.fn().mockResolvedValue("payload too large\n"),
    } as unknown as Response);
    await expect(client.uploadTraceBundle(minimalBundle)).rejects.toThrow("payload too large");

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue("   "),
    } as unknown as Response);
    await expect(client.uploadTraceBundle(minimalBundle)).rejects.toThrow("HTTP 502");
  });

  it("falls back to the locally computed object key when the backend response omits one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response);
    const client = createFeedbackTraceShareClientFromConfig({
      feedbackExportBackendUrl: "https://feedback.example.test",
      feedbackExportBackendToken: "tok",
    });

    const result = await client.uploadTraceBundle(minimalBundle);

    expect(result.objectKey).toMatch(/^feedback-traces\/company-1\/\d{4}\/\d{2}\/\d{2}\/export-1\.json$/);
  });
});
