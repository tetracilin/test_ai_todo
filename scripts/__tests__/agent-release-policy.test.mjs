import assert from "node:assert/strict";
import test from "node:test";

import { decide, nextTag } from "../agent-release-policy.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const ok = (over = {}) => ({
  automation: "on",
  dial: 4,
  sha: SHA,
  onDevelop: true,
  nightlyOk: true,
  scenarios: { sha: SHA, critical: 3, failed: 0 },
  openCritical: 0,
  openReleasePr: false,
  mainOnlyCommits: 0,
  lastReleaseAt: "2026-11-18T23:30:00Z",
  now: "2026-11-20T00:30:00Z",
  window: "23-03",
  tags: ["v0.1.0", "v0.2"],
  tagsAtSha: [],
  ...over,
});
const hold = (over, reason) => {
  const r = decide(ok(over));
  assert.equal(r.action, "hold");
  assert.equal(r.reason, reason);
  assert.equal(r.tag, null);
  return r;
};

test("row 14: release", () => {
  const r = decide(ok());
  assert.equal(r.action, "release");
  assert.equal(r.reason, "");
  assert.equal(r.tag, "v0.2.1");
  assert.equal(r.notify, `Releasing v0.2.1 (${SHA.slice(0, 7)}) to production.`);
});
test("row 1: automation off", () => {
  const r = hold({ automation: "off", dial: 2 }, "automation off");
  assert.equal(r.notify, null);
});
test("row 2: dial below 4", () => {
  const r = hold({ dial: 3 }, "dial 3: production waits for the owner");
  assert.equal(r.notify, `Version ${SHA.slice(0, 7)} passed every scenario. Release it by hand or set the dial to 4.`);
  assert.equal(decide(ok({ dial: "3" })).reason, "dial 3: production waits for the owner");
});
test("row 3: version mismatch", () => {
  assert.equal(hold({ onDevelop: false }, "version mismatch").notify, null);
  hold({ scenarios: { sha: "f".repeat(40), critical: 1, failed: 0 } }, "version mismatch");
});
test("row 4: nightly not ok", () => {
  assert.equal(hold({ nightlyOk: false }, "nightly not green for this version").notify, null);
});
test("row 5: no critical scenario", () => {
  const r = hold({ scenarios: { sha: SHA, critical: 0, failed: 0 } }, "no confirmed critical scenario");
  assert.ok(r.notify);
});
test("row 6: a scenario failed", () => {
  assert.equal(hold({ scenarios: { sha: SHA, critical: 2, failed: 1 } }, "a scenario failed").notify, null);
});
test("row 7: open critical", () => {
  hold({ openCritical: 1 }, "open severity:critical issue");
});
test("row 8: release pr open", () => {
  hold({ openReleasePr: true }, "release pull request already open");
});
test("row 9: main only commits", () => {
  assert.ok(hold({ mainOnlyCommits: 2 }, "main has commits that develop does not have").notify);
});
test("row 10: already released", () => {
  hold({ tagsAtSha: ["v0.2.0"] }, "already released");
});
test("row 11: one release a day", () => {
  hold({ lastReleaseAt: "2026-11-19T20:30:01Z" }, "one release a day");
  assert.equal(decide(ok({ lastReleaseAt: "2026-11-19T04:30:00Z" })).action, "release");
  assert.equal(decide(ok({ lastReleaseAt: null })).action, "release");
});
test("row 12: window edges and midnight wrap", () => {
  const at = (now) => decide(ok({ now, lastReleaseAt: null })).action;
  assert.equal(at("2026-11-20T22:59:59Z"), "hold");
  assert.equal(at("2026-11-20T23:00:00Z"), "release");
  assert.equal(at("2026-11-20T23:59:59Z"), "release");
  assert.equal(at("2026-11-21T00:00:00Z"), "release");
  assert.equal(at("2026-11-21T02:59:59Z"), "release");
  assert.equal(at("2026-11-21T03:00:00Z"), "hold");
  assert.equal(at("2026-11-21T12:00:00Z"), "hold");
  hold({ now: "2026-11-21T12:00:00Z", lastReleaseAt: null }, "outside the release window");
});
test("row 12: non-wrapping window", () => {
  const at = (now) => decide(ok({ now, window: "9-17", lastReleaseAt: null })).action;
  assert.equal(at("2026-11-20T08:59:00Z"), "hold");
  assert.equal(at("2026-11-20T09:00:00Z"), "release");
  assert.equal(at("2026-11-20T17:00:00Z"), "hold");
});
test("row 13: no version tag", () => {
  assert.ok(hold({ tags: ["legacy/spa-final"] }, "no version tag found").notify);
  hold({ tags: [] }, "no version tag found");
});
test("first match wins", () => {
  assert.equal(decide(ok({ automation: "off", dial: 1, nightlyOk: false })).reason, "automation off");
  assert.equal(decide(ok({ dial: 2, nightlyOk: false })).reason, "dial 2: production waits for the owner");
});

test("nextTag", () => {
  assert.equal(nextTag(["v0.1.0"]), "v0.1.1");
  assert.equal(nextTag(["v0.2"]), "v0.2.1");
  assert.equal(nextTag(["v0.10.0", "v0.9.9", "v0.2"]), "v0.10.1");
  assert.equal(nextTag(["v0.10.3"]), "v0.10.4");
  assert.equal(nextTag(["legacy/spa-final", "v0.1.0"]), "v0.1.1");
  assert.equal(nextTag(["legacy/spa-final"]), null);
  assert.equal(nextTag([]), null);
  assert.equal(nextTag(["v1.0.0", "v0.99.99"]), "v1.0.1");
});
