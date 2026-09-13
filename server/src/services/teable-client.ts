import type { Db } from "@paperclipai/db";
import { badRequest, unprocessable, type HttpError } from "../errors.js";
import {
  assertPublicRemoteHttpEndpoint,
  parseRemoteHttpEndpoint,
  type RemoteHttpEndpointLookup,
} from "./remote-http-endpoint-guard.js";
import { secretService } from "./secrets.js";

/**
 * Teable REST client (F-010-1, story PC-010).
 *
 * A SHARED service module, deliberately not inlined into agent code: F-010-2
 * (append-only agent write), F-010-3 (chat read verb), F-005-1 (card -> Teable
 * mirror cron) and PC-203 in Slice 2 all consume this one client.
 *
 * Deployment note: production Teable is a SELF-HOSTED container on the same host
 * as Paperclip, not Teable Cloud. The default base URL is therefore a private
 * origin, and the private-network guard below is expected to be enabled in
 * normal operation rather than being an exception.
 *
 * The API surface implemented here is derived from the published Teable
 * documentation (help.teable.ai), NOT from calls against a live instance. Every
 * assumption that could not be confirmed from the docs is marked INFERRED. Once
 * a staging instance exists, pull its own `/swagger.json`, diff it against this
 * file, and re-record `__tests__/fixtures/teable-api-exchanges.json`.
 *
 * What this module does NOT do, on purpose:
 * - no `external_objects` row, no evidence link, no dossier line (F-010-2)
 * - no table allowlist and no write-conflict policy (F-010-2 / Slice 2)
 * - no cron, no activity_log, no conflict flagging (F-005-1); this client only
 *   exposes `modifiedAt` so F-005-1 has something to compare
 * - no update/delete of any kind: Slice 1 is append-only
 *
 * How callers are expected to handle a failure result:
 * - F-005-1  -> log to activity_log and reschedule at `now + retryAfterSeconds`.
 *               Never sleep inside a cron tick.
 * - F-010-2  -> refuse the whole write; create no row and append no dossier line.
 * - F-010-3  -> render `error.message` into the chat reply as-is; it is written
 *               to be safe to show a user and never carries a token or row data.
 */

export type TeableFetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Company-secret names probed for a Teable token, in priority order. */
export const DEFAULT_TEABLE_TOKEN_SECRET_NAMES = [
  "TEABLE_API_TOKEN",
  "PAPERCLIP_TEABLE_TOKEN",
] as const;

/**
 * Reads prefer a token whose own Teable scopes exclude writes. F-010-3's
 * "read scope grants no write" is only a real boundary if the token itself is
 * read-only -- app-level gating is not a boundary -- so the purpose is threaded
 * through now, while it is free, rather than retrofitted once F-010-2 and
 * F-010-3 both ship.
 */
export const DEFAULT_TEABLE_READ_TOKEN_SECRET_NAMES = [
  "TEABLE_READ_TOKEN",
  ...DEFAULT_TEABLE_TOKEN_SECRET_NAMES,
] as const;

/**
 * Same default as `external-objects.ts` DEFAULT_RETRY_AFTER_SECONDS, so a
 * scheduler consuming this client can reuse its existing backoff arithmetic.
 */
export const TEABLE_DEFAULT_RETRY_AFTER_SECONDS = 300;

/** Compose service name of the self-hosted Teable container on the app host. */
export const TEABLE_DEFAULT_BASE_URL = "http://teable:3000";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 2_000;
const BASE_RETRY_DELAY_MS = 250;

/** Teable ids (`tbl...`, `rec...`, `bse...`) are opaque; only their shape is checked. */
const TEABLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type TeableFieldKeyType = "name" | "id" | "dbFieldName";
export type TeableTokenPurpose = "read" | "write";

export type TeableClientConfig = {
  baseUrl: string;
  allowPrivateNetwork: boolean;
  requestTimeoutMs: number;
  /** Applies to idempotent reads only; writes are never auto-retried. */
  maxAttempts: number;
  userAgent: string;
};

/**
 * Structural subset of `secretService`, copied from `git-credentials.ts`, so a
 * test can inject a fake and never needs a database.
 */
