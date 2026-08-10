#!/usr/bin/env bash
# Update phase status or set a nested value.
# Usage: state-update.sh phase <phaseName> <status>
#        state-update.sh set '<jq-path>' '<json-value>'   e.g. set '.brand.packageVersion' '"2.0.0"'
set -euo pipefail
[ -f .palate-skill-state.json ] || { echo "no state file here" >&2; exit 1; }
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ); tmp=$(mktemp)
if [ "${1:?}" = "phase" ]; then
  jq --arg p "$2" --arg s "$3" --arg ts "$TS" '.phases[$p].status=$s | .skill.lastUpdatedAt=$ts' .palate-skill-state.json > "$tmp"
elif [ "$1" = "set" ]; then
  jq --argjson v "$3" --arg ts "$TS" "$2 = \$v | .skill.lastUpdatedAt=\$ts" .palate-skill-state.json > "$tmp"
else
  echo "unknown command $1" >&2; exit 1
fi
mv "$tmp" .palate-skill-state.json
