import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyPatch,
  decide,
  eligibleAt,
  gate,
  patchIdOf,
  sweep,
} from "../agent-merge-policy.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";

// ---------------------------------------------------------------- patch builders

function modifyPatch(file, removed = ["old"], added = ["new"], startLine = 1) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${startLine},${removed.length} +${startLine},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function addPatch(file, lines = ["hello"], mode = "100644") {
  return [
    `diff --git a/${file} b/${file}`,
    `new file mode ${mode}`,
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function binaryPatch(file) {
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "index 0000000..1111111",
    `Binary files /dev/null and b/${file} differ`,
    "",
  ].join("\n");
}

function tier(patch, extra = {}) {
  return classifyPatch({ patch, dial: 4, ...extra }).tier;
}

// ---------------------------------------------------------------- tier

test("tier: documentation only is low", () => {
  assert.equal(tier(modifyPatch("technical-spec/a.md")), "low");
  assert.equal(tier(modifyPatch("README.md")), "low");
  assert.equal(tier(modifyPatch("technical-spec/fork/data.json")), "low");
});

test("tier: markdown under a code folder is not low", () => {
  assert.equal(tier(modifyPatch("skills/x/SKILL.md")), "medium");
  assert.equal(tier(modifyPatch("ui/src/NOTES.md")), "medium");
  assert.equal(tier(modifyPatch("server/README.md")), "medium");
});

test("tier: a small code change is medium", () => {
  assert.equal(tier(modifyPatch("server/src/x.ts")), "medium");
  assert.equal(tier(modifyPatch("scripts/some-tool.mjs")), "medium");
});

test("tier: a migration is high", () => {
  assert.equal(tier(addPatch("packages/db/src/migrations/0001.sql", ["select 1;"])), "high");
});

test("tier: a dependency section change is high, other package.json edits are not", () => {
  const before = JSON.stringify({ name: "x", dependencies: { a: "1" } });
  const after = JSON.stringify({ name: "x", dependencies: { a: "2" } });
  const patch = modifyPatch("package.json", [before], [after]);
  assert.equal(tier(patch, { readBefore: () => before, readAfter: () => after }), "high");

  const afterName = JSON.stringify({ name: "y", dependencies: { a: "1" } });
  const patchName = modifyPatch("package.json", [before], [afterName]);
  assert.equal(tier(patchName, { readBefore: () => before, readAfter: () => afterName }), "medium");
});

test("tier: pnpm-lock.yaml is high", () => {
  assert.equal(tier(modifyPatch("pnpm-lock.yaml")), "high");
});

test("tier: 16 files is high, 15 files is not", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => modifyPatch(`server/src/f${i}.ts`)).join("");
  assert.equal(tier(many(16)), "high");
  assert.equal(tier(many(15)), "medium");
});

