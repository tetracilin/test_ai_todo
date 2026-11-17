#!/usr/bin/env node
/**
 * agent-review-render.mjs
 *
 * Turns a gate decision into the Markdown comment that t3-agent-review posts on a
 * pull request. Reads {"input": <decide input>, "decision": <decide output>} on stdin
 * and prints the comment. It prints nothing for the silent cases: modes human,
 * capped, carry and skip, and a review run where the reviewer was unavailable.
 * Work package: WP-FACTORY-001, interface 2.
 *
 * Text from `input.review` comes from a model that read untrusted input, and the
 * comment is public. Every piece of dynamic text goes through `clean()` first.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ciRounds } from "./agent-state.mjs";

const LIMIT_TEXT = 600;
const LIMIT_TITLE = 120;
const LIMIT_LIST = 20;

const CREDENTIALS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g,
];

function removeWhile(text, pattern) {
  let value = text;
  for (let guard = 0; guard < 100 && pattern.test(value); guard += 1) {
    value = value.replace(pattern, "");
  }
  return value;
}

function clean(text, max = LIMIT_TEXT) {
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
  // Cutting can split a token such as "<!-" + "-"; clean once more.
  value = removeWhile(removeWhile(value, /<!--/), /-->/);
  return value;
}

function safeToken(value, fallback) {
  const text = String(value ?? "");
  return /^[A-Za-z0-9_.-]+$/.test(text) ? text : fallback;
}

function marker(input, decision, mode) {
  const sha = /^[0-9a-f]{40}$/.test(String(input.sha ?? "")) ? input.sha : "0".repeat(40);
  const patch = safeToken(input.policy?.patchId, "") || "none";
  const verdict = ["PASS", "FAIL", "NEEDS_HUMAN", "NONE"].includes(decision.verdict) ? decision.verdict : "NONE";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? "")) ? input.date : "1970-01-01";
  return `<!-- t3-agent-review v1 sha=${sha} patch=${patch} verdict=${verdict} mode=${mode} date=${date} -->`;
}

function hasLabel(pr, name) {
  return (pr?.labels ?? []).some((label) => (typeof label === "string" ? label : label?.name) === name);
}

function location(finding) {
  if (!finding.file) return "";
  const where = finding.line ? `${clean(finding.file, LIMIT_TITLE)}:${Number(finding.line)}` : clean(finding.file, LIMIT_TITLE);
  return ` \`${where.replace(/`/g, "")}\``;
}

function findingLine(finding) {
  const text = `${clean(finding.title, LIMIT_TITLE)}. ${clean(finding.detail, LIMIT_TEXT)}`;
  if (finding.severity === "blocking") return `- **blocking**${location(finding)} - ${text}`;
  if (finding.severity === "pre-existing") return `- pre-existing - ${text}`;
  return `- note${location(finding)} - ${text}`;
}

function nextStep(input, decision) {
  const { verdict } = decision;
  if (verdict === "PASS") {
    if (decision.enableAutoMerge) {
      return "Auto-merge is on. GitHub merges this when the branch is up to date and every check is green. To undo it after the merge, use the Revert button on this pull request.";
    }
    const reasons = (input.policy?.reasons ?? []).map((reason) => clean(reason, LIMIT_TEXT)).join("; ") || "it is not eligible for automatic merge";
    return `This passed review. It waits for the owner because: ${reasons}. Merge it with the Merge button.`;
  }
  if (verdict === "FAIL") {
    if (hasLabel(input.pr, "agent-pr") && decision.addLabels.includes("agent-rework")) {
      const rounds = ciRounds({ messages: input.messages ?? [] });
      return `Sent back to the agent, round ${rounds.next} of ${rounds.max}. Fix only the blocking findings.`;
    }
    return "This waits for the owner.";
  }
  if (verdict === "NEEDS_HUMAN") {
    const findings = input.review?.findings ?? [];
    const first = findings.find((f) => f.severity === "blocking") ?? findings.find((f) => f.severity === "note");
    const what = first ? `${clean(first.title, LIMIT_TITLE)}. ${clean(first.detail, LIMIT_TEXT)}` : clean(input.review?.summary);
    return `The reviewer could not decide. What the owner has to decide: ${what}`;
  }
  return "";
}

export function renderComment({ input, decision }) {
  if (!input || !decision) return "";
  const { mode } = input;
  if (["human", "capped", "carry", "skip"].includes(mode)) return "";
  if (mode === "review" && decision.state === "error") return "";

  if (mode === "override") {
    return [
      "## Factory review: owner override",
      "",
      `Owner override by ${clean(input.actor, LIMIT_TITLE)}. The owner accepts this change.`,
      "",
      marker(input, decision, "override"),
      "",
    ].join("\n");
  }

  if (mode === "rework-ci") {
    return [
      "## Factory review: t3-ci failed",
      "",
      `The checks failed: ${clean(input.ciUrl, 300)}`,
      "",
      "### What happens next",
      "",
      nextStep(input, decision),
      "",
      marker(input, decision, "ci"),
      "",
    ].join("\n");
  }

  if (mode === "drill") {
    return [
      `## Factory review: ${decision.verdict} (drill)`,
      "",
      "This is a drill. No model was called.",
      "",
      "### What happens next",
      "",
      nextStep(input, decision),
      "",
      marker(input, decision, "drill"),
      "",
    ].join("\n");
  }

  const review = input.review ?? {};
  let heading;
  if (decision.verdict === "PASS") heading = decision.enableAutoMerge ? "PASS - merges automatically" : "PASS - waits for the owner";
  else heading = decision.verdict;

  const parts = [`## Factory review: ${heading}`, ""];
  const paragraph = (label, text) => {
    const value = clean(text);
    if (value) parts.push(`**${label}.** ${value}`, "");
  };
  paragraph("What this change does", review.summary);
  paragraph("What users will notice", review.user_impact);
  const risk = ["low", "medium", "high"].includes(review.risk) ? review.risk : "unknown";
  parts.push(`**Risk.** ${risk} (reviewer) - tier \`${safeToken(input.policy?.tier, "unknown")}\`, dial ${Number(input.dial)}.`, "");
  paragraph("What could go wrong", review.what_could_go_wrong);

  const acceptance = (review.acceptance ?? []).slice(0, LIMIT_LIST);
  if (acceptance.length > 0) {
    parts.push("### Acceptance criteria", "");
    for (const entry of acceptance) {
      parts.push(`- [${entry.met === true ? "x" : " "}] ${clean(entry.criterion, LIMIT_TEXT)} - ${clean(entry.evidence, LIMIT_TEXT)}`);
    }
    parts.push("");
  }

  const findings = (review.findings ?? []).slice(0, LIMIT_LIST);
  if (findings.length > 0) {
    parts.push("### Findings", "");
    for (const finding of findings) parts.push(findingLine(finding));
    parts.push("");
  }

  parts.push("### What happens next", "", nextStep(input, decision), "", marker(input, decision, "claude"), "");
  return parts.join("\n");
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const parsed = JSON.parse(readFileSync(0, "utf8") || "{}");
    process.stdout.write(renderComment(parsed));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
