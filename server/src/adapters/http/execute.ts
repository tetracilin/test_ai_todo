import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import { asString, parseObject } from "../utils.js";
import { ADAPTER_DISABLED_AUTHENTICATED_MODE, adapterDeploymentRefusal } from "../deployment-policy.js";

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolves the request timeout. `timeoutMs` wins over the documented
 * `timeoutSec`. A missing value, or a stored legacy 0 (which used to mean "no
 * timeout"), falls back to the 30 second default; new writes of 0 are rejected
 * at config validation.
 */
export function resolveHttpTimeoutMs(config: Record<string, unknown>): { timeoutMs: number; legacyZero: boolean } {
  const ms = positiveNumber(config.timeoutMs);
  if (ms !== null) return { timeoutMs: ms, legacyZero: false };
  const sec = positiveNumber(config.timeoutSec);
  if (sec !== null) return { timeoutMs: Math.round(sec * 1000), legacyZero: false };
  return { timeoutMs: DEFAULT_HTTP_TIMEOUT_MS, legacyZero: config.timeoutMs === 0 || config.timeoutSec === 0 };
}

/** The URL without its query string or fragment, for summaries and errors. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/, 1)[0] ?? url;
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, runId, agent, context, onLog } = ctx;

  const refusal = adapterDeploymentRefusal("http");
  if (refusal) {
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      errorMessage: refusal,
      errorCode: ADAPTER_DISABLED_AUTHENTICATED_MODE,
    };
  }

  const url = asString(config.url, "");
  if (!url) throw new Error("HTTP adapter missing url");

  const method = asString(config.method, "POST");
  const { timeoutMs, legacyZero } = resolveHttpTimeoutMs(config);
  if (legacyZero) {
    await onLog(
      "stderr",
      `[paperclip] http adapter: stored timeout of 0 means no timeout and is no longer supported; using ${timeoutMs}ms\n`,
    );
  }
  const headers = parseObject(config.headers) as Record<string, string>;
  const payloadTemplate = parseObject(config.payloadTemplate);
  const body = { ...payloadTemplate, agentId: agent.id, runId, context };
  const displayUrl = redactUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP invoke failed with status ${res.status}`);
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: `HTTP ${method} ${displayUrl}`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        exitCode: null,
        signal: null,
        timedOut: true,
        errorMessage: `HTTP ${method} ${displayUrl} timed out after ${timeoutMs}ms`,
        errorCode: "timeout",
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
