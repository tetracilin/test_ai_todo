/**
 * Client-side store for the adapter types an operator may pick when creating
 * an agent.
 *
 * The set is the server's answer — the `selectable` flag on GET /api/adapters,
 * which the server derives from PAPERCLIP_SELECTABLE_ADAPTER_TYPES. This store
 * deliberately keeps no allowlist of its own: a hardcoded client list that had
 * to be kept in sync with that env var is what made claude_local unpickable on
 * instances whose server already allowed it.
 *
 * Provides synchronous reads so module-level constants can filter against it.
 * Before the first hydration it falls back to the server's own default rather
 * than to "everything", so an unloaded list never widens the choice past what
 * the instance advertises.
 *
 * Usage in components:
 *   useDisabledAdaptersSync() / useSelectableAdapterTypes() populate the store.
 *
 * Usage in non-React code:
 *   import { isSelectableAdapterType } from "@/adapters/selectable-store";
 */

/**
 * Mirrors the server's fallback in `listSelectableServerAdapters()` — the
 * Hermes Gateway flow established by commit c1ffeec6.
 */
const FALLBACK_SELECTABLE_TYPES = ["hermes_gateway"];

let selectableTypes = new Set<string>(FALLBACK_SELECTABLE_TYPES);

/** Check if an adapter type may be picked for a new agent (sync read). */
export function isSelectableAdapterType(type: string): boolean {
  return selectableTypes.has(type);
}

/** Get all selectable adapter types (sync read). */
export function getSelectableAdapterTypes(): Set<string> {
  return selectableTypes;
}

/**
 * Hydrate the store from a server response.
 *
 * `null` means the server did not answer the question — no entry carried a
 * `selectable` flag, or the list has not arrived — and restores the fallback
 * rather than emptying the menu.
 */
export function setSelectableAdapterTypes(types: string[] | null): void {
  selectableTypes = new Set(types ?? FALLBACK_SELECTABLE_TYPES);
}
