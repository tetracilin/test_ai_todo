import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessChecks,
  assessGreptile,
  compactFailedLog,
  computeVerdict,
  extractRunId,
  formatAssessment,
  parseBadge,
  parseCli,
  splitArgv,
  stripAnsi,
  stripHtml,
  threadText,
} from "./pr-readiness.mjs";

// ---------------------------------------------------------------------------
// Fixtures (shaped like the REST check-runs API and the GraphQL reviewThreads query)
// ---------------------------------------------------------------------------

const RUN_URL = "https://github.com/tetracilin/test_ai_todo/actions/runs/35204263273/job/105146094389";

function checkRun(name, { status = "completed", conclusion = "success", id = 1, app = "github-actions", url = RUN_URL } = {}) {
  return { id, name, status, conclusion, details_url: url, app: { slug: app } };
}

function greenRuns() {
  return [
    checkRun("unit", { id: 10 }),
    checkRun("build", { id: 11 }),
    checkRun("build-image", { id: 12 }),
    checkRun("Greptile Review", { id: 13, app: "greptile-apps", url: "https://greptile.com/" }),
  ];
}

const GREPTILE_BODY =
  '<a href="#"><img alt="P1" src="https://greptile-static-assets.s3.amazonaws.com/badges/p1.svg?v=9" align="top"></a> **Newest commits can disappear**\n\nThe compare request fetches only the first 100 commits.';

function thread({ id = "PRRT_1", isResolved = false, isOutdated = false, login = "greptile-apps[bot]", body = GREPTILE_BODY, path = "server/src/a.ts", line = 12, databaseId = 555 } = {}) {
  return { id, isResolved, isOutdated, path, line, comments: { nodes: [{ author: { login }, body, databaseId }] } };
}

function openPr(overrides = {}) {
  return {
    number: 105,
    url: "https://github.com/tetracilin/test_ai_todo/pull/105",
    state: "OPEN",
    isDraft: false,
    headSha: "857beb564ee7c295f278b454afee4c0761490d5e",
    headRefName: "chore/topic",
    baseRefName: "develop",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "",
    ...overrides,
  };
}

function verdictFor({ pr = openPr(), runs = greenRuns(), threads = [], behindBy = 0, localHeadSha = null } = {}) {
  return computeVerdict({ pr, checks: assessChecks(runs), greptile: assessGreptile(runs, threads), behindBy, localHeadSha });
}

// ---------------------------------------------------------------------------
// assessChecks / assessGreptile
// ---------------------------------------------------------------------------

describe("assessChecks", () => {
  it("reports the three required checks in order and marks missing ones", () => {
    const checks = assessChecks([checkRun("unit")]);
    assert.deepEqual(checks.map((check) => check.name), ["unit", "build", "build-image"]);
    assert.equal(checks[0].present, true);
    assert.equal(checks[0].green, true);
    assert.equal(checks[1].present, false);
    assert.equal(checks[1].status, "missing");
    assert.equal(checks[1].conclusion, null);
  });

  it("uses the newest check-run when a name appears more than once (re-runs)", () => {
    const checks = assessChecks([
      checkRun("unit", { id: 1, conclusion: "failure" }),
      checkRun("unit", { id: 2, conclusion: "success" }),
    ]);
    assert.equal(checks[0].conclusion, "success");
    assert.equal(checks[0].green, true);
  });

  it("treats in-progress runs as not completed and not green", () => {
    const [unit] = assessChecks([checkRun("unit", { status: "in_progress", conclusion: null })]);
    assert.equal(unit.completed, false);
    assert.equal(unit.green, false);
  });

  it("tolerates a non-array input", () => {
    assert.equal(assessChecks(undefined).every((check) => !check.present), true);
  });
});