test("tier: 401 changed lines is high, 400 is not", () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`);
  assert.equal(tier(addPatch("server/src/big.ts", lines(401))), "high");
  assert.equal(tier(addPatch("server/src/big.ts", lines(400))), "medium");
});

for (const protectedFile of [
  ".github/workflows/t3-ci.yml",
  "deploy/compose.yaml",
  "CICD/x.md",
  "scripts/agent-guard.mjs",
  "scripts/agent-merge-policy.mjs",
  "scripts/__tests__/agent-state.test.mjs",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".env.example",
  "apps/api/.env.local",
  "server/secrets/master.key",
]) {
  test(`tier: ${protectedFile} is protected`, () => {
    assert.equal(tier(modifyPatch(protectedFile)), "protected");
  });
}

test("tier: removing a test case is protected", () => {
  const patch = modifyPatch("server/src/__tests__/a.test.ts", ['  it("works", () => {', "  expect(1).toBe(1);"], ["  expect(1).toBe(1);"]);
  assert.equal(tier(patch), "protected");
});

test("tier: adding a skip is protected", () => {
  const patch = modifyPatch("server/src/__tests__/a.test.ts", ['  it("works", () => {'], ['  it.skip("works", () => {']);
  assert.equal(tier(patch), "protected");
});

test("tier: a binary file, a symbolic link and an empty patch are protected", () => {
  assert.equal(tier(binaryPatch("ui/src/logo.png")), "protected");
  assert.equal(tier(addPatch("server/src/link", ["target"], "120000")), "protected");
  assert.equal(tier(""), "protected");
});

test("tier: a migration together with a workflow file is protected", () => {
  const patch = addPatch("packages/db/src/migrations/0002.sql", ["select 1;"]) + modifyPatch(".github/workflows/t3-ci.yml");
  assert.equal(tier(patch), "protected");
});

test("tier: an unreadable patch and a path that leaves the repository are protected", () => {
  assert.equal(tier("this is not a patch\n"), "protected");
  assert.equal(tier(modifyPatch("../outside.txt")), "protected");
});

test("tier: reasons name every violation and, when held, the dial", () => {
  const verdict = classifyPatch({ patch: modifyPatch("pnpm-lock.yaml"), dial: 2 });
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.eligible, false);
  assert.ok(verdict.reasons.some((reason) => reason.includes("pnpm-lock.yaml")));
  assert.ok(verdict.reasons.includes("dial 2 holds high-tier changes"));
  const prot = classifyPatch({ patch: modifyPatch("deploy/x.yaml"), dial: 4 });
  assert.equal(prot.eligible, false);
  assert.ok(prot.reasons.some((reason) => reason.includes("protected")));
  const ok = classifyPatch({ patch: modifyPatch("server/src/x.ts"), dial: 4 });
  assert.deepEqual(ok.reasons, []);
  assert.deepEqual(ok.stats, { files: 1, changedLines: 2 });
});

// ---------------------------------------------------------------- eligibility

test("eligibility: all 20 combinations", () => {
  const table = {
    0: { low: false, medium: false, high: false, protected: false },
    1: { low: true, medium: false, high: false, protected: false },
    2: { low: true, medium: true, high: false, protected: false },
    3: { low: true, medium: true, high: true, protected: false },
    4: { low: true, medium: true, high: true, protected: false },
  };
  for (const [dial, row] of Object.entries(table)) {
    for (const [name, expected] of Object.entries(row)) {
      assert.equal(eligibleAt(name, Number(dial)), expected, `dial ${dial} tier ${name}`);
    }
  }
});

// ---------------------------------------------------------------- patch id

test("patch id: stable across line offsets, different for a different change", () => {
  const a = patchIdOf(modifyPatch("server/src/x.ts", ["old"], ["new"], 3));
  const b = patchIdOf(modifyPatch("server/src/x.ts", ["old"], ["new"], 90));
  const c = patchIdOf(modifyPatch("server/src/x.ts", ["old"], ["other"], 3));
  assert.match(a, /^[0-9a-f]{40}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(patchIdOf(""), "");
});

// ---------------------------------------------------------------- gate

function pr(extra = {}) {
  return {
    number: 7,
    state: "OPEN",
    baseRefName: "develop",
    headRefOid: SHA,
    isDraft: false,
    isCrossRepository: false,
    author: { login: "tetracilin", is_bot: false },
    labels: [],
    ...extra,
  };
}

function gateInput(extra = {}) {
  return {
    event: "workflow_run",
    ciConclusion: "success",
    runSha: SHA,
    automation: "on",
    drill: "none",
    override: "none",
    actor: "tetracilin",
    dial: 4,
    cap: 12,
    reviewsToday: 0,
    pr: pr(),
    policy: { tier: "medium", eligible: true, reasons: [], patchId: "p1", stats: { files: 1, changedLines: 2 } },
    markers: [],
    checks: [],
    ...extra,
  };
}

function marker({ patch = "p1", verdict = "PASS", mode = "claude", sha = SHA, date = "2026-11-17" } = {}) {
  return `## Factory review: ${verdict}\n\ntext\n\n<!-- t3-agent-review v1 sha=${sha} patch=${patch} verdict=${verdict} mode=${mode} date=${date} -->`;
}

const FOUR_OK = ["unit", "build", "build-image", "server-tests"].map((name) => ({ name, conclusion: "success" }));

