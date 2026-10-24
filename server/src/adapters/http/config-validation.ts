/**
 * Write-time check for http adapter timeouts, shared by agent routes and
 * company imports. A stored legacy 0 still runs with the 30 s default
 * (see resolveHttpTimeoutMs); only new writes are refused.
 */
export function httpTimeoutConfigError(adapterConfig: Record<string, unknown>): string | null {
  for (const field of ["timeoutSec", "timeoutMs"] as const) {
    const value = adapterConfig[field];
    if (value !== undefined && !(typeof value === "number" && Number.isFinite(value) && value > 0)) {
      return `Invalid http adapterConfig: ${field} timeout must be greater than 0`;
    }
  }
  return null;
}
