import assert from "node:assert/strict";
import test from "node:test";

import { decide } from "../agent-breaker-policy.mjs";

const zero = { reverts7d: 0, rollbacks7d: 0, openCritical: 0, scenarioIssues24h: 0, blocked7d: 0 };
const run = (stats = {}, over = {}) => decide({ dial: 4, stats: { ...zero, ...stats }, hourUtc: 5, ...over });

test("no limit: unchanged", () => {
  const r = run();
  assert.equal(r.targetDial, 4);
  assert.equal(r.changed, false);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.report, null);
});
test("rollback limit: dial 3", () => {
  const r = run({ rollbacks7d: 1 });
  assert.equal(r.targetDial, 3);
  assert.equal(r.changed, true);
  assert.equal(r.reasons.length, 1);
});
for (const [name, stats] of [
  ["reverts", { reverts7d: 2 }],
  ["critical", { openCritical: 3 }],
  ["scenario issues", { scenarioIssues24h: 5 }],
  ["blocked", { blocked7d: 3 }],
]) {
  test(`${name} limit alone: dial 2`, () => {
    const r = run(stats);
    assert.equal(r.targetDial, 2);
    assert.equal(r.changed, true);
    assert.equal(r.reasons.length, 1);
  });
}
test("just below each limit does nothing", () => {
  const r = run({ reverts7d: 1, openCritical: 2, scenarioIssues24h: 4, blocked7d: 2 });
  assert.equal(r.changed, false);
});
test("two limits: the lowest wins and both reasons are listed", () => {
  const r = run({ rollbacks7d: 2, reverts7d: 3 });
  assert.equal(r.targetDial, 2);
  assert.equal(r.reasons.length, 2);
});
test("never raises the dial", () => {
  const r = run({ rollbacks7d: 1 }, { dial: 1 });
  assert.equal(r.targetDial, 1);
  assert.equal(r.changed, false);
  assert.equal(run({}, { dial: 0 }).targetDial, 0);
  assert.equal(run({ rollbacks7d: 1 }, { dial: 3 }).changed, false);
  assert.equal(run({ rollbacks7d: 1 }, { dial: "3" }).targetDial, 3);
});
test("report only at hour 0", () => {
  assert.equal(run({}, { hourUtc: 1 }).report, null);
  const r = run({ rollbacks7d: 1 }, { hourUtc: 0, automation: "on" });
  assert.equal(typeof r.report, "string");
  assert.match(r.report, /dial/i);
  assert.match(r.report, /rollbacks7d/);
  assert.match(r.report, /automation/i);
});
test("report is at most 1900 characters", () => {
  const r = run({ rollbacks7d: 1e6, reverts7d: 1e6 }, { hourUtc: 0, automation: "x".repeat(5000) });
  assert.ok(r.report.length <= 1900);
});