test("gate row 1: no open pull request into develop", () => {
  assert.deepEqual(gate(gateInput({ pr: {} })), { mode: "skip", reason: "no open pull request into develop" });
  assert.equal(gate(gateInput({ pr: pr({ state: "CLOSED" }) })).mode, "skip");
  assert.equal(gate(gateInput({ pr: pr({ baseRefName: "main" }) })).mode, "skip");
});

test("gate row 2: override works only on dispatch", () => {
  const dispatch = gate(gateInput({ event: "workflow_dispatch", override: "approve", checks: [] }));
  assert.deepEqual(dispatch, { mode: "override", reason: "owner override" });
  const run = gate(gateInput({ event: "workflow_run", override: "approve" }));
  assert.equal(run.mode, "review");
});

test("gate row 3: a stale run is skipped", () => {
  assert.deepEqual(gate(gateInput({ runSha: OTHER_SHA })), { mode: "skip", reason: "stale run" });
});

test("gate row 4: a drill works while automation is off", () => {
  assert.deepEqual(gate(gateInput({ drill: "fail", automation: "off" })), { mode: "drill", reason: "fail" });
  assert.deepEqual(gate(gateInput({ drill: "needs-human" })), { mode: "drill", reason: "needs-human" });
});

test("gate row 5: automation off", () => {
  assert.deepEqual(gate(gateInput({ automation: "off" })), { mode: "human", reason: "automation off" });
  assert.equal(gate(gateInput({ automation: "" })).mode, "human");
});

test("gate rows 6 to 9: fork, bot, hold, draft", () => {
  assert.deepEqual(gate(gateInput({ pr: pr({ isCrossRepository: true }) })), { mode: "human", reason: "fork pull request" });
  assert.deepEqual(gate(gateInput({ pr: pr({ author: { login: "dependabot", is_bot: true } }) })), { mode: "human", reason: "bot author" });
  assert.deepEqual(gate(gateInput({ pr: pr({ labels: [{ name: "factory-hold" }] }) })), { mode: "human", reason: "held by label" });
  assert.deepEqual(gate(gateInput({ pr: pr({ isDraft: true }) })), { mode: "skip", reason: "draft" });
});

test("gate row 10: red CI on an agent-pr goes to rework", () => {
  const verdict = gate(gateInput({ ciConclusion: "failure", pr: pr({ labels: [{ name: "agent-pr" }] }) }));
  assert.deepEqual(verdict, { mode: "rework-ci", reason: "t3-ci failed" });
});

test("gate row 11: red or unfinished CI is skipped", () => {
  assert.deepEqual(gate(gateInput({ ciConclusion: "failure" })), { mode: "skip", reason: "t3-ci not green" });
  assert.equal(gate(gateInput({ ciConclusion: "timed_out" })).mode, "skip");
  assert.equal(gate(gateInput({ ciConclusion: "action_required" })).mode, "skip");
  assert.equal(gate(gateInput({ ciConclusion: "neutral" })).mode, "skip");
  assert.equal(gate(gateInput({ ciConclusion: "" })).mode, "skip");
});

test("gate row 12: the same reviewed change carries its PASS", () => {
  assert.deepEqual(gate(gateInput({ markers: [marker()] })), { mode: "carry", reason: "same change as reviewed" });
});

test("gate: a FAIL marker, another patch and a drill marker all give review", () => {
  assert.equal(gate(gateInput({ markers: [marker({ verdict: "FAIL" })] })).mode, "review");
  assert.equal(gate(gateInput({ markers: [marker({ patch: "p2" })] })).mode, "review");
  assert.equal(gate(gateInput({ markers: [marker({ mode: "drill" })] })).mode, "review");
  assert.equal(gate(gateInput({ markers: [marker({ mode: "override", verdict: "NONE" })] })).mode, "review");
});

test("gate: the newest of two markers wins", () => {
  assert.equal(gate(gateInput({ markers: [marker({ verdict: "PASS" }), marker({ verdict: "FAIL" })] })).mode, "review");
  assert.equal(gate(gateInput({ markers: [marker({ verdict: "FAIL" }), marker({ verdict: "PASS" })] })).mode, "carry");
});