describe("assessGreptile", () => {
  it("finds the Greptile Review check-run by name or app slug", () => {
    const byName = assessGreptile([checkRun("Greptile Review", { app: "unknown" })], []);
    assert.equal(byName.check.present, true);
    assert.equal(byName.check.clean, true);
    const bySlug = assessGreptile([checkRun("Some Review", { app: "greptile-apps" })], []);
    assert.equal(bySlug.check.present, true);
  });

  it("counts only unresolved threads authored by greptile-apps (bot suffix stripped)", () => {
    const result = assessGreptile(greenRuns(), [
      thread({ id: "a", login: "greptile-apps[bot]" }),
      thread({ id: "b", login: "greptile-apps", isResolved: true }),
      thread({ id: "c", login: "tetracilin" }),
    ]);
    assert.equal(result.threads.total, 2);
    assert.equal(result.threads.unresolved, 1);
    assert.equal(result.threads.unresolvedItems[0].id, "a");
    assert.equal(result.threads.unresolvedItems[0].badge, "P1");
    assert.equal(result.threads.unresolvedItems[0].commentId, 555);
    assert.equal(result.threads.unresolvedItems[0].text.startsWith("**Newest commits can disappear**"), true);
  });

  it("reports a missing Greptile check when no run exists", () => {
    const result = assessGreptile([checkRun("unit")], []);
    assert.equal(result.check.present, false);
    assert.equal(result.check.status, "missing");
  });
});

// ---------------------------------------------------------------------------
// computeVerdict: every word and the precedence order
// ---------------------------------------------------------------------------

