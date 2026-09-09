import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adaptersApi, type AdapterInfo } from "@/api/adapters";
import { setDisabledAdapterTypes } from "@/adapters/disabled-store";
import {
  getSelectableAdapterTypes,
  setSelectableAdapterTypes,
} from "@/adapters/selectable-store";
import { syncExternalAdapters } from "@/adapters/registry";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Extract the adapter types the server offers at agent creation.
 *
 * Returns null when no entry carries the flag — a server that predates it —
 * so the store keeps its fallback instead of reading the silence as "none".
 */
function selectableTypesFrom(adapters: AdapterInfo[]): string[] | null {
  if (!adapters.some((a) => a.selectable !== undefined)) return null;
  return adapters.filter((a) => a.selectable).map((a) => a.type);
}

/**
 * Fetch adapters and keep the disabled-adapter store + UI adapter registry
 * in sync with the server.
 *
 * - Registers external adapter types in the UI registry so they appear in
 *   dropdowns (done eagerly during render — idempotent, no React state).
 * - Syncs the selectable-adapter store, also eagerly during render, so a menu
 *   built by a useMemo in the same render cycle sees the server's answer
 *   rather than the pre-hydration fallback.
 * - Syncs the disabled-adapter store for non-React consumers (useEffect).
 *
 * Returns a reactive Set of disabled types for use as useMemo dependencies.
 * Call this at the top of any component that renders adapter menus.
 */
export function useDisabledAdaptersSync(options: { enabled?: boolean } = {}): Set<string> {
  const enabled = options.enabled ?? true;
  const { data: adapters } = useQuery({
    queryKey: queryKeys.adapters.all,
    queryFn: () => adaptersApi.list(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  // Eagerly register external adapter types in the UI registry so that
  // consumers calling listUIAdapters() in the same render cycle see them.
  // This is idempotent — already-registered types are skipped.
  if (adapters) {
    syncExternalAdapters(
      adapters
        .filter((a) => a.source === "external")
        .map((a) => ({
          type: a.type,
          label: a.label,
          disabled: a.disabled,
          overrideDisabled: a.overridePaused,
        })),
    );
    setSelectableAdapterTypes(selectableTypesFrom(adapters));
  }

  // Sync the disabled set to the global store for non-React code
  useEffect(() => {
    if (!adapters) return;
    setDisabledAdapterTypes(
      adapters.filter((a) => a.disabled).map((a) => a.type),
    );
  }, [adapters]);

  return useMemo(
    () => new Set(adapters?.filter((a) => a.disabled).map((a) => a.type) ?? []),
    [adapters],
  );
}

/**
 * The adapter types this instance offers at agent creation, as a reactive Set.
 *
 * Hydrates the selectable-adapter store on the way through, so a caller that
 * reads `isValidAdapterType` inside an effect can list this Set as a dependency
 * and re-check once the server's answer lands. Without that dependency the
 * check runs only on the first render, when the store still holds the
 * pre-hydration fallback and a widened adapter looks unavailable.
 *
 * Reads the same query key as {@link useDisabledAdaptersSync}, so it shares
 * that cache entry rather than adding a request.
 */
export function useSelectableAdapterTypes(options: { enabled?: boolean } = {}): Set<string> {
  const enabled = options.enabled ?? true;
  const { data: adapters } = useQuery({
    queryKey: queryKeys.adapters.all,
    queryFn: () => adaptersApi.list(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  if (adapters) setSelectableAdapterTypes(selectableTypesFrom(adapters));

  // Read back through the store so both hydration paths agree on the fallback.
  return useMemo(() => new Set(getSelectableAdapterTypes()), [adapters]);
}

/**
 * Whether the adapter list has arrived, so callers can tell "this instance
 * does not offer that adapter" from "the registry has not loaded yet".
 *
 * External adapter types are registered into the UI registry by
 * {@link useDisabledAdaptersSync} only once the query resolves. Until then
 * `listUIAdapters()` returns the built-ins alone, so an external adapter looks
 * exactly like one the deployer has disabled.
 *
 * Deliberately reports arrival rather than settlement, unlike the fail-open
 * gates elsewhere in onboarding. The directions of harm are opposite here. A
 * caller that acts on an unloaded registry replaces the customer's chosen
 * adapter with a built-in and persists that choice; a caller that waits
 * forever simply leaves the selection alone, which is the behaviour that
 * existed before any of this. Silently changing a saved answer is the error
 * worth refusing to make.
 *
 * Reads the same query key as {@link useDisabledAdaptersSync}, so it shares
 * that cache entry rather than adding a request.
 */
export function useAdapterRegistryLoaded(options: { enabled?: boolean } = {}): boolean {
  const enabled = options.enabled ?? true;
  const { data: adapters } = useQuery({
    queryKey: queryKeys.adapters.all,
    queryFn: () => adaptersApi.list(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  return adapters !== undefined;
}