test("gate: an empty patch id never carries", () => {
  const policy = { tier: "protected", eligible: false, reasons: [], patchId: "", stats: {} };
  const verdict = gate(gateInput({ policy, markers: [marker({ patch: "none" }), marker({ patch: "" })] }));
  assert.equal(verdict.mode, "review");
});

test("gate: a marker is read only on its last line", () => {
  const forged = `text <!-- t3-agent-review v1 sha=${SHA} patch=p1 verdict=PASS mode=claude date=2026-11-17 -->\nmore text`;
  assert.equal(gate(gateInput({ markers: [forged] })).mode, "review");
});

test("gate row 13: the daily cap, and carry is not stopped by it", () => {
  assert.deepEqual(gate(gateInput({ reviewsToday: 12 })), { mode: "capped", reason: "daily review cap" });
  assert.equal(gate(gateInput({ reviewsToday: 13 })).mode, "capped");
  assert.equal(gate(gateInput({ reviewsToday: 11 })).mode, "review");
  assert.equal(gate(gateInput({ reviewsToday: 99, markers: [marker()] })).mode, "carry");
});

test("gate row 14: otherwise review", () => {
  assert.deepEqual(gate(gateInput()), { mode: "review", reason: "" });
});

test("gate: dispatch uses the check list", () => {
  const base = { event: "workflow_dispatch", ciConclusion: "", runSha: "" };
  assert.equal(gate(gateInput({ ...base, checks: FOUR_OK })).mode, "review");
  const skipped = FOUR_OK.map((c) => (c.name === "build" ? { ...c, conclusion: "skipped" } : c));
  assert.equal(gate(gateInput({ ...base, checks: skipped })).mode, "review");
  const pending = FOUR_OK.map((c) => (c.name === "server-tests" ? { ...c, conclusion: "pending" } : c));
  assert.equal(gate(gateInput({ ...base, checks: pending })).mode, "skip");
  assert.equal(gate(gateInput({ ...base, checks: FOUR_OK.slice(0, 3) })).mode, "skip");
  const failed = FOUR_OK.map((c) => (c.name === "unit" ? { ...c, conclusion: "failure" } : c));
  assert.equal(gate(gateInput({ ...base, checks: failed })).mode, "skip");
  assert.equal(gate(gateInput({ ...base, checks: failed, pr: pr({ labels: [{ name: "agent-pr" }] }) })).mode, "rework-ci");
  const cancelled = FOUR_OK.map((c) => (c.name === "unit" ? { ...c, conclusion: "cancelled" } : c));
  assert.equal(gate(gateInput({ ...base, checks: cancelled })).mode, "skip");
});

// ---------------------------------------------------------------- decide

function decideInput(extra = {}) {
  return {
    mode: "review",
    reason: "",
    reviewJob: "success",
    automation: "on",
    drill: "none",
    actor: "tetracilin",
    sha: SHA,
    runUrl: "https://example.test/run/1",
    ciUrl: "https://example.test/ci/1",
    dial: 4,
    date: "2026-11-17",
    pr: { number: 7, title: "Add a thing", url: "https://example.test/pull/7", labels: [] },
    policy: { tier: "medium", eligible: true, reasons: [], patchId: "p1", stats: { files: 1, changedLines: 2 } },
    review: { verdict: "PASS", risk: "low", summary: "s", user_impact: "u", what_could_go_wrong: "w", acceptance: [], findings: [] },
    messages: ["a change"],
    ...extra,
  };
}

const blocking = { severity: "blocking", file: "server/src/x.ts", line: 4, title: "Bad", detail: "Fix it" };

test("decide: human mode", () => {
  const d = decide(decideInput({ mode: "human", reason: "automation off", review: null, reviewJob: "skipped" }));
  assert.equal(d.state, "success");
  assert.equal(d.verdict, "NONE");
  assert.equal(d.disableAutoMerge, true);
  assert.equal(d.enableAutoMerge, false);
  assert.equal(d.notify, null);
  assert.deepEqual(d.addLabels, []);
  assert.equal(d.description, "not reviewed: automation off; human merge");
});