describe("computeVerdict", () => {
  it("ready_for_human_merge when everything is green, clean, and current", () => {
    assert.equal(verdictFor(), "ready_for_human_merge");
  });

  it("blocked:pr_not_open for MERGED/CLOSED states", () => {
    assert.equal(verdictFor({ pr: openPr({ state: "MERGED" }) }), "blocked:pr_not_open");
    assert.equal(verdictFor({ pr: openPr({ state: "CLOSED" }) }), "blocked:pr_not_open");
  });

  it("blocked:base_not_develop when the PR targets any other branch", () => {
    assert.equal(verdictFor({ pr: openPr({ baseRefName: "main" }) }), "blocked:base_not_develop");
    assert.equal(verdictFor({ pr: openPr({ baseRefName: "feature/other" }) }), "blocked:base_not_develop");
    assert.equal(verdictFor({ pr: openPr({ baseRefName: "" }) }), "blocked:base_not_develop");
  });

  it("blocked:local_head_not_pushed when the checkout is ahead of the PR head", () => {
    assert.equal(verdictFor({ localHeadSha: "0000000000000000000000000000000000000000" }), "blocked:local_head_not_pushed");
    assert.equal(verdictFor({ localHeadSha: openPr().headSha }), "ready_for_human_merge");
    assert.equal(verdictFor({ localHeadSha: null }), "ready_for_human_merge", "not on the PR branch: no comparison");
  });

  it("blocked:draft", () => {
    assert.equal(verdictFor({ pr: openPr({ isDraft: true }) }), "blocked:draft");
  });

  it("blocked:merge_conflict", () => {
    assert.equal(verdictFor({ pr: openPr({ mergeable: "CONFLICTING" }) }), "blocked:merge_conflict");
  });

  it("wait when a required check is missing or not completed, or Greptile is missing/pending", () => {
    assert.equal(verdictFor({ runs: greenRuns().filter((run) => run.name !== "build") }), "wait");
    const pending = greenRuns().map((run) => (run.name === "unit" ? checkRun("unit", { status: "queued", conclusion: null }) : run));
    assert.equal(verdictFor({ runs: pending }), "wait");
    assert.equal(verdictFor({ runs: greenRuns().filter((run) => run.name !== "Greptile Review") }), "wait");
    const greptilePending = greenRuns().map((run) =>
      run.name === "Greptile Review" ? checkRun("Greptile Review", { status: "in_progress", conclusion: null, app: "greptile-apps" }) : run,
    );
    assert.equal(verdictFor({ runs: greptilePending }), "wait");
  });

  it("fix_ci when a required check concluded failure/cancelled/timed_out", () => {
    for (const conclusion of ["failure", "cancelled", "timed_out", "action_required"]) {
      const runs = greenRuns().map((run) => (run.name === "unit" ? checkRun("unit", { conclusion }) : run));
      assert.equal(verdictFor({ runs }), "fix_ci", conclusion);
    }
  });

  it("fix_ci wins over a missing or pending Greptile run once the required checks are complete", () => {
    const red = greenRuns()
      .filter((run) => run.name !== "Greptile Review")
      .map((run) => (run.name === "build" ? checkRun("build", { conclusion: "failure" }) : run));
    assert.equal(verdictFor({ runs: red }), "fix_ci", "Greptile missing");
    red.push(checkRun("Greptile Review", { status: "in_progress", conclusion: null, app: "greptile-apps" }));
    assert.equal(verdictFor({ runs: red }), "fix_ci", "Greptile pending");
  });

  it("treats neutral and skipped required checks as green", () => {
    const runs = greenRuns().map((run) => (run.name === "build" ? checkRun("build", { conclusion: "skipped" }) : run));
    assert.equal(verdictFor({ runs }), "ready_for_human_merge");
  });

  it("fix_review when Greptile concluded non-success or threads are unresolved", () => {
    const runs = greenRuns().map((run) =>
      run.name === "Greptile Review" ? checkRun("Greptile Review", { conclusion: "failure", app: "greptile-apps" }) : run,
    );
    assert.equal(verdictFor({ runs }), "fix_review");
    assert.equal(verdictFor({ threads: [thread()] }), "fix_review");
    assert.equal(verdictFor({ threads: [thread({ isResolved: true })] }), "ready_for_human_merge");
  });

  it("rebase when behind the base or mergeStateStatus is BEHIND", () => {
    assert.equal(verdictFor({ behindBy: 3 }), "rebase");
    assert.equal(verdictFor({ pr: openPr({ mergeStateStatus: "BEHIND" }) }), "rebase");
  });

  it("applies precedence: not-open > base > local head > draft > conflict > wait > fix_ci > fix_review > rebase", () => {
    const everything = {
      pr: openPr({ state: "CLOSED", baseRefName: "main", isDraft: true, mergeable: "CONFLICTING", mergeStateStatus: "BEHIND" }),
      runs: [checkRun("unit", { conclusion: "failure" }), checkRun("Greptile Review", { conclusion: "failure", app: "greptile-apps" })],
      threads: [thread()],
      behindBy: 5,
      localHeadSha: "1111111111111111111111111111111111111111",
    };
    assert.equal(verdictFor(everything), "blocked:pr_not_open");
    everything.pr.state = "OPEN";
    assert.equal(verdictFor(everything), "blocked:base_not_develop");
    everything.pr.baseRefName = "develop";
    assert.equal(verdictFor(everything), "blocked:local_head_not_pushed");
    everything.localHeadSha = everything.pr.headSha;
    assert.equal(verdictFor(everything), "blocked:draft");
    everything.pr.isDraft = false;
    assert.equal(verdictFor(everything), "blocked:merge_conflict");
    everything.pr.mergeable = "MERGEABLE";
    assert.equal(verdictFor(everything), "wait", "build and build-image are missing");
    everything.runs.push(checkRun("build"), checkRun("build-image"));
    assert.equal(verdictFor(everything), "fix_ci");
    const greptileRun = everything.runs[1];
    everything.runs[1] = checkRun("Greptile Review", { status: "queued", conclusion: null, app: "greptile-apps" });
    assert.equal(verdictFor(everything), "fix_ci", "a red required check is not hidden by a pending Greptile run");
    everything.runs[1] = greptileRun;
    everything.runs[0] = checkRun("unit");
    assert.equal(verdictFor(everything), "fix_review");
    everything.runs[1] = checkRun("Greptile Review", { app: "greptile-apps" });
    everything.threads = [];
    assert.equal(verdictFor(everything), "rebase");
    everything.behindBy = 0;
    everything.pr.mergeStateStatus = "CLEAN";
    assert.equal(verdictFor(everything), "ready_for_human_merge");
  });
});

// ---------------------------------------------------------------------------
// parseBadge / stripHtml / threadText
// ---------------------------------------------------------------------------

