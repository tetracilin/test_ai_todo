/**
 * Adapter metadata utilities — built on top of the display registry and UI adapter list.
 *
 * This module bridges the static display metadata with the dynamic adapter registry.
 * "Coming soon" status is derived from the display registry's `comingSoon` flag.
 * "Hidden" status comes from the disabled-adapter store (server-side toggle).
 * "Selectable" status comes from the selectable-adapter store (server-side
 * PAPERCLIP_SELECTABLE_ADAPTER_TYPES).
 */
import type { UIAdapterModule } from "./types";
import { listUIAdapters } from "./registry";
import { isAdapterTypeHidden } from "./disabled-store";
import { isSelectableAdapterType } from "./selectable-store";
import { getAdapterLabel, getAdapterDisplay } from "./adapter-display-registry";

export interface AdapterOptionMetadata {
  value: string;
  label: string;
  comingSoon: boolean;
  hidden: boolean;
  experimental: boolean;
}

export function listKnownAdapterTypes(): string[] {
  return listUIAdapters().map((adapter) => adapter.type);
}

/**
 * Check whether an adapter type is enabled (not "coming soon").
 * Unknown types (external adapters) are always considered enabled.
 */
export function isEnabledAdapterType(type: string): boolean {
  // Check display registry first — built-in adapters like process/http are
  // intentionally withheld even though they're registered as UI adapters.
  if (getAdapterDisplay(type).comingSoon) return false;
  // All other types (registered or external) are enabled.
  return true;
}

/**
 * Check whether an adapter type is a valid choice for new agent creation.
 *
 * The instance decides which adapters it offers — the server answers with
 * `selectable` on GET /api/adapters and enforces the same set on the hire
 * route. A "coming soon" adapter is still withheld even if the server offers
 * it, because that flag is about the UI not being ready for it.
 */
export function isValidAdapterType(type: string): boolean {
  return isSelectableAdapterType(type) && !getAdapterDisplay(type).comingSoon;
}

/**
 * Check whether an adapter should appear in card-style visual pickers.
 * Experimental adapters can remain selectable from explicit configuration
 * dropdowns without being recommended during onboarding or setup flows.
 */
export function isVisualAdapterChoice(type: string): boolean {
  return !getAdapterDisplay(type).hideFromVisualSelection;
}

/**
 * Build option metadata for a list of adapters (for dropdowns).
 * `labelFor` callback allows callers to override labels; defaults to display registry.
 */
export function listAdapterOptions(
  labelFor?: (type: string) => string,
  adapters: UIAdapterModule[] = listUIAdapters(),
): AdapterOptionMetadata[] {
  const getLabel = labelFor ?? getAdapterLabel;
  return adapters.map((adapter) => ({
    value: adapter.type,
    label: getLabel(adapter.type),
    comingSoon: !!getAdapterDisplay(adapter.type).comingSoon,
    hidden: isAdapterTypeHidden(adapter.type),
    experimental: !!getAdapterDisplay(adapter.type).experimental,
  }));
}

/**
 * Build option metadata for the adapters this instance offers at agent
 * creation, in registry order. Same rule as {@link isValidAdapterType}.
 */
export function listSelectableAdapterOptions(
  labelFor?: (type: string) => string,
  adapters: UIAdapterModule[] = listUIAdapters(),
): AdapterOptionMetadata[] {
  return listAdapterOptions(labelFor, adapters).filter((option) =>
    isValidAdapterType(option.value),
  );
}

/**
 * List UI adapters excluding those hidden via the Adapters settings page.
 */
export function listVisibleUIAdapters(): UIAdapterModule[] {
  return listUIAdapters().filter((a) => !isAdapterTypeHidden(a.type));
}

/**
 * List visible adapter types (for non-React contexts like module-level constants).
 */
export function listVisibleAdapterTypes(): string[] {
  return listVisibleUIAdapters().map((a) => a.type);
}
