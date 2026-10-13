#!/usr/bin/env node
/**
 * agent-state.mjs
 *
 * Pure state rules for the agent issue-to-PR loop: which issues are eligible,
 * label transitions, the daily PR cap and the CI-fix round count.
 * Design: docs/superpowers/specs/2026-10-12-agent-issue-loop-design.md sections 4 and 5.
 */

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
