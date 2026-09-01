/**
 * Hermes Gateway e2e fixture config for smoke-lab scout agents.
 *
 * Agent creation is gateway-only since c1ffeec67 ("enforce Hermes Gateway AI
 * flow"), so e2e specs that create a scout agent must use the hermes_gateway
 * adapter with a connection config instead of the old `process` adapter. The
 * smoke-lab lifecycle only needs the scout to exist and to carry a run id; it
 * never waits on the gateway adapter itself, so the config points at the
 * loopback fixture URL by default. A live fixture (or a real gateway in a
 * staging e2e lane) can override it through the PAPERCLIP_E2E_HERMES_* env
 * vars, mirroring tests/e2e/hermes-gateway-fixture.mjs.
 */
export const HERMES_E2E_API_KEY = process.env.PAPERCLIP_E2E_HERMES_API_KEY ?? "smoke-lab-e2e-hermes-fixture-key";
export const HERMES_E2E_PORT = Number(process.env.PAPERCLIP_E2E_HERMES_PORT ?? 8643);
export const HERMES_E2E_API_BASE_URL =
  process.env.PAPERCLIP_E2E_HERMES_API_BASE_URL ?? `http://127.0.0.1:${HERMES_E2E_PORT}/api`;

export function hermesGatewayE2eAdapterConfig() {
  return {
    apiBaseUrl: HERMES_E2E_API_BASE_URL,
    // A plain value is auto-vaulted into a company secret by
    // normalizeAdapterConfigForPersistence, so creation passes the
    // apiBaseUrl + secret-backed apiKey constraint without a pre-seeded secret.
    apiKey: HERMES_E2E_API_KEY,
    timeoutSec: 10,
    eventReconnectMs: 250,
    pollIntervalMs: 250,
    sessionKeyStrategy: "run",
  };
}