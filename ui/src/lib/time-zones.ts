/** The viewer's IANA time zone, or "UTC" when the runtime cannot report one. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * IANA zone names for a picker. Always contains "UTC" (not every runtime lists it)
 * and `current`, so a stored zone the runtime does not enumerate still renders.
 */
export function timeZoneOptions(current: string): string[] {
  let supported: string[] = [];
  try {
    supported = (Intl as unknown as { supportedValuesOf(key: "timeZone"): string[] }).supportedValuesOf("timeZone");
  } catch {
    // Older runtimes: fall back to UTC plus the current value.
  }
  return [...new Set(["UTC", current, ...supported])].sort((a, b) => a.localeCompare(b));
}