describe("parseBadge", () => {
  it("returns the alt text of the first badge image in a real Greptile body", () => {
    assert.equal(parseBadge(GREPTILE_BODY), "P1");
  });

  it("returns the first badge when several are present", () => {
    const body =
      '<a href="#"><img alt="P2" src="x"></a> <a href="#"><img alt="security" src="y" align="top"></a> **Titles can trigger mentions**';
    assert.equal(parseBadge(body), "P2");
    assert.equal(parseBadge('<img alt="security" src="y"> text'), "security");
  });

  it("returns null when there is no badge", () => {
    assert.equal(parseBadge("plain text"), null);
    assert.equal(parseBadge('<img alt="logo" src="z">'), null);
    assert.equal(parseBadge(null), null);
  });
});

describe("stripHtml", () => {
  it("removes tags, collapses whitespace, and keeps markdown text", () => {
    assert.equal(stripHtml(GREPTILE_BODY), "**Newest commits can disappear** The compare request fetches only the first 100 commits.");
  });

  it("decodes common entities and drops comments", () => {
    assert.equal(stripHtml("a &amp; b <!-- hidden --> &lt;c&gt;"), "a & b <c>");
  });

  it("caps thread text at 300 characters", () => {
    const long = `<b>x</b> ${"y".repeat(500)}`;
    assert.equal(threadText(long).length, 300);
  });
});

// ---------------------------------------------------------------------------
// compactFailedLog / stripAnsi / extractRunId
// ---------------------------------------------------------------------------

describe("compactFailedLog", () => {
  it("strips ANSI escapes, keeps only interesting lines, and dedupes preserving order", () => {
    const text = [
      "unit\tRun tests\t2026-09-17T00:00:00Z [31mFAIL[39m server/src/a.test.ts > does a thing",
      "unit\tRun tests\t2026-09-17T00:00:01Z some passing chatter",
      "unit\tRun tests\t2026-09-17T00:00:02Z [31mFAIL[39m server/src/a.test.ts > does a thing",
      "unit\tRun tests\t2026-09-17T00:00:03Z  Test Files  1 failed | 3 passed (4)",
      "unit\tRun tests\t2026-09-17T00:00:04Z       Tests  2 failed | 40 passed (42)",
      "unit\tRun tests\t2026-09-17T00:00:05Z ##[error]Process completed with exit code 1.",
      "unit\tRun tests\t2026-09-17T00:00:06Z  ELIFECYCLE  Test failed. See above for more details.",
      "unit\tRun tests\t2026-09-17T00:00:07Z src/x.ts(3,1): error TS2322: Type 'a' is not assignable",
      "",
    ].join("\n");
    const lines = compactFailedLog(text);
    assert.equal(lines.length, 6);
    assert.equal(lines[0].includes(""), false);
    assert.equal(lines[0], "unit	Run tests	FAIL server/src/a.test.ts > does a thing", "timestamp dropped, ANSI stripped");
    assert.equal(lines[1].includes("Test Files"), true);
    assert.equal(lines[2].includes("Tests  2 failed"), true);
    assert.equal(lines[3].includes("##[error]"), true);
    assert.equal(lines[4].includes("ELIFECYCLE"), true);
    assert.equal(lines[5].includes("error TS2322"), true);
  });

  it("caps output at 200 lines", () => {
    const text = Array.from({ length: 500 }, (_, index) => `Error number ${index}`).join("\n");
    assert.equal(compactFailedLog(text).length, 200);
  });

  it("stripAnsi removes CSI and OSC sequences", () => {
    assert.equal(stripAnsi("[1;32mok[0m ]8;;http://xlink]8;;"), "ok link");
  });
});

describe("extractRunId", () => {
  it("extracts the run id and job id from a check-run details_url", () => {
    assert.deepEqual(extractRunId(RUN_URL), { runId: "35204263273", jobId: "105146094389" });
  });

  it("works without a job segment and returns null for non-actions URLs", () => {
    assert.deepEqual(extractRunId("https://github.com/o/r/actions/runs/42"), { runId: "42", jobId: null });
    assert.equal(extractRunId("https://greptile.com/"), null);
    assert.equal(extractRunId(null), null);
  });
});

// ---------------------------------------------------------------------------
// formatAssessment
// ---------------------------------------------------------------------------