export type TeableSecretsDeps = {
  getByName: (
    companyId: string,
    name: string,
  ) => Promise<{ id: string } | null | undefined>;
  resolveSecretValue: (
    companyId: string,
    secretId: string,
    version: number | "latest",
    contextOrOptions?: unknown,
  ) => Promise<string>;
};

export type TeableClientOptions = {
  config?: Partial<TeableClientConfig>;
  fetch?: TeableFetchLike;
  secrets?: TeableSecretsDeps;
  /**
   * Short-circuits secret resolution entirely. An explicit `null` means "this
   * client has no token" -- distinguished from "not supplied" by a property
   * check, matching `github-external-object-provider.ts`.
   */
  tokenProvider?:
    | ((companyId: string, purpose: TeableTokenPurpose) => Promise<string | null> | string | null)
    | null;
  secretNames?: { read?: readonly string[]; write?: readonly string[] };
  env?: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
  lookup?: RemoteHttpEndpointLookup;
  accessContext?: {
    issueId?: string | null;
    heartbeatRunId?: string | null;
    responsibleUserId?: string | null;
  };
};

export type TeableErrorCode =
  /** No base URL, no reachable endpoint, or no Teable token for this company. */
  | "teable_not_configured"
  /** 401. The token is missing, expired or rejected. Not retryable. */
  | "teable_auth_required"
  /**
   * 403. Teable uses this for BOTH a missing token scope and an id the token
   * cannot see, so it is never narrowed to "not found" on a guess.
   */
  | "teable_forbidden"
  /** 404 -- route or resource absent. */
  | "teable_not_found"
  /** 400 -- malformed body or parameters. Retrying cannot help. */
  | "teable_invalid_request"
  /**
   * 429. Registry row `TeableRateLimited` (retryable). INFERRED: Teable's
   * published error-code page documents 400/401/403/404/500/503 only, so both
   * the status and any `Retry-After` header are handled defensively.
   */
  | "teable_rate_limited"
  /** 5xx, including the documented 503 processing-timeout case. */
  | "teable_server_error"
  /** Transport failure or timeout -- no HTTP status was ever received. */
  | "teable_unreachable"
  /** 2xx whose body did not parse, or did not carry the documented shape. */
  | "teable_invalid_response";

export type TeableError = {
  code: TeableErrorCode;
  retryable: boolean;
  status: number | null;
  /** Safe to show a user: never a token, never the remote body (it holds row data). */
  message: string;
  retryAfterSeconds?: number;
  /** How many HTTP attempts were actually made (1 when nothing was retried). */
  attempts: number;
};

export type TeableResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: TeableError };

export type TeableRecord = {
  id: string;
  name: string | null;
  fields: Record<string, unknown>;
  autoNumber: number | null;
  createdTime: string | null;
  lastModifiedTime: string | null;
  /** Documented as a user NAME, not an id. F-010-2 cross-checks bot attribution on it. */
  createdBy: string | null;
  lastModifiedBy: string | null;
  /**
   * Derived: `lastModifiedTime ?? createdTime`, parsed. F-005-1 compares this
   * one value and never has to special-case a row that was never edited.
   */
  modifiedAt: Date | null;
};

export type TeableRecordPage = {
  records: TeableRecord[];
  /**
   * The list endpoint returns no total, so "there may be more" is inferred from
   * a full page. Only meaningful when `take` was supplied.
   */
  hasMore: boolean;
};

export type TeableField = {
  id: string;
  name: string;
  type: string;
  dbFieldName: string | null;
  isPrimary: boolean;
  options: unknown;
};

export type TeableTable = {
  id: string;
  name: string;
  dbTableName: string | null;
  description: string | null;
  lastModifiedTime: string | null;
  defaultViewId: string | null;
};

export interface TeableClient {
  listRecords(input: {
    companyId: string;
    tableId: string;
    take?: number;
    skip?: number;
    viewId?: string;
    fieldKeyType?: TeableFieldKeyType;
    projection?: string[];
    orderBy?: string;
    search?: string;
  }): Promise<TeableResult<TeableRecordPage>>;

  getRecord(input: {
    companyId: string;
    tableId: string;
    recordId: string;
    fieldKeyType?: TeableFieldKeyType;
  }): Promise<TeableResult<TeableRecord>>;

