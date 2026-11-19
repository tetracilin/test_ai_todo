#!/usr/bin/env node
/**
 * agent-breaker-policy.mjs
 *
 * The circuit breaker of the factory: lowers T3_FACTORY_DIAL when reverts, rollbacks or
 * failures pile up. It never raises the dial. Pure functions; .github/workflows/t3-factory-breaker.yml
 * only moves data in and out.
 * Work package: WP-FACTORY-002 (technical-spec/plans/2026-11-15-wp-factory-002-self-healing.md), Interface 8.
 *
 * CLI:
 *   node scripts/agent-breaker-policy.mjs decide < input.json
 * JSON on stdout. Exit 0 on success, 2 on a usage error.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const REPORT_LIMIT = 1900;

const LIMITS = [
  { stat: "rollbacks7d", min: 1, max: 3, text: "a production rollback in the last 7 days" },
  { stat: "reverts7d", min: 2, max: 2, text: "two or more reverts in the last 7 days" },
  { stat: "openCritical", min: 3, max: 2, text: "three or more open severity:critical issues" },
  { stat: "scenarioIssues24h", min: 5, max: 2, text: "five or more scenario failures in the last 24 hours" },
  { stat: "blocked7d", min: 3, max: 2, text: "three or more blocked agent pull requests in the last 7 days" },
];

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function decide(input) {
  const { dial, stats = {}, hourUtc, automation } = input ?? {};
  const current = count(dial);
  const reasons = [];
  let target = current;
  for (const limit of LIMITS) {
    if (count(stats[limit.stat]) >= limit.min) {
      reasons.push(`${limit.text} (max dial ${limit.max})`);
      target = Math.min(target, limit.max);
    }
  }
  const changed = target < current;

  let report = null;
  if (Number(hourUtc) === 0) {
    const lines = [
      "Factory daily report",
      `dial: ${current}${changed ? ` -> ${target}` : ""}`,
      `automation: ${String(automation ?? "unknown")}`,
      ...LIMITS.map((limit) => `${limit.stat}: ${count(stats[limit.stat])}`),
      `reasons: ${reasons.length ? reasons.join("; ") : "none"}`,
    ];
    report = lines.join("\n");
    if (report.length > REPORT_LIMIT) report = report.slice(0, REPORT_LIMIT);
  }
  return { targetDial: target, changed, reasons, report };
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const [command] = process.argv.slice(2);
  try {
    if (command !== "decide") {
      console.error("usage: node scripts/agent-breaker-policy.mjs decide");
      process.exit(2);
    }
    console.log(JSON.stringify(decide(JSON.parse(readFileSync(0, "utf8") || "{}"))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
