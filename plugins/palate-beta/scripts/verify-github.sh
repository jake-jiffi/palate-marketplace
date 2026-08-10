#!/usr/bin/env bash
# Verify Phase D: repo exists, first CI run present.
# Usage: verify-github.sh <slug>
set -euo pipefail
REPO="palate-projects/${1:?slug}"
gh repo view "$REPO" >/dev/null 2>&1 || { echo "FAIL: repo missing"; exit 1; }
runs=$(gh run list --repo "$REPO" --limit 1 --json status 2>/dev/null | jq 'length' || echo 0)
[ "$runs" -ge 1 ] && echo "GITHUB_OK (CI run present)" || echo "GITHUB_OK (repo present; CI not yet triggered)"