  createRecords(input: {
    companyId: string;
    tableId: string;
    records: Array<{ fields: Record<string, unknown> }>;
    fieldKeyType?: TeableFieldKeyType;
    typecast?: boolean;
  }): Promise<TeableResult<TeableRecord[]>>;

  listFields(input: { companyId: string; tableId: string }): Promise<TeableResult<TeableField[]>>;

  listTables(input: { companyId: string; baseId: string }): Promise<TeableResult<TeableTable[]>>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function parseBooleanEnv(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  if (value === "") return null;
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return null;
}

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

/**
 * Env is read here rather than in `server/src/config.ts` so Lane B touches no
 * file Lane A or Lane C also touches -- the reason those lanes parallelize at
 * all. `git-credentials.ts` sets the `deps.env ?? process.env` precedent.
 */
export function resolveTeableConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TeableClientConfig {
  const baseUrl = env.PAPERCLIP_TEABLE_BASE_URL?.trim() || TEABLE_DEFAULT_BASE_URL;
  const explicitPrivate = parseBooleanEnv(env.PAPERCLIP_TEABLE_ALLOW_PRIVATE_NETWORK);
  return {
    baseUrl,
    // Defaulted on only for the built-in local default, so a stock deployment
    // against the sibling container works without configuration while any
    // OTHER host still has to opt in explicitly.
    allowPrivateNetwork: explicitPrivate ?? baseUrl === TEABLE_DEFAULT_BASE_URL,
    requestTimeoutMs: parsePositiveIntEnv(
      env.PAPERCLIP_TEABLE_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    maxAttempts: parsePositiveIntEnv(env.PAPERCLIP_TEABLE_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
    userAgent: "paperclip-teable-client",
  };
}

/**
 * The shared guard's own messages name MCP, which would be misleading here, so
 * only its error CODE is kept and the sentence is rewritten for Teable.
 */
function teableEndpointError(_message: string, code: string): HttpError {
  switch (code) {
    case "remote_http_private_endpoint":
      return unprocessable(
        "PAPERCLIP_TEABLE_BASE_URL points at a private or reserved network address. " +
          "Set PAPERCLIP_TEABLE_ALLOW_PRIVATE_NETWORK=1 when Teable is self-hosted on this host.",
        { code },
      );
    case "remote_http_dns_failed":
      return unprocessable("PAPERCLIP_TEABLE_BASE_URL hostname could not be resolved.", { code });
    default:
      return badRequest("PAPERCLIP_TEABLE_BASE_URL must be a valid http or https URL.", { code });
  }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

export type TeableErrorEnvelope = {
  message: string | null;
  status: number | null;
  code: string | null;
};

/**
 * Teable documents a uniform error body `{ message, status, code }`. Only
 * `code` and `status` are used for classification; `message` is parsed but
 * never forwarded, because a remote message can quote row content.
 */
export function parseTeableErrorEnvelope(body: unknown): TeableErrorEnvelope {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { message: null, status: null, code: null };
  }
  const record = body as Record<string, unknown>;
  return {
    message: typeof record.message === "string" ? record.message : null,
    status: typeof record.status === "number" ? record.status : null,
    code: typeof record.code === "string" ? record.code : null,
  };
}

const RETRYABLE_CODES = new Set<TeableErrorCode>([
  "teable_rate_limited",
  "teable_server_error",
  "teable_unreachable",
]);

function messageForCode(code: TeableErrorCode, status: number | null): string {
  switch (code) {
    case "teable_not_configured":
      return "Teable is not configured for this company. Add a TEABLE_API_TOKEN company secret.";
    case "teable_auth_required":
      return "Teable rejected the configured credentials.";
    case "teable_forbidden":
      return "The Teable token is not permitted to access this resource. It may be missing a scope, or the id may belong to another base.";
    case "teable_not_found":
      return "Teable has no such resource.";
    case "teable_invalid_request":
      return "Teable rejected the request as malformed.";
    case "teable_rate_limited":
      return "Teable is rate limiting this integration.";
    case "teable_server_error":
      return `Teable returned HTTP ${status ?? 500}.`;
    case "teable_unreachable":
      return "Teable could not be reached.";
    case "teable_invalid_response":
      return "Teable returned a response this client could not parse.";
  }
}

export function teableError(
  code: TeableErrorCode,
  options: { status?: number | null; attempts?: number; retryAfterSeconds?: number; message?: string } = {},
): TeableError {
  const status = options.status ?? null;
  const retryable = RETRYABLE_CODES.has(code);
  return {
    code,
    retryable,
    status,
    message: options.message ?? messageForCode(code, status),
    ...(retryable
      ? { retryAfterSeconds: options.retryAfterSeconds ?? TEABLE_DEFAULT_RETRY_AFTER_SECONDS }
      : {}),
    attempts: options.attempts ?? 1,
  };
}

/**
 * `Retry-After` is defined as either delta-seconds or an HTTP-date; both are
 * accepted. (`github-external-object-provider.ts` handles only the digit form.)
 */
export function parseRetryAfterSeconds(response: Response, now: () => number = Date.now): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return Math.max(1, Math.ceil((asDate - now()) / 1000));
}

/**
 * `code` first, status second: Teable reuses 403 for both a missing token scope
 * and an id the token cannot see, so status alone cannot separate them, and an
 * unrecognised code must never be narrowed to "not found" on a guess.
 */
export function classifyTeableStatus(status: number, envelope: TeableErrorEnvelope): TeableErrorCode {
  switch (envelope.code) {
    case "restricted_resource":
      return "teable_forbidden";
    case "unauthorized":
      return "teable_auth_required";
    case "not_found":
      return "teable_not_found";
    default:
      break;
  }
  if (status === 401) return "teable_auth_required";
  if (status === 403) return "teable_forbidden";
  if (status === 404) return "teable_not_found";
  if (status === 429) return "teable_rate_limited";
  if (status >= 500) return "teable_server_error";
  return "teable_invalid_request";
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** Documented required fields are `id` and `fields`; everything else is optional. */
export function parseTeableRecord(value: unknown): TeableRecord | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = asString(raw.id);
  const fields = asRecord(raw.fields);
  if (!id || !fields) return null;
  const createdTime = asString(raw.createdTime);
  const lastModifiedTime = asString(raw.lastModifiedTime);
  return {
    id,
    name: asString(raw.name),
    fields,
    autoNumber: asNumber(raw.autoNumber),
    createdTime,
    lastModifiedTime,
    createdBy: asString(raw.createdBy),
    lastModifiedBy: asString(raw.lastModifiedBy),
    modifiedAt: parseIsoDate(lastModifiedTime ?? createdTime),
  };
}

export function parseTeableField(value: unknown): TeableField | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  const type = asString(raw.type);
  if (!id || !name || !type) return null;
  return {
    id,
    name,
    type,
    dbFieldName: asString(raw.dbFieldName),
    isPrimary: raw.isPrimary === true,
    options: raw.options ?? null,
  };
}

export function parseTeableTable(value: unknown): TeableTable | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    dbTableName: asString(raw.dbTableName),
    description: asString(raw.description),
    lastModifiedTime: asString(raw.lastModifiedTime),
    defaultViewId: asString(raw.defaultViewId),
  };
}

