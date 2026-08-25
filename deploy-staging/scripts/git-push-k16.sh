#!/bin/sh
# Push the K16 branch to origin using the repo GITHUB_TOKEN (one-shot URL form,
# never persisted to git config, never printed). Usage: git-push-k16.sh
set -eu
TOK=$(grep '^GITHUB_TOKEN=' /root/.hermes/.env | sed 's/^GITHUB_TOKEN=//' | tr -d '\r')
[ -n "$TOK" ] || { echo "GITHUB_TOKEN not found" >&2; exit 1; }
cd /root/projects/t3-paperclip-Aitodo/.worktrees/t_661d88a3
URL="https://x-access-token:${TOK}@github.com/tetracilin/test_ai_todo.git"
git push "$URL" t3-paperclip-aitodo/t_661d88a3-k16-staging-deployment-on-alternate-port
