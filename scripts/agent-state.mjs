#!/usr/bin/env node
/**
 * agent-state.mjs
 *
 * Pure state rules for the agent issue-to-PR loop: which issues are eligible,
 * label transitions, the daily PR cap and the CI-fix round count.
 * Design: technical-spec/specs/2026-10-12-agent-issue-loop-design.md sections 4 and 5.
 *
 * CLI (JSON on stdin, JSON on stdout):
 *   node scripts/agent-state.mjs eligible   {"labels": ["agent-ready"]}
 *   node scripts/agent-state.mjs daily-cap  {"prs": [{"createdAt": "...", "labels": ["agent-pr"]}], "now": "..."}
 *   node scripts/agent-state.mjs rounds     {"messages": ["fix\n\nT3-Agent-Round: 1"]}
 * Exit 0 on success, 2 on bad input.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const LABELS = Object.freeze({
  ready: "agent-ready",
  working: "agent-working",
  pr: "agent-pr",
  blocked: "agent-blocked",
  readyToMerge: "ready-to-merge",
});

export const EXCLUDED_LABELS = Object.freeze(["decision", "ci"]);
export const DAILY_PR_CAP = 3;
export const MAX_CI_ROUNDS = 3;

const IN_FLIGHT = [LABELS.working, LABELS.pr, LABELS.blocked];

export function isEligible(labels) {
  const set = new Set(labels);
  if (!set.has(LABELS.ready)) return { eligible: false, reason: `missing ${LABELS.ready}` };
  for (const excluded of EXCLUDED_LABELS) {
    if (set.has(excluded)) return { eligible: false, reason: `excluded label: ${excluded}` };
  }
  for (const state of IN_FLIGHT) {
    if (set.has(state)) return { eligible: false, reason: `already ${state}` };
  }
  return { eligible: true, reason: null };
}

function replace(labels, remove, add) {
  const drop = new Set(remove);
  const kept = labels.filter((label) => !drop.has(label));
  for (const label of add) {
    if (!kept.includes(label)) kept.push(label);
  }
  return kept;
}

// Returns the issue's new label list. Throws when the event is not legal from
// the current labels, so a workflow cannot skip a state.
export function applyEvent(labels, event) {
  switch (event) {
    case "start": {
      const { eligible, reason } = isEligible(labels);
      if (!eligible) throw new Error(`cannot start: ${reason}`);
      return replace(labels, [LABELS.ready], [LABELS.working]);
    }
    case "pr-opened":
      if (!labels.includes(LABELS.working)) throw new Error(`cannot open a PR: missing ${LABELS.working}`);
      return replace(labels, [LABELS.working], [LABELS.pr]);
    case "block":
      return replace(labels, [LABELS.ready, LABELS.working, LABELS.pr], [LABELS.blocked]);
    default:
      throw new Error(`unknown event: ${event}`);
  }
}

function startOfUtcDay(now) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid date: ${now}`);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dailyCap({ prs, now, cap = DAILY_PR_CAP }) {
  const dayStart = startOfUtcDay(now);
  const count = prs.filter((pr) => {
    if (!pr.labels.includes(LABELS.pr)) return false;
    const created = new Date(pr.createdAt).getTime();
    if (Number.isNaN(created)) throw new Error(`invalid createdAt: ${pr.createdAt}`);
    return created >= dayStart;
  }).length;
  return { count, cap, reached: count >= cap };
}

const ROUND_TRAILER = /^T3-Agent-Round:[ \t]*(\d+)[ \t]*$/gm;

export function ciRounds({ messages, max = MAX_CI_ROUNDS }) {
  let used = 0;
  for (const message of messages) {
    for (const match of message.matchAll(ROUND_TRAILER)) {
      used = Math.max(used, Number(match[1]));
    }
  }
  return { used, max, exhausted: used >= max, next: used + 1 };
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const command = process.argv[2];
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    let result;
    if (command === "eligible") result = isEligible(input.labels ?? []);
    else if (command === "daily-cap") result = dailyCap({ prs: input.prs ?? [], now: input.now, cap: input.cap });
    else if (command === "rounds") result = ciRounds({ messages: input.messages ?? [], max: input.max });
    else throw new Error("usage: node scripts/agent-state.mjs <eligible|daily-cap|rounds> < input.json");
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
