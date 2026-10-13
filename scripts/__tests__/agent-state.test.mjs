import assert from "node:assert/strict";
import test from "node:test";

import { DAILY_PR_CAP, LABELS, MAX_CI_ROUNDS, applyEvent, isEligible } from "../agent-state.mjs";

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
