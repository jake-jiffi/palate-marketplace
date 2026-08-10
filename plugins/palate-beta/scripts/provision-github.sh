#!/usr/bin/env bash
# Phase D: GitHub repo + CI. CI builds (brand package via native GITHUB_TOKEN)
# and deploys the artifact. No npm token secret needed.
# Usage: provision-github.sh <slug>
set -euo pipefail
SLUG="${1:?slug}"
REPO="palate-projects/${SLUG}"

if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "repo $REPO exists; checking empty..."
  cnt=$(gh api "repos/${REPO}/commits" --jq 'length' 2>/dev/null || echo 0)
  [ "$cnt" = "0" ] || { echo "repo not empty; append -web or resolve" >&2; exit 2; }
else
  gh repo create "$REPO" --private --description "Website for ${SLUG}" >/dev/null
fi

echo "setting Actions secrets..."
gh secret set CLOUDFLARE_API_TOKEN  --repo "$REPO" --body "${CLOUDFLARE_API_TOKEN:?}"   >/dev/null
gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$REPO" --body "${CLOUDFLARE_ACCOUNT_ID:?}"  >/dev/null
set -a; [ -f .env ] && . ./.env; set +a
gh secret set SANITY_API_READ_TOKEN --repo "$REPO" --body "${SANITY_API_READ_TOKEN:-}" >/dev/null
# NOTE: no npm/packages token secret. CI uses the native GITHUB_TOKEN with
# permissions: packages: read in the workflow to install the private brand package.

echo "pushing..."
git remote add origin "https://github.com/${REPO}.git" 2>/dev/null || true
git branch -M main
git push -u origin main

echo "setting branch protection on main..."
gh api -X PUT "repos/${REPO}/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=build-and-deploy" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "restrictions=null" >/dev/null 2>&1 || echo "  (branch protection needs repo admin; skipped)"

echo "granting palate-engineering team push..."
gh api -X PUT "orgs/palate-projects/teams/palate-engineering/repos/${REPO}" -f permission=push >/dev/null 2>&1 || echo "  (team grant skipped; team may not exist yet)"

echo "GITHUB_PROVISIONED:${REPO}"
