import type { DeploymentMode } from "@paperclipai/shared";

/**
 * Adapter types that must not run in authenticated deployments.
 *
 * `http` makes an unrestricted server-side request to any configured URL. The
 * upstream hardening (9dd6526b47) is not ported yet, so authenticated
 * instances refuse it at selection and at run start. It still works in
 * `local_trusted` mode. See the risk register in
 * technical-spec/specs/2026-10-23-upstream-adapters-ai-connections-design.md.
 */
const AUTHENTICATED_MODE_DISABLED_ADAPTER_TYPES = new Set(["http"]);

export const ADAPTER_DISABLED_AUTHENTICATED_MODE = "adapter_disabled_authenticated_mode";

let currentDeploymentMode: DeploymentMode = "local_trusted";

/** Records the server's deployment mode for adapter policy checks. Called once at startup. */
export function setAdapterDeploymentMode(mode: DeploymentMode): void {
  currentDeploymentMode = mode;
}

export function getAdapterDeploymentMode(): DeploymentMode {
  return currentDeploymentMode;
}

/**
 * Returns the refusal message when `adapterType` may not be used in `mode`,
 * or null when it is allowed.
 */
export function adapterDeploymentRefusal(
  adapterType: string,
  mode: DeploymentMode = currentDeploymentMode,
): string | null {
  if (mode !== "authenticated" || !AUTHENTICATED_MODE_DISABLED_ADAPTER_TYPES.has(adapterType)) {
    return null;
  }
  return `Adapter "${adapterType}" is disabled in authenticated deployment mode until its request hardening lands `
    + "(revisit before the custom-model-providers work merges, or 2026-12-31). Use another adapter.";
}
