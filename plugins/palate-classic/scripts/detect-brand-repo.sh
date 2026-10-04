#!/usr/bin/env bash
# Phase 0: detect the brand repo and capture its latest published version.
# Usage: detect-brand-repo.sh <slug>
# Prints: EXISTS:<repo>:<version> | MISSING:<repo>
set -euo pipefail
SLUG="${1:?slug required}"
REPO="palate-projects/${SLUG}-brand"

if gh repo view "$REPO" >/dev/null 2>&1; then
  # Latest published package version, via the npm registry
  version=$(npm view "@palate-projects/${SLUG}-brand" version --registry=https://npm.pkg.github.com 2>/dev/null || echo "")
  [ -z "$version" ] && version="unpublished"
  echo "EXISTS:${REPO}:${version}"
else
  echo "MISSING:${REPO}"
fi