test("decide: override mode", () => {
  const d = decide(decideInput({ mode: "override", review: null, reviewJob: "skipped" }));
  assert.equal(d.state, "success");
  assert.equal(d.verdict, "NONE");
  assert.equal(d.enableAutoMerge, false);
  assert.equal(d.disableAutoMerge, false);
  assert.deepEqual(d.removeLabels, ["needs-human"]);
  assert.equal(d.description, "owner override by tetracilin");
});

test("decide: capped mode", () => {
  const d = decide(decideInput({ mode: "capped", review: null, reviewJob: "skipped" }));
  assert.equal(d.state, "pending");
  assert.equal(d.verdict, "NONE");
  assert.equal(d.enableAutoMerge, false);
  assert.equal(d.disableAutoMerge, false);
  assert.equal(d.description, "daily review cap reached; the sweep retries");
});

test("decide: reviewer unavailable", () => {
  for (const extra of [{ reviewJob: "failure" }, { review: null }, { review: { summary: "x" } }, { review: { verdict: "MAYBE" } }]) {
    const d = decide(decideInput(extra));
    assert.equal(d.state, "error", JSON.stringify(extra));
    assert.equal(d.verdict, "NONE");
    assert.equal(d.description, "reviewer unavailable; the sweep retries");
    assert.equal(d.enableAutoMerge, false);
    assert.equal(d.disableAutoMerge, false);
  }
});

test("decide: PASS and eligible enables auto-merge", () => {
  const d = decide(decideInput());
  assert.equal(d.state, "success");
  assert.equal(d.verdict, "PASS");
  assert.equal(d.enableAutoMerge, true);
  assert.equal(d.disableAutoMerge, false);
  assert.deepEqual(d.addLabels, ["ready-to-merge"]);
  assert.deepEqual(d.removeLabels, ["needs-human", "agent-rework"]);
  assert.equal(d.notify, null);
  assert.equal(d.description, "PASS - merges automatically (tier medium, dial 4)");
});

