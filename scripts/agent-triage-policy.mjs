#!/usr/bin/env node
/**
 * agent-triage-policy.mjs
 *
 * Every decision of the factory issue triage, as pure functions. The workflow
 * .github/workflows/t3-agent-triage.yml only moves data in and out of these functions.
 * Work package: WP-FACTORY-002 (technical-spec/plans/2026-11-15-wp-factory-002-self-healing.md), Interface 2.
 *
 * CLI:
 *   node scripts/agent-triage-policy.mjs gate   < input.json
 *   node scripts/agent-triage-policy.mjs decide < input.json
 * JSON on stdout. Exit 0 on success, 2 on a usage error.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const MARKER_PREFIX = "t3-agent-triage v1";
export const ACCEPTANCE_HEADING = "## Acceptance criteria (factory triage)";
const SKIP_LABELS = ["factory-hold", "agent-ready", "agent-working", "agent-pr", "needs-human", "scenario-failure", "release"];
const LIMIT_SUMMARY = 600;
const LIMIT_CRITERION = 300;
const LIMIT_CRITERIA = 10;
const LIMIT_QUESTION = 600;
const LIMIT_AREA = 120;
const KINDS = ["bug", "feature", "question", "duplicate"];
const CLARITIES = ["clear", "needs-info"];
const SIZES = ["S", "M", "L"];

const CREDENTIALS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g,
];

function labelNames(labels) {
  return (labels ?? []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
}

function removeWhile(text, pattern) {
  let value = text;
  for (let guard = 0; guard < 100 && pattern.test(value); guard += 1) value = value.replace(pattern, "");
  return value;
}

// Model text is data: no HTML comments, no mentions, no credentials, one line, a length limit.
function clean(text, max) {
  let value = String(text ?? "").replace(/\r\n/g, "\n");
  value = value
    .split("\n")
    .map((line) => (line.includes("-----BEGIN") && line.includes("PRIVATE KEY-----") ? "[redacted]" : line))
    .join("\n");
  for (const pattern of CREDENTIALS) value = value.replace(pattern, "[redacted]");
  value = removeWhile(value, /<!--/);
  value = removeWhile(value, /-->/);
  value = value.replace(/(^|[^A-Za-z0-9_])@/gm, "$1@ ");
  value = value.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
  if (value.length > max) value = value.slice(0, max).trimEnd();
  return removeWhile(removeWhile(value, /<!--/), /-->/);
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

// ---------------------------------------------------------------- gate

export function gate(input) {
  const { event, issue = {}, commenter, reporters = [], cap, triagesToday } = input ?? {};
  const labels = labelNames(issue.labels);
  if (issue.state !== "open") return { mode: "skip", reason: "closed" };
  if (labels.some((label) => SKIP_LABELS.includes(label))) return { mode: "skip", reason: "already handled" };
  if (!reporters.map(lower).includes(lower(issue.author))) return { mode: "outsider", reason: "not a reporter" };
  const needsInfo = labels.includes("needs-info");
  if (event === "issue_comment" && (lower(commenter) !== lower(issue.author) || !needsInfo)) {
    return { mode: "skip", reason: "not an answer" };
  }
  if ((event === "issues" || event === "schedule") && needsInfo) {
    return { mode: "skip", reason: "waiting for the reporter" };
  }
  if (Number(triagesToday) >= Number(cap)) return { mode: "capped", reason: "daily triage cap" };
  return { mode: "triage", reason: "" };
}

// ---------------------------------------------------------------- decide

function validTriage(triage) {
  if (!triage || typeof triage !== "object") return false;
  return (
    KINDS.includes(triage.kind) &&
    CLARITIES.includes(triage.clarity) &&
    SIZES.includes(triage.size) &&
    typeof triage.decision_needed === "boolean" &&
    typeof triage.summary === "string" &&
    Array.isArray(triage.acceptance_criteria) &&
    triage.acceptance_criteria.every((item) => typeof item === "string") &&
    typeof triage.affected_area === "string" &&
    Number.isInteger(triage.duplicate_of) &&
    typeof triage.question === "string"
  );
}

function marker(issueNumber, decision, date) {
  const n = Number.isInteger(Number(issueNumber)) ? Number(issueNumber) : 0;
  const safeDecision = /^[a-z-]+$/.test(String(decision)) ? decision : "error";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "")) ? date : "0000-00-00";
  return `<!-- ${MARKER_PREFIX} issue=${n} decision=${safeDecision} date=${safeDate} -->`;
}

function withMarker(text, issueNumber, decision, date) {
  return `${text}\n\n${marker(issueNumber, decision, date)}`;
}

function result(decision, fields = {}) {
  return {
    decision,
    addLabels: [],
    removeLabels: [],
    appendBody: null,
    comment: null,
    close: null,
    notify: null,
    ...fields,
  };
}

function acceptanceBlock(triage) {
  const criteria = triage.acceptance_criteria
    .slice(0, LIMIT_CRITERIA)
    .map((item) => clean(item, LIMIT_CRITERION))
    .filter(Boolean);
  const lines = [
    "",
    "",
    ACCEPTANCE_HEADING,
    "",
    `Summary: ${clean(triage.summary, LIMIT_SUMMARY)}`,
    "",
    ...criteria.map((item) => `- [ ] ${item}`),
    "",
    `Area: ${clean(triage.affected_area, LIMIT_AREA)}. Size: ${triage.size}.`,
    "",
  ];
  return lines.join("\n");
}

export function decide(input) {
  const { mode, issue = {}, triage, triageJob, date } = input ?? {};
  const labels = labelNames(issue.labels);
  const n = issue.number;
  const needsTriage = labels.includes("needs-triage") ? [] : ["needs-triage"];

  if (mode === "outsider") return result("outsider", { addLabels: needsTriage });
  if (mode === "capped") return result("capped", { addLabels: needsTriage });

  if (triageJob !== "success" || !validTriage(triage)) return result("error", { addLabels: needsTriage });

  const clear = ["needs-triage", "needs-info"];

  if (triage.kind === "duplicate" && triage.duplicate_of > 0) {
    return result("duplicate", {
      addLabels: ["duplicate"],
      removeLabels: clear,
      comment: withMarker(
        `This looks like #${triage.duplicate_of}. Closed as a duplicate. Reopen it if it is different.`,
        n,
        "duplicate",
        date,
      ),
      close: { reason: "not planned" },
    });
  }

  if (triage.clarity === "needs-info") {
    const question = clean(triage.question, LIMIT_QUESTION) || "Can you describe what you did and what you expected to see?";
    return result("needs-info", {
      addLabels: ["needs-info"],
      removeLabels: ["needs-triage"],
      comment: withMarker(`${question}\n\nAnswer in a comment. The factory reads it again.`, n, "needs-info", date),
    });
  }

  if (triage.size === "L" || triage.decision_needed || triage.kind === "question") {
    const summary = clean(triage.summary, LIMIT_SUMMARY);
    const question = clean(triage.question, LIMIT_QUESTION);
    const decisionText = question ? ` The owner must decide: ${question}` : " The owner must decide how to proceed.";
    return result("needs-human", {
      addLabels: ["needs-human"],
      removeLabels: clear,
      comment: withMarker(`A person has to look at this first. ${summary}${decisionText}`, n, "needs-human", date),
      notify: `Issue #${n} needs the owner: ${summary}`.slice(0, 1900),
    });
  }

  const isCanary = String(issue.title ?? "").startsWith("[factory-canary]");
  const addLabels = [isCanary ? "factory-canary" : "agent-ready"];
  if (String(issue.body ?? "").includes("Blocks my work")) addLabels.push("severity:critical");
  const alreadyHasBlock = String(issue.body ?? "").includes(ACCEPTANCE_HEADING);
  return result("agent-ready", {
    addLabels,
    removeLabels: clear,
    appendBody: alreadyHasBlock ? null : acceptanceBlock(triage),
    comment: withMarker(
      "Triaged: an agent will work on this. Acceptance criteria were added to the description.",
      n,
      "agent-ready",
      date,
    ),
  });
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const [command] = process.argv.slice(2);
  try {
    if (command !== "gate" && command !== "decide") {
      console.error("usage: node scripts/agent-triage-policy.mjs <gate|decide>");
      process.exit(2);
    }
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    console.log(JSON.stringify(command === "gate" ? gate(input) : decide(input)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
