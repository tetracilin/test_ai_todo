#!/usr/bin/env bash
# verify-factory-001.sh - end-to-end check for WP-FACTORY-001 (merge gate).
#
# Usage, from the repository root, in Git Bash or any bash:
#   bash CICD/factory/verify-factory-001.sh <D> <C> <B> <E> <S>
# The five arguments are the canary pull request numbers recorded in
# technical-spec/fork/factory-drills/README.md:
#   D happy path, C drill then branch update, B protected path,
#   E kill switch, S broken server test (closed, never merged).
# Needs: gh logged in with admin access to the repository. Uses no jq binary.
# Prints one PASS or FAIL line per check. Exit code = number of failed checks.

set -u
REPO="tetracilin/test_ai_todo"
D="${1:?canary D number}"
C="${2:?canary C number}"
B="${3:?canary B number}"
E="${4:?canary E number}"
S="${5:?canary S number}"
fail=0

check() {
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1  expected=[$2] actual=[$3]"
    fail=$((fail + 1))
  fi
}

first_sha() {
  gh api "repos/${REPO}/pulls/$1/commits" --jq '.[0].sha'
}

contexts="$({
  gh api "repos/${REPO}/branches/develop/protection/required_status_checks" --jq '.contexts[]' 2>/dev/null
  gh api "repos/${REPO}/rules/branches/develop" \
    --jq '.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context' 2>/dev/null
} | sort -u | paste -sd, -)"
check "required checks on develop" "agent-review,build,build-image,server-tests,unit" "${contexts}"

check "repository merge settings" "true,true,true" \
  "$(gh api "repos/${REPO}" --jq '[.allow_auto_merge, .delete_branch_on_merge, .allow_squash_merge] | @csv')"

check "factory variables" "T3_AGENT_AUTOMATION=on,T3_FACTORY_DAILY_REVIEW_CAP=12,T3_FACTORY_DIAL=4" \
  "$(gh variable list --repo "${REPO}" --json name,value \
    --jq 'map(select(.name | test("^T3_(AGENT_AUTOMATION|FACTORY_DIAL|FACTORY_DAILY_REVIEW_CAP)$"))) | sort_by(.name) | map(.name + "=" + .value) | join(",")')"

check "factory labels" "agent-blocked,agent-pr,agent-ready,agent-rework,agent-working,factory-hold,needs-human,ready-to-merge" \
  "$(gh label list --repo "${REPO}" --limit 200 --json name \
    --jq '[.[].name] | map(select(. == "agent-ready" or . == "agent-working" or . == "agent-pr" or . == "agent-blocked" or . == "agent-rework" or . == "factory-hold" or . == "needs-human" or . == "ready-to-merge")) | sort | join(",")')"

check "factory workflows stay off the kmv8 runner and off pull request code" "0" \
  "$(cat .github/workflows/t3-agent-review.yml .github/workflows/t3-agent-sweep.yml \
    | grep -vE '^[[:space:]]*#' | grep -cE 'self-hosted|kmv8|pull_request_target|head_branch')"

check "canary D merged by the factory app" 'true,"Bot"' \
  "$(gh api "repos/${REPO}/pulls/${D}" --jq '[.merged, .merged_by.type] | @csv')"
check "canary D passed agent-review" "true" \
  "$(gh api "repos/${REPO}/commits/$(first_sha "${D}")/statuses?per_page=100" \
    --jq '[.[] | select(.context == "agent-review") | .state] | index("success") != null')"

check "canary C drill posted a failure" "true" \
  "$(gh api "repos/${REPO}/commits/$(first_sha "${C}")/statuses?per_page=100" \
    --jq '[.[] | select(.context == "agent-review") | .state] | index("failure") != null')"
check "canary C merged by the factory app" 'true,"Bot"' \
  "$(gh api "repos/${REPO}/pulls/${C}" --jq '[.merged, .merged_by.type] | @csv')"
check "canary C branch was updated from develop" "true" \
  "$(gh api "repos/${REPO}/pulls/${C}/commits" --jq '[.[].commit.message | test("^Merge branch .develop. into ")] | any')"

check "canary B (protected path) was merged by a person, not the app" 'true,"User"' \
  "$(gh api "repos/${REPO}/pulls/${B}" --jq '[.merged, .merged_by.type] | @csv')"
check "canary B was labelled needs-human" "true" \
  "$(gh api "repos/${REPO}/pulls/${B}" --jq '[.labels[].name] | index("needs-human") != null')"

check "canary E saw the kill switch" "true" \
  "$(gh api "repos/${REPO}/commits/$(first_sha "${E}")/statuses?per_page=100" \
    --jq '[.[] | select(.context == "agent-review") | .description // "" | startswith("not reviewed: automation off")] | any')"
check "canary E merged by the factory app after the switch went back on" 'true,"Bot"' \
  "$(gh api "repos/${REPO}/pulls/${E}" --jq '[.merged, .merged_by.type] | @csv')"

check "canary S (broken server test) failed server-tests" "failure" \
  "$(gh api "repos/${REPO}/commits/$(gh api "repos/${REPO}/pulls/${S}" --jq .head.sha)/check-runs?per_page=100" \
    --jq '[.check_runs[] | select(.name == "server-tests")][0].conclusion')"
check "canary S was closed without merging" '"closed",false' \
  "$(gh api "repos/${REPO}/pulls/${S}" --jq '[.state, .merged] | @csv')"

echo "failed checks: ${fail}"
exit "${fail}"
