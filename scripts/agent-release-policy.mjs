#!/usr/bin/env node
/**
 * agent-release-policy.mjs
 *
 * The decision of the automatic release (dial 4): release the tested version to production
 * or hold. Pure functions; .github/workflows/t3-agent-release.yml only moves data in and out.
 * Work package: WP-FACTORY-002 (technical-spec/plans/2026-11-15-wp-factory-002-self-healing.md), Interface 7.
 *
 * CLI:
 *   node scripts/agent-release-policy.mjs decide < input.json
 * JSON on stdout. Exit 0 on success, 2 on a usage error.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HOUR_MS = 3600 * 1000;
const MIN_GAP_HOURS = 20;
const VERSION_TAG = /^v(\d+)\.(\d+)(?:\.(\d+))?$/;

function parseTag(tag) {
  const match = VERSION_TAG.exec(String(tag ?? ""));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compareParts(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Highest version tag plus one in the third group, or null when no tag is a version tag. */
export function nextTag(tags) {
  let best = null;
  for (const tag of tags ?? []) {
    const parts = parseTag(tag);
    if (parts && (best === null || compareParts(parts, best) > 0)) best = parts;
  }
  return best === null ? null : `v${best[0]}.${best[1]}.${best[2] + 1}`;
}

/** window is "<from>-<to>" in UTC hours; from > to wraps past midnight. */
export function inWindow(now, window) {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(String(window ?? ""));
  if (!match) return false;
  const from = Number(match[1]);
  const to = Number(match[2]);
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return false;
  const hour = date.getUTCHours();
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

function hold(reason, notify = null) {
  return { action: "hold", reason, tag: null, notify };
}

export function decide(input) {
  const i = input ?? {};
  const sha7 = String(i.sha ?? "").slice(0, 7);
  const scenarios = i.scenarios ?? {};
  const dial = Number(i.dial);

  if (i.automation !== "on") return hold("automation off");
  if (!(dial >= 4)) {
    return hold(
      `dial ${i.dial}: production waits for the owner`,
      `Version ${sha7} passed every scenario. Release it by hand or set the dial to 4.`,
    );
  }
  if (!i.onDevelop || scenarios.sha !== i.sha) return hold("version mismatch");
  if (!i.nightlyOk) return hold("nightly not green for this version");
  if (!(Number(scenarios.critical) > 0)) {
    return hold("no confirmed critical scenario", "No confirmed critical scenario exists, so nothing can be released automatically.");
  }
  if (Number(scenarios.failed) > 0) return hold("a scenario failed");
  if (Number(i.openCritical) > 0) return hold("open severity:critical issue");
  if (i.openReleasePr) return hold("release pull request already open");
  if (Number(i.mainOnlyCommits) > 0) {
    return hold(
      "main has commits that develop does not have",
      "main has commits that develop does not have. Merge main back into develop before the next release.",
    );
  }
  if ((i.tagsAtSha ?? []).length > 0) return hold("already released");
  if (i.lastReleaseAt) {
    const last = new Date(i.lastReleaseAt).getTime();
    const now = new Date(i.now).getTime();
    if (!Number.isNaN(last) && !Number.isNaN(now) && now - last < MIN_GAP_HOURS * HOUR_MS) return hold("one release a day");
  }
  if (!inWindow(i.now, i.window)) return hold("outside the release window");
  const tag = nextTag(i.tags);
  if (!tag) return hold("no version tag found", "No version tag found, so the next tag cannot be chosen. Tag the first version by hand.");
  return { action: "release", reason: "", tag, notify: `Releasing ${tag} (${sha7}) to production.` };
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const [command] = process.argv.slice(2);
  try {
    if (command !== "decide") {
      console.error("usage: node scripts/agent-release-policy.mjs decide");
      process.exit(2);
    }
    console.log(JSON.stringify(decide(JSON.parse(readFileSync(0, "utf8") || "{}"))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
