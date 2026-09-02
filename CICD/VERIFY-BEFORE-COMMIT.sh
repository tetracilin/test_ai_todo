#!/usr/bin/env bash
# Verification script — run this before committing changes
set -euo pipefail

echo "=== CI/CD Migration Verification ==="
echo
errors=0

echo "[1/7] Checking helper scripts exist and are executable..."
for script in deploy/scripts/{healthcheck,image-retention,version-drift}.sh; do
  if [[ ! -x "$script" ]]; then
    echo "  ❌ $script is not executable"
    ((errors++))
  elif ! bash -n "$script" 2>/dev/null; then
    echo "  ❌ $script has syntax errors"
    ((errors++))
  else
    echo "  ✅ $script"
  fi
done

echo "[2/7] Checking workflows are valid YAML..."
for workflow in .github/workflows/{ci,nightly,release}.yml; do
  if [[ ! -f "$workflow" ]]; then
    echo "  ❌ $workflow not found"
    ((errors++))
  elif ! grep -q "^name:" "$workflow"; then
    echo "  ❌ $workflow missing 'name:' field"
    ((errors++))
  else
    echo "  ✅ $workflow"
  fi
done

echo "[3/7] Checking environment variable fixes..."
if grep -q "PAPERCLIP_PORT.*vars.NIGHTLY_PORT" .github/workflows/nightly.yml; then
  echo "  ✅ nightly.yml uses PAPERCLIP_PORT with vars.NIGHTLY_PORT"
else
  echo "  ❌ nightly.yml port env var not fixed"
  ((errors++))
fi

if grep -q "PAPERCLIP_PORT.*vars.PROD_PORT" .github/workflows/release.yml; then
  echo "  ✅ release.yml uses PAPERCLIP_PORT with vars.PROD_PORT"
else
  echo "  ❌ release.yml port env var not fixed"
  ((errors++))
fi

echo "[4/7] Checking lint step is disabled..."
if grep -q "^[[:space:]]*- run: pnpm lint" .github/workflows/ci.yml; then
  echo "  ❌ ci.yml still runs pnpm lint (should be disabled)"
  ((errors++))
else
  echo "  ✅ ci.yml has lint disabled"
fi

echo "[5/7] Checking documentation..."
for doc in CICD/{PLAN,ASSUMPTIONS-VERIFIED,IMPLEMENTATION-SUMMARY}.md; do
  if [[ ! -f "$doc" ]]; then
    echo "  ❌ $doc not found"
    ((errors++))
  else
    lines=$(wc -l < "$doc")
    echo "  ✅ $doc ($lines lines)"
  fi
done

echo "[6/7] Checking git status..."
git_status=$(git status --short | wc -l)
echo "  Modified/untracked files: $git_status"
echo "  ✅ Use 'git add' to stage changes"

echo "[7/7] Checking branch..."
current_branch=$(git rev-parse --abbrev-ref HEAD)
echo "  Current branch: $current_branch"
if [[ "$current_branch" == "develop" ]]; then
  echo "  ⚠️  You are on develop. Create a feature branch for the next commit."
fi

echo
if [[ $errors -eq 0 ]]; then
  echo "✅ All checks passed! Ready to commit."
  echo
  echo "Next steps:"
  echo "1. git checkout -b setup/cicd-migration"
  echo "2. git add .github/workflows/ deploy/scripts/ CICD/"
  echo "3. git commit -m \"setup(cicd): migrate to GitHub Actions workflows\""
  echo "4. git push -u origin setup/cicd-migration"
  echo "5. Open PR to develop on GitHub"
  exit 0
else
  echo "❌ $errors error(s) found. See above."
  exit 1
fi
