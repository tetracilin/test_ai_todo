export const HERMES_E2E_API_KEY = process.env.PAPERCLIP_E2E_HERMES_API_KEY;
export const HERMES_E2E_PORT = Number(process.env.PAPERCLIP_E2E_HERMES_PORT ?? 38643);
export const HERMES_E2E_API_BASE_URL = process.env.PAPERCLIP_E2E_HERMES_API_BASE_URL ?? `http://127.0.0.1:${HERMES_E2E_PORT}/api`;

export function hermesGatewayE2eAdapterConfig() {
  if (!HERMES_E2E_API_KEY) {
    throw new Error("PAPERCLIP_E2E_HERMES_API_KEY is required for Hermes E2E fixture agents");
  }
  return {
    apiBaseUrl: HERMES_E2E_API_BASE_URL,
    apiKey: HERMES_E2E_API_KEY,
    timeoutSec: 10,
    eventReconnectMs: 250,
    pollIntervalMs: 250,
    sessionKeyStrategy: "run",
  };
}