function parseArrayOf<T>(value: unknown, parse: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.some((entry) => entry === null) ? null : (parsed as T[]);
}

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

/**
 * Joins relative to the base URL's own path, so a reverse-proxied instance at
 * `https://host/teable` keeps its prefix. Every documented path starts `/api`.
 */
export function buildTeableUrl(
  baseUrl: string,
  path: string,
  query: Record<string, string | number | string[] | undefined> = {},
): string {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(`api${path}`, root);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(key, entry);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function assertTeableId(kind: string, value: string): void {
  if (!TEABLE_ID_PATTERN.test(value)) {
    throw badRequest(`Invalid Teable ${kind}.`);
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

function retryDelayMs(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) return Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS);
  const ceiling = Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

export function createTeableClient(db: Db, opts: TeableClientOptions = {}): TeableClient {
  const config: TeableClientConfig = {
    ...resolveTeableConfigFromEnv(opts.env ?? process.env),
    ...(opts.config ?? {}),
  };
  const doFetch = opts.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sleep = opts.sleep ?? defaultSleep;

  // Fail loudly at construction: a bad base URL is a deployment bug, not a
  // runtime condition, and keeping it out of the per-request result union keeps
  // that union about what Teable actually answered.
  const endpoint = parseRemoteHttpEndpoint(config.baseUrl, teableEndpointError);

  const hasExplicitTokenProvider = Object.prototype.hasOwnProperty.call(opts, "tokenProvider");
  const secrets: TeableSecretsDeps =
    opts.secrets ?? (secretService(db) as unknown as TeableSecretsDeps);
  const readNames = opts.secretNames?.read ?? DEFAULT_TEABLE_READ_TOKEN_SECRET_NAMES;
  const writeNames = opts.secretNames?.write ?? DEFAULT_TEABLE_TOKEN_SECRET_NAMES;

  let guardPromise: Promise<void> | null = null;
  const assertEndpointOnce = () => {
    guardPromise ??= assertPublicRemoteHttpEndpoint(
      endpoint,
      { allowPrivateNetwork: config.allowPrivateNetwork, lookup: opts.lookup },
      teableEndpointError,
    );
    return guardPromise;
  };

  // Memoized per (company, purpose) so one cron sweep resolves once and writes
  // one secret_access_events row, not one per HTTP call.
  const tokenCache = new Map<string, Promise<string | null>>();

  async function resolveFromSecrets(
    companyId: string,
    purpose: TeableTokenPurpose,
  ): Promise<string | null> {
    const names = purpose === "read" ? readNames : writeNames;
    for (const name of names) {
      const secret = await Promise.resolve(secrets.getByName(companyId, name)).catch(() => null);
      if (!secret) continue;
      // A resolution failure records its own audit event; fall through to the
      // next candidate name rather than failing the whole call here.
      const token = await Promise.resolve(
        secrets.resolveSecretValue(companyId, secret.id, "latest", {
          accessContext: {
            consumerType: "system",
            consumerId: "teable-client",
            actorType: "system",
            issueId: opts.accessContext?.issueId ?? null,
            heartbeatRunId: opts.accessContext?.heartbeatRunId ?? null,
            responsibleUserId: opts.accessContext?.responsibleUserId ?? null,
          },
        }),
      )
        .then((value) => value.trim())
        .catch(() => "");
      if (token) return token;
    }
    // Deliberately NO server-env fallback (unlike git-credentials.ts): a
    // company-scoped integration must never cross tenants on one shared token.
    return null;
  }

  function resolveToken(companyId: string, purpose: TeableTokenPurpose): Promise<string | null> {
    if (hasExplicitTokenProvider) {
      return Promise.resolve(opts.tokenProvider ? opts.tokenProvider(companyId, purpose) : null);
    }
    let cached = tokenCache.get(`${purpose}:${companyId}`);
    if (!cached) {
      cached = resolveFromSecrets(companyId, purpose);
      tokenCache.set(`${purpose}:${companyId}`, cached);
    }
    return cached;
  }

  async function request<T>(input: {
    companyId: string;
    purpose: TeableTokenPurpose;
    method: "GET" | "POST";
    url: string;
    body?: unknown;
    parse: (payload: unknown) => T | null;
  }): Promise<TeableResult<T>> {
    const token = await resolveToken(input.companyId, input.purpose);
    if (!token) return { ok: false, error: teableError("teable_not_configured") };

    try {
      await assertEndpointOnce();
    } catch (error) {
      return {
        ok: false,
        error: teableError("teable_not_configured", {
          message: error instanceof Error ? error.message : undefined,
        }),
      };
    }

    // Only idempotent reads are retried. A retried POST that actually succeeded
    // server-side appends a DUPLICATE row -- Teable's create endpoint takes no
    // idempotency key -- and a duplicate is exactly what F-010-2's append-only
    // evidence write cannot tolerate.
    const maxAttempts = input.method === "GET" ? Math.max(1, config.maxAttempts) : 1;
    let attempt = 0;
    let lastError: TeableError = teableError("teable_unreachable");

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      timer.unref?.();

      let response: Response;
      try {
        response = await doFetch(input.url, {
          method: input.method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            "user-agent": config.userAgent,
            ...(input.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
          signal: controller.signal,
        });
      } catch {
        lastError = teableError("teable_unreachable", { attempts: attempt });
        if (attempt < maxAttempts) {
          await sleep(retryDelayMs(attempt, null));
          continue;
        }
        return { ok: false, error: lastError };
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const envelope = parseTeableErrorEnvelope(await response.json().catch(() => null));
        const code = classifyTeableStatus(response.status, envelope);
        const retryAfterSeconds = parseRetryAfterSeconds(response);
        lastError = teableError(code, {
          status: response.status,
          attempts: attempt,
          ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
        });
        if (lastError.retryable && attempt < maxAttempts) {
          await sleep(retryDelayMs(attempt, retryAfterSeconds));
          continue;
        }
        return { ok: false, error: lastError };
      }

      const parsed = input.parse(await response.json().catch(() => null));
      if (parsed === null) {
        return {
          ok: false,
          error: teableError("teable_invalid_response", {
            status: response.status,
            attempts: attempt,
          }),
        };
      }
      return { ok: true, data: parsed };
    }

    return { ok: false, error: lastError };
  }

  return {
    async listRecords(input) {
      assertTeableId("table id", input.tableId);
      const url = buildTeableUrl(
        config.baseUrl,
        `/table/${encodeURIComponent(input.tableId)}/record`,
        {
          take: input.take,
          skip: input.skip,
          viewId: input.viewId,
          fieldKeyType: input.fieldKeyType ?? "name",
          projection: input.projection,
          orderBy: input.orderBy,
          search: input.search,
        },
      );
      return request({
        companyId: input.companyId,
        purpose: "read",
        method: "GET",
        url,
        parse: (payload) => {
          const root = asRecord(payload);
          if (!root) return null;
          const records = parseArrayOf(root.records, parseTeableRecord);
          if (!records) return null;
          return {
            records,
            hasMore: input.take !== undefined && records.length === input.take,
          } satisfies TeableRecordPage;
        },
      });
    },

    async getRecord(input) {
      assertTeableId("table id", input.tableId);
      assertTeableId("record id", input.recordId);
      const url = buildTeableUrl(
        config.baseUrl,
        `/table/${encodeURIComponent(input.tableId)}/record/${encodeURIComponent(input.recordId)}`,
        { fieldKeyType: input.fieldKeyType ?? "name" },
      );
      return request({
        companyId: input.companyId,
        purpose: "read",
        method: "GET",
        url,
        parse: parseTeableRecord,
      });
    },

    async createRecords(input) {
      assertTeableId("table id", input.tableId);
      const url = buildTeableUrl(config.baseUrl, `/table/${encodeURIComponent(input.tableId)}/record`);
      return request({
        companyId: input.companyId,
        purpose: "write",
        method: "POST",
        url,
        body: {
          fieldKeyType: input.fieldKeyType ?? "name",
          typecast: input.typecast ?? false,
          records: input.records.map((record) => ({ fields: record.fields })),
        },
        // INFERRED: the docs show the created records as the response but do not
        // pin the envelope, so both the bare array and a `{ records: [...] }`
        // wrapper are accepted rather than failing the write on a shape guess.
        parse: (payload) =>
          parseArrayOf(payload, parseTeableRecord) ??
          parseArrayOf(asRecord(payload)?.records, parseTeableRecord),
      });
    },

    async listFields(input) {
      assertTeableId("table id", input.tableId);
      const url = buildTeableUrl(config.baseUrl, `/table/${encodeURIComponent(input.tableId)}/field`);
      return request({
        companyId: input.companyId,
        purpose: "read",
        method: "GET",
        url,
        parse: (payload) => parseArrayOf(payload, parseTeableField),
      });
    },

    async listTables(input) {
      assertTeableId("base id", input.baseId);
      const url = buildTeableUrl(config.baseUrl, `/base/${encodeURIComponent(input.baseId)}/table`);
      return request({
        companyId: input.companyId,
        purpose: "read",
        method: "GET",
        url,
        parse: (payload) => parseArrayOf(payload, parseTeableTable),
      });
    },
  };
}
