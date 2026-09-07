import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";

import { buildManifestFromPackageFiles } from "../services/company-portability.js";
import {
  PORTABILITY_WATCHLIST_CARRIED,
  PORTABILITY_WATCHLIST_EXCLUDED,
  WATCHLIST_EXCLUSION_REASONS,
  WATCHLIST_FIXTURE_FILES,
} from "./company-portability-watchlist.js";

/**
 * PC-012 AC: a table on the portability watchlist that the manifest does not
 * actually carry fails the build.
 *
 * This is deliberately NOT a repo-wide "every company-scoped table must be
 * classified" guard -- see the header of company-portability-watchlist.ts for
 * why that shape would be worse than no guard at all.
 *
 * The check runs against the real manifest builder over one fixture bundle, so
 * it exercises the parse path a real import takes rather than asserting on the
 * type surface, which is erased at runtime.
 */

/** Resolve a `manifestPath` like `issues[].evidenceLinks` against a manifest. */
function resolveManifestPath(manifest: unknown, manifestPath: string): unknown[] {
  let current: unknown[] = [manifest];
  for (const rawSegment of manifestPath.split(".")) {
    const descends = rawSegment.endsWith("[]");
    const key = descends ? rawSegment.slice(0, -2) : rawSegment;
    const next: unknown[] = [];
    for (const node of current) {
      if (node === null || typeof node !== "object") continue;
      const value = (node as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue;
      if (descends) {
        if (Array.isArray(value)) next.push(...value);
        continue;
      }
      next.push(value);
    }
    current = next;
  }
  return current;
}

/** A path "resolves" only when something non-empty sits at the end of it. */
function isCarried(values: unknown[]): boolean {
  if (values.length === 0) return false;
  return values.some((value) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined));
}

describe("company portability registration", () => {
  const { manifest, warnings } = buildManifestFromPackageFiles(WATCHLIST_FIXTURE_FILES);

  it("parses the watchlist fixture bundle cleanly", () => {
    // A warning here means the fixture itself is malformed, which would make
    // every "not carried" failure below a false alarm.
    expect(warnings).toEqual([]);
  });

  it.each(PORTABILITY_WATCHLIST_CARRIED)(
    "carries $manifestPath through the bundle manifest",
    ({ table, manifestPath }) => {
      const resolved = resolveManifestPath(manifest, manifestPath);
      expect(
        isCarried(resolved),
        `Table ${getTableName(table)} is on the portability watchlist as carried at "${manifestPath}", `
          + "but that path is empty in a bundle built from WATCHLIST_FIXTURE_FILES. Either register the "
          + "entity in the manifest/normalizer/import path, or extend the fixture so it exercises the field.",
      ).toBe(true);
    },
  );

  it("gives every exclusion a recognized reason code and a note", () => {
    for (const entry of PORTABILITY_WATCHLIST_EXCLUDED) {
      expect(
        Object.prototype.hasOwnProperty.call(WATCHLIST_EXCLUSION_REASONS, entry.reason),
        `Table ${getTableName(entry.table)} is excluded with an unrecognized reason code "${entry.reason}".`,
      ).toBe(true);
      expect(entry.note.trim().length, `Table ${getTableName(entry.table)} is excluded without a note.`)
        .toBeGreaterThan(0);
    }
  });

  it("lists each watched table exactly once", () => {
    const tableNames = [
      ...PORTABILITY_WATCHLIST_CARRIED.map((entry) => getTableName(entry.table)),
      ...PORTABILITY_WATCHLIST_EXCLUDED.map((entry) => getTableName(entry.table)),
    ];
    const duplicates = tableNames.filter((name, index) => tableNames.indexOf(name) !== index);
    expect(duplicates).toEqual([]);
  });

  it("registers external_objects ahead of issue_evidence_links", () => {
    // Ordering is load-bearing, not cosmetic: an evidence link is a NOT NULL FK
    // onto external_objects, so the artifact table has to be registered (and
    // imported) first or the link import is a constraint violation.
    const order = PORTABILITY_WATCHLIST_CARRIED.map((entry) => getTableName(entry.table));
    expect(order.indexOf("external_objects")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("external_objects")).toBeLessThan(order.indexOf("issue_evidence_links"));
  });
});
