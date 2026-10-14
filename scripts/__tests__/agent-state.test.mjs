import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DAILY_PR_CAP,
  LABELS,
  MAX_CI_ROUNDS,
  applyEvent,
  ciRounds,
  dailyCap,
  isEligible,
} from "../agent-state.mjs";

test("an issue labelled agent-ready is eligible", () => {
  assert.deepEqual(isEligible(["bug", "agent-ready"]), { eligible: true, reason: null });
});

test("an issue without agent-ready is not eligible", () => {
  assert.deepEqual(isEligible(["bug"]), { eligible: false, reason: "missing agent-ready" });
  assert.equal(isEligible([]).eligible, false);
});

test("decision and ci issues are excluded even when labelled agent-ready", () => {
  assert.equal(isEligible(["agent-ready", "decision"]).reason, "excluded label: decision");
  assert.equal(isEligible(["agent-ready", "ci"]).reason, "excluded label: ci");
});

test("an issue already in flight is not eligible again", () => {
  for (const state of ["agent-working", "agent-pr", "agent-blocked"]) {
    const verdict = isEligible(["agent-ready", state]);
    assert.equal(verdict.eligible, false, state);
    assert.equal(verdict.reason, `already ${state}`);
  }
});

test("label matching is exact, not by substring", () => {
  assert.equal(isEligible(["agent-ready-not", "agent-ready"]).eligible, true);
  assert.equal(isEligible(["agent-readyish"]).eligible, false);
  assert.equal(isEligible(["agent-ready", "decisions"]).eligible, true);
});

test("start swaps agent-ready for agent-working and keeps other labels", () => {
  assert.deepEqual(applyEvent(["bug", "agent-ready"], "start"), ["bug", "agent-working"]);
});

test("start refuses an ineligible issue", () => {
  assert.throws(() => applyEvent(["bug"], "start"), /cannot start: missing agent-ready/);
  assert.throws(() => applyEvent(["agent-ready", "decision"], "start"), /excluded label: decision/);
});

test("pr-opened moves agent-working to agent-pr and refuses otherwise", () => {
  assert.deepEqual(applyEvent(["agent-working", "bug"], "pr-opened"), ["bug", "agent-pr"]);
  assert.throws(() => applyEvent(["agent-ready"], "pr-opened"), /missing agent-working/);
});

test("block clears every in-flight label and is idempotent", () => {
  const blocked = applyEvent(["bug", "agent-working", "agent-pr", "agent-ready"], "block");
  assert.deepEqual(blocked, ["bug", "agent-blocked"]);
  assert.deepEqual(applyEvent(blocked, "block"), ["bug", "agent-blocked"]);
});

test("an unknown event throws and the input array is never mutated", () => {
  const labels = ["agent-ready"];
  assert.throws(() => applyEvent(labels, "merge"), /unknown event: merge/);
  applyEvent(labels, "start");
  assert.deepEqual(labels, ["agent-ready"]);
});

test("label names and limits match the spec", () => {
  assert.deepEqual(LABELS, {
    ready: "agent-ready",
    working: "agent-working",
    pr: "agent-pr",
    blocked: "agent-blocked",
    readyToMerge: "ready-to-merge",
  });
  assert.equal(DAILY_PR_CAP, 3);
  assert.equal(MAX_CI_ROUNDS, 3);
});

const pr = (createdAt, labels = ["agent-pr"]) => ({ createdAt, labels });
const NOW = "2026-10-12T15:00:00Z";

test("the daily cap counts agent PRs created since 00:00 UTC", () => {
  const prs = [pr("2026-10-12T00:00:00Z"), pr("2026-10-12T09:00:00Z"), pr("2026-10-11T23:59:59Z")];
  assert.deepEqual(dailyCap({ prs, now: NOW }), { count: 2, cap: 3, reached: false });
});

test("the cap is reached at exactly the limit, not before", () => {
  const two = [pr("2026-10-12T01:00:00Z"), pr("2026-10-12T02:00:00Z")];
  assert.equal(dailyCap({ prs: two, now: NOW }).reached, false);
  const three = [...two, pr("2026-10-12T03:00:00Z")];
  assert.equal(dailyCap({ prs: three, now: NOW }).reached, true);
});

test("PRs without the agent-pr label do not count", () => {
  const prs = [pr("2026-10-12T01:00:00Z", ["bug"]), pr("2026-10-12T02:00:00Z", [])];
  assert.equal(dailyCap({ prs, now: NOW }).count, 0);
});

test("the day boundary is UTC, whatever offset the timestamps use", () => {
  const prs = [pr("2026-10-12T05:30:00+07:00")];
  assert.equal(dailyCap({ prs, now: "2026-10-12T02:00:00Z" }).count, 0);
  assert.equal(dailyCap({ prs: [pr("2026-10-12T07:30:00+07:00")], now: "2026-10-12T02:00:00Z" }).count, 1);
});

test("a custom cap is honoured and bad dates throw", () => {
  assert.equal(dailyCap({ prs: [pr("2026-10-12T01:00:00Z")], now: NOW, cap: 1 }).reached, true);
  assert.throws(() => dailyCap({ prs: [], now: "not a date" }), /invalid date/);
  assert.throws(() => dailyCap({ prs: [pr("garbage")], now: NOW }), /invalid createdAt/);
});

test("no rounds used when no commit carries the trailer", () => {
  assert.deepEqual(ciRounds({ messages: ["fix: thing", "docs: other"] }), {
    used: 0,
    max: 3,
    exhausted: false,
    next: 1,
  });
});

test("the highest round trailer wins and exhaustion starts at the maximum", () => {
  const messages = ["fix ci\n\nT3-Agent-Round: 1", "fix ci again\n\nT3-Agent-Round: 2"];
  assert.deepEqual(ciRounds({ messages }), { used: 2, max: 3, exhausted: false, next: 3 });
  const third = [...messages, "last try\n\nT3-Agent-Round: 3"];
  assert.equal(ciRounds({ messages: third }).exhausted, true);
});

test("a round trailer must be a whole line and is ignored inside prose", () => {
  assert.equal(ciRounds({ messages: ["mentions T3-Agent-Round: 3 in a sentence"] }).used, 0);
  assert.equal(ciRounds({ messages: ["body\n\nT3-Agent-Round:   2  "] }).used, 2);
  assert.equal(ciRounds({ messages: ["body\n\nT3-Agent-Round: two"] }).used, 0);
});

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-state.mjs");

function cli(command, input) {
  return execFileSync(process.execPath, [script, command], {
    input: JSON.stringify(input),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

test("the CLI answers eligible, daily-cap and rounds from JSON on stdin", () => {
  assert.deepEqual(JSON.parse(cli("eligible", { labels: ["agent-ready"] })), { eligible: true, reason: null });
  assert.equal(JSON.parse(cli("daily-cap", { prs: [], now: NOW })).reached, false);
  assert.equal(JSON.parse(cli("rounds", { messages: ["x\n\nT3-Agent-Round: 2"] })).used, 2);
});

test("the CLI exits 2 on an unknown command or bad input", () => {
  assert.throws(
    () => cli("nope", {}),
    (error) => error.status === 2 && /usage/.test(error.stderr),
  );
  assert.throws(
    () => cli("daily-cap", { prs: [], now: "bad" }),
    (error) => error.status === 2 && /invalid date/.test(error.stderr),
  );
});