describe("formatAssessment", () => {
  it("prints the header, table, thread lines, and a final verdict line", () => {
    const runs = greenRuns().filter((run) => run.name !== "build-image");
    const pr = openPr();
    const checks = assessChecks(runs);
    const greptile = assessGreptile(runs, [thread({ path: "ui/src/x.tsx", line: 7 })]);
    const behindBy = 2;
    const verdict = computeVerdict({ pr, checks, greptile, behindBy });
    const text = formatAssessment({ pr, checks, greptile, behindBy, verdict });
    const lines = text.split("\n");
    assert.equal(lines[0], "PR #105 https://github.com/tetracilin/test_ai_todo/pull/105");
    assert.equal(lines[1], "head 857beb56 on chore/topic -> develop");
    assert.equal(lines[2], "unit | completed | success");
    assert.equal(lines[4], "build-image | missing | -");
    assert.equal(lines[5], "Greptile Review | completed | success");
    assert.equal(lines[6], "greptile threads: 1/1 unresolved");
    assert.equal(lines[7].startsWith("  ui/src/x.tsx:7 [P1] **Newest commits can disappear**"), true);
    assert.equal(lines[8], "behind develop: 2");
    assert.equal(lines[9], "mergeable: MERGEABLE/CLEAN");
    assert.equal(lines[10], "review decision: none");
    assert.equal(lines.at(-1), "verdict: wait");
  });

  it("prints the local HEAD mismatch line under the head line", () => {
    const runs = greenRuns();
    const pr = openPr();
    const checks = assessChecks(runs);
    const greptile = assessGreptile(runs, []);
    const localHeadSha = "abcdef0123456789abcdef0123456789abcdef01";
    const verdict = computeVerdict({ pr, checks, greptile, behindBy: 0, localHeadSha });
    const lines = formatAssessment({ pr, checks, greptile, behindBy: 0, verdict, localHeadSha }).split("\n");
    assert.equal(lines[2], "local HEAD abcdef01 != PR head 857beb56 (push before assessing)");
    assert.equal(lines.at(-1), "verdict: blocked:local_head_not_pushed");
    const clean = formatAssessment({ pr, checks, greptile, behindBy: 0, verdict: "ready_for_human_merge", localHeadSha: pr.headSha }).split("\n");
    assert.equal(clean[2], "unit | completed | success");
  });
});

// ---------------------------------------------------------------------------
// splitArgv / parseCli
// ---------------------------------------------------------------------------

describe("parseCli", () => {
  it("takes a leading PR number as the positional and applies the defaults", () => {
    assert.deepEqual(splitArgv(["105", "--json"]), { positional: ["105"], flags: ["--json"] });
    const cli = parseCli(["105", "--json"]);
    assert.equal(cli.prNumber, "105");
    assert.equal(cli.json, true);
    assert.equal(cli.wait, false);
    assert.equal(cli.timeoutMs, 30 * 60 * 1000);
    assert.equal(cli.intervalMs, 30 * 1000);
    assert.equal(parseCli([]).prNumber, null);
  });

  it("recovers a PR number written after --json or --wait", () => {
    const json = parseCli(["--json", "105"]);
    assert.equal(json.prNumber, "105");
    assert.equal(json.json, true);
    const wait = parseCli(["--wait", "105", "--timeout", "5", "--interval", "10"]);
    assert.equal(wait.prNumber, "105");
    assert.equal(wait.wait, true);
    assert.equal(wait.timeoutMs, 5 * 60 * 1000);
    assert.equal(wait.intervalMs, 10 * 1000);
  });

  it("rejects a non-numeric value on a boolean flag, two PR numbers, and value flags without a value", () => {
    assert.throws(() => parseCli(["--json", "yes"]), /--json takes no value/);
    assert.throws(() => parseCli(["105", "--wait", "106"]), /--wait takes no value/);
    assert.throws(() => parseCli(["--wait", "--timeout"]), /--timeout needs a value/);
    assert.throws(() => parseCli(["--interval", "--wait"]), /--interval needs a value/);
    assert.throws(() => parseCli(["--timeout", "0"]), /positive numbers/);
    assert.throws(() => parseCli(["--interval", "abc"]), /positive numbers/);
  });
});
