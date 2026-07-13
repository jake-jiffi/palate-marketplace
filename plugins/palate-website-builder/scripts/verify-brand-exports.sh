#!/usr/bin/env bash
# Verify the brand package exports the entry points the site depends on.
# Usage: verify-brand-exports.sh <slug> <version>
# Prints: OK | MISSING_EXPORTS:<list>
set -euo pipefail
SLUG="${1:?slug required}"
VERSION="${2:?version required}"
PKG="@palate-projects/${SLUG}-brand"
REGISTRY="https://npm.pkg.github.com"

exports=$(npm view "${PKG}@${VERSION}" exports --registry="$REGISTRY" --json 2>/dev/null || echo "{}")
required=("./tokens.css" "./fonts.css" "./tailwind.preset" "./components/*")
missing=()
for exp in "${required[@]}"; do
  if ! printf '%s' "$exports" | jq -e --arg k "$exp" 'has($k)' >/dev/null 2>&1; then
    missing+=("$exp")
  fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "MISSING_EXPORTS:${missing[*]}"
  exit 1
fi
echo "OK"