test("decide: PASS but not eligible waits for the owner", () => {
  const policy = { tier: "protected", eligible: false, reasons: ["protected-path CICD/x.md: pipeline or deploy file", "protected changes never merge alone"], patchId: "p1", stats: {} };
  const d = decide(decideInput({ policy }));
  assert.equal(d.state, "success");
  assert.equal(d.verdict, "PASS");
  assert.equal(d.enableAutoMerge, false);
  assert.equal(d.disableAutoMerge, true);
  assert.deepEqual(d.addLabels, ["ready-to-merge", "needs-human"]);
  assert.deepEqual(d.removeLabels, ["agent-rework"]);
  assert.match(d.notify, /^T3 factory: PR #7 "Add a thing" needs you - PASS - waits for the owner: /);
  assert.ok(d.description.startsWith("PASS - waits for the owner: protected-path"));
});

test("decide: PASS with automation off waits for the owner", () => {
  const d = decide(decideInput({ automation: "off" }));
  assert.equal(d.enableAutoMerge, false);
  assert.equal(d.disableAutoMerge, true);
  assert.ok(d.description.startsWith("PASS - waits for the owner"));
});

test("decide: FAIL on an agent-pr with rounds left goes back to the agent", () => {
  const review = { ...decideInput().review, verdict: "FAIL", findings: [blocking] };
  const prInfo = { number: 7, title: "t", url: "u", labels: [{ name: "agent-pr" }] };
  const d = decide(decideInput({ review, pr: prInfo, messages: ["x\n\nT3-Agent-Round: 1"] }));
  assert.equal(d.state, "failure");
  assert.equal(d.verdict, "FAIL");
  assert.equal(d.disableAutoMerge, true);
  assert.deepEqual(d.addLabels, ["agent-rework"]);
  assert.deepEqual(d.removeLabels, ["ready-to-merge"]);
  assert.equal(d.notify, null);
  assert.equal(d.description, "FAIL - sent back to the agent (round 2 of 3)");
});

test("decide: rework-ci on an agent-pr uses the same rule", () => {
  const prInfo = { number: 7, title: "t", url: "u", labels: [{ name: "agent-pr" }] };
  const d = decide(decideInput({ mode: "rework-ci", review: null, reviewJob: "skipped", pr: prInfo, messages: [] }));
  assert.equal(d.state, "failure");
  assert.equal(d.verdict, "FAIL");
  assert.deepEqual(d.addLabels, ["agent-rework"]);
  assert.equal(d.description, "FAIL - sent back to the agent (round 1 of 3)");
});

test("decide: FAIL on an agent-pr with rounds used up waits for the owner", () => {
  const review = { ...decideInput().review, verdict: "FAIL", findings: [blocking] };
  const prInfo = { number: 7, title: "t", url: "u", labels: [{ name: "agent-pr" }] };
  const d = decide(decideInput({ review, pr: prInfo, messages: ["x\n\nT3-Agent-Round: 3"] }));
  assert.equal(d.state, "failure");
  assert.deepEqual(d.addLabels, ["agent-blocked", "needs-human"]);
  assert.deepEqual(d.removeLabels, ["ready-to-merge", "agent-rework"]);
  assert.equal(d.disableAutoMerge, true);
  assert.ok(d.notify);
  assert.equal(d.description, "FAIL - three rework rounds used; waits for the owner");
});

test("decide: FAIL without agent-pr", () => {
  const review = { ...decideInput().review, verdict: "FAIL", findings: [blocking, { ...blocking, title: "Bad 2" }] };
  const d = decide(decideInput({ review }));
  assert.equal(d.state, "failure");
  assert.equal(d.verdict, "FAIL");
  assert.deepEqual(d.addLabels, ["needs-human"]);
  assert.deepEqual(d.removeLabels, ["ready-to-merge"]);
  assert.ok(d.notify);
  assert.equal(d.description, "FAIL - 2 blocking finding(s); see the review comment");
});

test("decide: NEEDS_HUMAN", () => {
  const review = { ...decideInput().review, verdict: "NEEDS_HUMAN" };
  const d = decide(decideInput({ review }));
  assert.equal(d.state, "failure");
  assert.equal(d.verdict, "NEEDS_HUMAN");
  assert.deepEqual(d.addLabels, ["needs-human"]);
  assert.deepEqual(d.removeLabels, ["ready-to-merge"]);
  assert.equal(d.disableAutoMerge, true);
  assert.ok(d.notify);
  assert.equal(d.description, "NEEDS_HUMAN - see the review comment");
});

test("decide: PASS with a blocking finding becomes FAIL", () => {
  const review = { ...decideInput().review, verdict: "PASS", findings: [blocking] };
  const d = decide(decideInput({ review }));
  assert.equal(d.verdict, "FAIL");
  assert.equal(d.state, "failure");
  assert.equal(d.enableAutoMerge, false);
});

test("decide: carry keeps the PASS and says so", () => {
  const d = decide(decideInput({ mode: "carry", review: null, reviewJob: "skipped" }));
  assert.equal(d.state, "success");
  assert.equal(d.verdict, "PASS");
  assert.equal(d.enableAutoMerge, true);
  assert.equal(d.description, "PASS carried forward - same change, branch updated");
});

test("decide: drill modes", () => {
  const fail = decide(decideInput({ mode: "drill", reason: "fail", drill: "fail", review: null, reviewJob: "skipped" }));
  assert.equal(fail.state, "failure");
  assert.equal(fail.verdict, "FAIL");
  assert.deepEqual(fail.addLabels, ["needs-human"]);
  assert.equal(fail.enableAutoMerge, false);
  assert.ok(fail.notify);
  const nh = decide(decideInput({ mode: "drill", reason: "needs-human", drill: "needs-human", review: null, reviewJob: "skipped" }));
  assert.equal(nh.verdict, "NEEDS_HUMAN");
  assert.equal(nh.state, "failure");
});

test("decide: skip mode does nothing", () => {
  const d = decide(decideInput({ mode: "skip", review: null, reviewJob: "skipped" }));
  assert.equal(d.state, "none");
  assert.equal(d.enableAutoMerge, false);
  assert.equal(d.disableAutoMerge, false);
  assert.deepEqual(d.addLabels, []);
});

test("decide: every description is at most 140 characters", () => {
  const longReason = "x".repeat(400);
  const policy = { tier: "protected", eligible: false, reasons: [longReason], patchId: "p1", stats: {} };
  const inputs = [
    decideInput({ policy }),
    decideInput({ mode: "human", reason: longReason, review: null, reviewJob: "skipped" }),
    decideInput({ mode: "override", actor: longReason, review: null, reviewJob: "skipped" }),
  ];
  for (const input of inputs) assert.ok(decide(input).description.length <= 140);
});

test("decide: human mode with automation off starts with the fixed text", () => {
  const d = decide(decideInput({ mode: "human", reason: "automation off", review: null, reviewJob: "skipped" }));
  assert.ok(d.description.startsWith("not reviewed: automation off"));
});

// ---------------------------------------------------------------- sweep

function sweepPr(number, extra = {}) {
  return {
    number,
    createdAt: `2026-11-1${number % 10}T00:00:00Z`,
    isDraft: false,
    isCrossRepository: false,
    mergeStateStatus: "CLEAN",
    autoMergeRequest: null,
    labels: [],
    author: { login: "tetracilin", is_bot: false },
    checks: FOUR_OK,
    agentReview: { state: "success", description: "PASS - merges automatically (tier low, dial 4)" },
    ...extra,
  };
}

function plan(prs, extra = {}) {
  return sweep({ automation: "on", maxDispatch: 3, prs, ...extra });
}

test("sweep: automation off disables every auto-merge and updates nothing", () => {
  const prs = [
    sweepPr(1, { autoMergeRequest: { enabledAt: "x" }, mergeStateStatus: "BEHIND" }),
    sweepPr(2),
    sweepPr(3, { autoMergeRequest: { enabledAt: "x" } }),
    sweepPr(4, { mergeStateStatus: "DIRTY" }),
  ];
  const result = plan(prs, { automation: "off" });
  assert.deepEqual(result.disableAutoMerge, [1, 3]);
  assert.equal(result.updateBranch, null);
  assert.deepEqual(result.conflicts, []);
});

test("sweep: of two behind pull requests only the older is updated", () => {
  const prs = [
    sweepPr(5, { createdAt: "2026-11-05T00:00:00Z", mergeStateStatus: "BEHIND", autoMergeRequest: { enabledAt: "x" } }),
    sweepPr(4, { createdAt: "2026-11-04T00:00:00Z", mergeStateStatus: "BEHIND", autoMergeRequest: { enabledAt: "x" } }),
  ];
  assert.equal(plan(prs).updateBranch, 4);
});

test("sweep: an auto-merge pull request that is behind comes before an older one without", () => {
  const prs = [
    sweepPr(2, { createdAt: "2026-11-02T00:00:00Z", mergeStateStatus: "BEHIND", agentReview: null }),
    sweepPr(9, { createdAt: "2026-11-09T00:00:00Z", mergeStateStatus: "BEHIND", autoMergeRequest: { enabledAt: "x" } }),
  ];
  assert.equal(plan(prs).updateBranch, 9);
});

test("sweep: DIRTY gets a label by the agent-pr label, once", () => {
  const prs = [
    sweepPr(1, { mergeStateStatus: "DIRTY", labels: [{ name: "agent-pr" }] }),
    sweepPr(2, { mergeStateStatus: "DIRTY" }),
    sweepPr(3, { mergeStateStatus: "DIRTY", labels: [{ name: "agent-pr" }, { name: "agent-rework" }] }),
    sweepPr(4, { mergeStateStatus: "DIRTY", labels: [{ name: "needs-human" }] }),
    sweepPr(5, { mergeStateStatus: "DIRTY", isDraft: true }),
    sweepPr(6, { mergeStateStatus: "DIRTY", isCrossRepository: true }),
  ];
  assert.deepEqual(plan(prs).conflicts, [
    { number: 1, label: "agent-rework" },
    { number: 2, label: "needs-human" },
  ]);
});

test("sweep: dispatch rules", () => {
  const prs = [
    sweepPr(1, { agentReview: null }),
    sweepPr(2, { agentReview: { state: "pending", description: "daily review cap reached; the sweep retries" } }),
    sweepPr(3, { agentReview: { state: "error", description: "reviewer unavailable; the sweep retries" } }),
    sweepPr(4, { agentReview: { state: "success", description: "PASS - merges automatically (tier low, dial 4)" } }),
    sweepPr(5, { agentReview: null, isDraft: true }),
    sweepPr(6, { agentReview: null, checks: FOUR_OK.slice(0, 3) }),
  ];
  assert.deepEqual(plan(prs, { maxDispatch: 10 }).dispatchReview, [1, 2, 3]);
});

test("sweep: not reviewed is dispatched only when it may now be reviewed", () => {
  const notReviewed = { state: "success", description: "not reviewed: automation off; human merge" };
  const prs = [
    sweepPr(1, { agentReview: notReviewed }),
    sweepPr(2, { agentReview: notReviewed, isCrossRepository: true }),
    sweepPr(3, { agentReview: notReviewed, author: { login: "dependabot", is_bot: true } }),
    sweepPr(4, { agentReview: notReviewed, labels: [{ name: "factory-hold" }] }),
  ];
  assert.deepEqual(plan(prs).dispatchReview, [1]);
  assert.deepEqual(plan(prs, { automation: "off" }).dispatchReview, []);
});

test("sweep: at most maxDispatch, oldest first", () => {
  const prs = [3, 1, 2, 4].map((n) => sweepPr(n, { agentReview: null, createdAt: `2026-11-0${n}T00:00:00Z` }));
  assert.deepEqual(plan(prs, { maxDispatch: 2 }).dispatchReview, [1, 2]);
});

test("sweep: with no auto-merge pull request behind, the oldest never-reviewed one is updated", () => {
  const prs = [
    sweepPr(1, { createdAt: "2026-11-01T00:00:00Z", mergeStateStatus: "BEHIND", labels: [{ name: "factory-hold" }], agentReview: null }),
    sweepPr(2, { createdAt: "2026-11-02T00:00:00Z", mergeStateStatus: "BEHIND", author: { login: "dependabot", is_bot: true }, agentReview: null }),
    sweepPr(3, { createdAt: "2026-11-03T00:00:00Z", mergeStateStatus: "BEHIND", isCrossRepository: true, agentReview: null }),
    sweepPr(4, { createdAt: "2026-11-04T00:00:00Z", mergeStateStatus: "BEHIND", isDraft: true, agentReview: null }),
    sweepPr(5, { createdAt: "2026-11-05T00:00:00Z", mergeStateStatus: "BEHIND", agentReview: { state: "success", description: "PASS - merges automatically (tier low, dial 4)" } }),
    sweepPr(6, { createdAt: "2026-11-06T00:00:00Z", mergeStateStatus: "BEHIND", agentReview: { state: "success", description: "not reviewed: automation off; human merge" } }),
    sweepPr(7, { createdAt: "2026-11-07T00:00:00Z", mergeStateStatus: "BEHIND", agentReview: null }),
  ];
  assert.equal(plan(prs).updateBranch, 6);
  assert.equal(plan(prs.slice(0, 5)).updateBranch, null);
});

test("sweep: UNKNOWN causes nothing", () => {
  const prs = [sweepPr(1, { mergeStateStatus: "UNKNOWN", autoMergeRequest: { enabledAt: "x" }, agentReview: null })];
  const result = plan(prs);
  assert.equal(result.updateBranch, null);
  assert.deepEqual(result.conflicts, []);
});

// ---------------------------------------------------------------- command line

test("command line: gate reads stdin and prints JSON", () => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../agent-merge-policy.mjs");
  const out = execFileSync("node", [script, "gate"], { input: JSON.stringify(gateInput({ automation: "off" })), encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), { mode: "human", reason: "automation off" });
});

test("command line: a usage error exits 2", () => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../agent-merge-policy.mjs");
  assert.throws(() => execFileSync("node", [script, "nonsense"], { input: "{}", stdio: ["pipe", "pipe", "pipe"] }), (error) => error.status === 2);
  assert.throws(() => execFileSync("node", [script, "classify", "--dial", "9"], { stdio: ["pipe", "pipe", "pipe"] }), (error) => error.status === 2);
});
