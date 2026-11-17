#!/usr/bin/env node
/**
 * agent-merge-policy.mjs
 *
 * Every decision of the factory merge gate, as pure functions: the tier of a change,
 * who may merge at which dial, which mode a review run takes, what a verdict does,
 * and what the sweep does next. The workflows .github/workflows/t3-agent-review.yml
 * and t3-agent-sweep.yml only move data in and out of these functions.
 * Work package: WP-FACTORY-001 (technical-spec/plans/2026-11-14-wp-factory-001-merge-gate.md).
 *
 * CLI:
 *   node scripts/agent-merge-policy.mjs classify --base <sha> --head <sha> --dial <0-4>
 *   node scripts/agent-merge-policy.mjs gate   < input.json
 *   node scripts/agent-merge-policy.mjs decide < input.json
 *   node scripts/agent-merge-policy.mjs sweep  < input.json
 * JSON on stdout. Exit 0 on success, 2 on a usage error or a git error.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { LIMITS, checkPatch } from "./agent-guard.mjs";
import { parsePatchChecked } from "./agent-patch.mjs";
import { LABELS, ciRounds } from "./agent-state.mjs";

export const NEEDS_HUMAN_LABEL = "needs-human";
export const REWORK_LABEL = "agent-rework";
export const HOLD_LABEL = "factory-hold";
export const CI_CHECKS = Object.freeze(["unit", "build", "build-image", "server-tests"]);
export const MAX_DESCRIPTION = 140;

const TIER_RANK = { low: 0, medium: 1, high: 2, protected: 3 };
const PROTECTED_RULES = new Set(["malformed-patch", "empty-patch", "path-escape", "symlink", "binary", "test-weakening"]);
const LOCK_FILE = "pnpm-lock.yaml";

// ---------------------------------------------------------------- tier and dial

function labelNames(labels) {
  return (labels ?? []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
}

function hasLabel(pr, name) {
  return labelNames(pr?.labels).includes(name);
}

function violationTier(violation) {
  if (PROTECTED_RULES.has(violation.rule)) return "protected";
  if (violation.rule === "protected-path") return violation.path === LOCK_FILE ? "high" : "protected";
  return "high"; // migration, dependency-change, size
}

// The same rule as the `changes` job of t3-ci.yml: documentation only.
function isDocsOnly(files) {
  if (files.length === 0) return false;
  return files.every((file) =>
    file.paths.every((p) => {
      if (/^(packages|server|cli|skills)\//.test(p) || p.startsWith("ui/src/")) return false;
      return p.startsWith("technical-spec/") || p.endsWith(".md");
    }),
  );
}

export function eligibleAt(tier, dial) {
  if (tier === "protected") return false;
  const level = Number(dial);
  if (!(level >= 0)) return false;
  if (tier === "low") return level >= 1;
  if (tier === "medium") return level >= 2;
  if (tier === "high") return level >= 3;
  return false;
}

export function classifyPatch({ patch, dial, readBefore, readAfter, limits = LIMITS } = {}) {
  const verdict = checkPatch({ patch, readBefore, readAfter, limits });
  const reasons = [];
  let tier = null;
  for (const violation of verdict.violations) {
    const raised = violationTier(violation);
    if (tier === null || TIER_RANK[raised] > TIER_RANK[tier]) tier = raised;
    const where = violation.path ? ` ${violation.path}` : "";
    reasons.push(`${violation.rule}${where}: ${violation.detail}`);
  }
  if (tier === null) {
    const { files } = parsePatchChecked(patch ?? "");
    tier = isDocsOnly(files) ? "low" : "medium";
  }
  const eligible = eligibleAt(tier, dial);
  if (!eligible) {
    reasons.push(tier === "protected" ? "protected changes never merge without the owner" : `dial ${dial} holds ${tier}-tier changes`);
  }
  return { tier, eligible, reasons, stats: verdict.stats };
}

export function patchIdOf(patch) {
  if (!patch || !patch.trim()) return "";
  const out = execFileSync("git", ["patch-id", "--stable"], {
    input: patch,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
  return out.trim().split(/\s+/)[0] ?? "";
}

// ---------------------------------------------------------------- gate

const MARKER_LINE = /^<!-- t3-agent-review v1 sha=([0-9a-f]{40}) patch=(\S+) verdict=(PASS|FAIL|NEEDS_HUMAN|NONE) mode=(claude|drill|override|ci) date=(\d{4}-\d{2}-\d{2}) -->$/;

// A marker is the last non-empty line of a comment. Reading only that line means text
// quoted in the middle of a comment can never act as a marker.
export function parseMarker(body) {
  const text = typeof body === "string" ? body : body?.body;
  if (typeof text !== "string") return null;
  const last = text.replace(/\r\n/g, "\n").trimEnd().split("\n").at(-1) ?? "";
  const match = MARKER_LINE.exec(last.trim());
  if (!match) return null;
  return { sha: match[1], patch: match[2], verdict: match[3], mode: match[4], date: match[5] };
}

function ciState(input) {
  if (input.event === "workflow_run") {
    if (input.ciConclusion === "success") return "green";
    if (["failure", "timed_out", "action_required"].includes(input.ciConclusion)) return "red";
    return "pending";
  }
  return checksState(input.checks);
}

export function checksState(checks) {
  const byName = new Map();
  for (const check of checks ?? []) byName.set(check.name, check.conclusion);
  const bad = ["failure", "timed_out", "cancelled", "action_required"];
  if (CI_CHECKS.some((name) => bad.includes(byName.get(name)))) return "red";
  if (CI_CHECKS.every((name) => ["success", "skipped", "neutral"].includes(byName.get(name)))) return "green";
  return "pending";
}

export function gate(input) {
  const pr = input.pr ?? {};
  if (!pr.number || pr.state !== "OPEN" || pr.baseRefName !== "develop") {
    return { mode: "skip", reason: "no open pull request into develop" };
  }
  if (input.event === "workflow_dispatch" && input.override === "approve") {
    return { mode: "override", reason: "owner override" };
  }
  if (input.event === "workflow_run" && input.runSha !== pr.headRefOid) {
    return { mode: "skip", reason: "stale run" };
  }
  if (input.drill === "fail" || input.drill === "needs-human") {
    return { mode: "drill", reason: input.drill };
  }
  if (input.automation !== "on") return { mode: "human", reason: "automation off" };
  if (pr.isCrossRepository) return { mode: "human", reason: "fork pull request" };
  if (pr.author?.is_bot) return { mode: "human", reason: "bot author" };
  if (hasLabel(pr, HOLD_LABEL)) return { mode: "human", reason: "held by label" };
  if (pr.isDraft) return { mode: "skip", reason: "draft" };

  const ci = ciState(input);
  if (ci === "red" && hasLabel(pr, LABELS.pr)) return { mode: "rework-ci", reason: "t3-ci failed" };
  if (ci !== "green") return { mode: "skip", reason: "t3-ci not green" };

  const patchId = input.policy?.patchId ?? "";
  if (patchId) {
    const same = (input.markers ?? [])
      .map(parseMarker)
      .filter((marker) => marker && marker.mode === "claude" && marker.patch === patchId);
    if (same.length > 0 && same.at(-1).verdict === "PASS") {
      return { mode: "carry", reason: "same change as reviewed" };
    }
  }
  if (Number(input.reviewsToday) >= Number(input.cap)) return { mode: "capped", reason: "daily review cap" };
  return { mode: "review", reason: "" };
}

// ---------------------------------------------------------------- decide

const VERDICTS = new Set(["PASS", "FAIL", "NEEDS_HUMAN"]);

function clip(text, max = MAX_DESCRIPTION) {
  const value = String(text).replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function noMention(text) {
  return String(text).replace(/(^|[^A-Za-z0-9_])@/g, "$1@ ");
}

function blockingCount(review) {
  return (review?.findings ?? []).filter((finding) => finding?.severity === "blocking").length;
}

function result(fields) {
  return {
    state: "none",
    description: "",
    verdict: "NONE",
    enableAutoMerge: false,
    disableAutoMerge: false,
    addLabels: [],
    removeLabels: [],
    notify: null,
    ...fields,
  };
}

export function decide(input) {
  const pr = input.pr ?? {};
  const policy = input.policy ?? {};
  const withNotify = (decision) => {
    if (decision.notify === true) {
      decision.notify = noMention(`T3 factory: PR #${pr.number} "${pr.title}" needs you - ${decision.description}. ${pr.url}`);
    }
    return decision;
  };

  switch (input.mode) {
    case "skip":
      return result({});
    case "human":
      return result({
        state: "success",
        description: clip(`not reviewed: ${input.reason}; human merge`),
        disableAutoMerge: true,
      });
    case "override":
      return result({
        state: "success",
        description: clip(`owner override by ${input.actor}`),
        removeLabels: [NEEDS_HUMAN_LABEL],
      });
    case "capped":
      return result({ state: "pending", description: "daily review cap reached; the sweep retries" });
    default:
      break;
  }

  let verdict;
  let blocking = 0;
  if (input.mode === "review") {
    const review = input.review;
    if (input.reviewJob !== "success" || !review || !VERDICTS.has(review.verdict)) {
      return result({ state: "error", description: "reviewer unavailable; the sweep retries" });
    }
    blocking = blockingCount(review);
    verdict = review.verdict === "PASS" && blocking > 0 ? "FAIL" : review.verdict;
  } else if (input.mode === "carry") {
    verdict = "PASS";
  } else if (input.mode === "drill") {
    verdict = input.reason === "needs-human" ? "NEEDS_HUMAN" : "FAIL";
  } else if (input.mode === "rework-ci") {
    verdict = "FAIL";
  } else {
    return result({ state: "error", description: clip(`unknown mode: ${input.mode}`) });
  }

  if (verdict === "PASS") {
    if (policy.eligible === true && input.automation === "on") {
      return result({
        state: "success",
        verdict,
        description: input.mode === "carry"
          ? "PASS carried forward - same change, branch updated"
          : clip(`PASS - merges automatically (tier ${policy.tier}, dial ${input.dial})`),
        enableAutoMerge: true,
        addLabels: [LABELS.readyToMerge],
        removeLabels: [NEEDS_HUMAN_LABEL, REWORK_LABEL],
      });
    }
    const why = policy.reasons?.[0] ?? (input.automation === "on" ? "not eligible" : "automation off");
    return withNotify(result({
      state: "success",
      verdict,
      description: clip(`PASS - waits for the owner: ${why}`),
      disableAutoMerge: true,
      addLabels: [LABELS.readyToMerge, NEEDS_HUMAN_LABEL],
      removeLabels: [REWORK_LABEL],
      notify: true,
    }));
  }

  if (verdict === "FAIL") {
    if (hasLabel(pr, LABELS.pr)) {
      const rounds = ciRounds({ messages: input.messages ?? [] });
      if (!rounds.exhausted) {
        return result({
          state: "failure",
          verdict,
          description: clip(`FAIL - sent back to the agent (round ${rounds.next} of ${rounds.max})`),
          disableAutoMerge: true,
          addLabels: [REWORK_LABEL],
          removeLabels: [LABELS.readyToMerge],
        });
      }
      return withNotify(result({
        state: "failure",
        verdict,
        description: "FAIL - three rework rounds used; waits for the owner",
        disableAutoMerge: true,
        addLabels: [LABELS.blocked, NEEDS_HUMAN_LABEL],
        removeLabels: [LABELS.readyToMerge, REWORK_LABEL],
        notify: true,
      }));
    }
    return withNotify(result({
      state: "failure",
      verdict,
      description: clip(`FAIL - ${blocking} blocking finding(s); see the review comment`),
      disableAutoMerge: true,
      addLabels: [NEEDS_HUMAN_LABEL],
      removeLabels: [LABELS.readyToMerge],
      notify: true,
    }));
  }

  return withNotify(result({
    state: "failure",
    verdict: "NEEDS_HUMAN",
    description: "NEEDS_HUMAN - see the review comment",
    disableAutoMerge: true,
    addLabels: [NEEDS_HUMAN_LABEL],
    removeLabels: [LABELS.readyToMerge],
    notify: true,
  }));
}

// ---------------------------------------------------------------- sweep

function byCreated(a, b) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.number - b.number;
}

function neverReviewed(pr) {
  return !pr.agentReview || String(pr.agentReview.description ?? "").startsWith("not reviewed:");
}

function mayBeReviewed(pr) {
  return !pr.isCrossRepository && !pr.author?.is_bot && !hasLabel(pr, HOLD_LABEL);
}

export function sweep({ automation, maxDispatch = 3, prs = [] } = {}) {
  const out = { disableAutoMerge: [], conflicts: [], updateBranch: null, dispatchReview: [] };
  const ordered = [...prs].sort(byCreated);
  const on = automation === "on";

  if (!on) {
    out.disableAutoMerge = ordered.filter((pr) => pr.autoMergeRequest != null).map((pr) => pr.number);
  } else {
    const withAuto = ordered.find((pr) => pr.autoMergeRequest != null && pr.mergeStateStatus === "BEHIND");
    const drain = () =>
      ordered.find(
        (pr) => pr.mergeStateStatus === "BEHIND" && !pr.isDraft && mayBeReviewed(pr) && neverReviewed(pr),
      );
    out.updateBranch = (withAuto ?? drain())?.number ?? null;

    for (const pr of ordered) {
      if (pr.isDraft || pr.isCrossRepository || pr.mergeStateStatus !== "DIRTY") continue;
      const label = hasLabel(pr, LABELS.pr) ? REWORK_LABEL : NEEDS_HUMAN_LABEL;
      if (hasLabel(pr, label)) continue;
      out.conflicts.push({ number: pr.number, label });
    }
  }

  for (const pr of ordered) {
    if (out.dispatchReview.length >= maxDispatch) break;
    if (pr.isDraft || checksState(pr.checks) !== "green") continue;
    const status = pr.agentReview;
    let dispatch = false;
    if (!status || status.state === "pending" || status.state === "error") dispatch = true;
    else if (on && mayBeReviewed(pr) && status.state === "success" && String(status.description ?? "").startsWith("not reviewed:")) {
      dispatch = true;
    }
    if (dispatch) out.dispatchReview.push(pr.number);
  }
  return out;
}

// ---------------------------------------------------------------- command line

function usageError(message) {
  console.error(message);
  process.exit(2);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function runClassify(args) {
  const base = option(args, "--base");
  const head = option(args, "--head");
  const dial = Number(option(args, "--dial"));
  if (!base || !head || !Number.isInteger(dial) || dial < 0 || dial > 4) {
    usageError("usage: node scripts/agent-merge-policy.mjs classify --base <sha> --head <sha> --dial <0-4>");
  }
  let patch;
  try {
    patch = git(["diff", "--no-color", "--no-ext-diff", "--no-textconv", base, head]);
  } catch (error) {
    usageError(`git diff failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const show = (ref) => (file) => {
    try {
      return git(["show", `${ref}:${file}`]);
    } catch {
      return null;
    }
  };
  const verdict = classifyPatch({ patch, dial, readBefore: show(base), readAfter: show(head) });
  let patchId = "";
  try {
    patchId = patchIdOf(patch);
  } catch {
    patchId = "";
  }
  return { tier: verdict.tier, eligible: verdict.eligible, reasons: verdict.reasons, patchId, stats: verdict.stats };
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const [command, ...args] = process.argv.slice(2);
  try {
    let output;
    if (command === "classify") {
      output = runClassify(args);
    } else if (command === "gate" || command === "decide" || command === "sweep") {
      const input = JSON.parse(readFileSync(0, "utf8") || "{}");
      output = command === "gate" ? gate(input) : command === "decide" ? decide(input) : sweep(input);
    } else {
      usageError("usage: node scripts/agent-merge-policy.mjs <classify|gate|decide|sweep>");
    }
    console.log(JSON.stringify(output));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
