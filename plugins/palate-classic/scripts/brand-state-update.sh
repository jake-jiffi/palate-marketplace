#!/usr/bin/env bash
# Atomically update a step status (and optionally package fields) in brand state.
# Usage: state-update.sh <step> <status>
#        state-update.sh package <version> <contentHash>
set -euo pipefail
[ -f .palate-brand-state.json ] || { echo "no .palate-brand-state.json here" >&2; exit 1; }
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp=$(mktemp)

if [ "${1:?}" = "package" ]; then
  VERSION="${2:?version}"; HASH="${3:?hash}"
  jq --arg v "$VERSION" --arg h "$HASH" --arg ts "$TS" \
    '.package.version=$v | .package.contentHash=$h | .skill.lastUpdatedAt=$ts' \
    .palate-brand-state.json > "$tmp"
else
  STEP="${1:?step}"; STATUS="${2:?status}"
  jq --arg s "$STEP" --arg st "$STATUS" --arg ts "$TS" \
    '.steps[$s]=$st | .skill.lastUpdatedAt=$ts' \
    .palate-brand-state.json > "$tmp"
fi
mv "$tmp" .palate-brand-state.json
