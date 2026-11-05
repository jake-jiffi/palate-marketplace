#!/usr/bin/env bash
# Print the first non-complete phase, respecting the stage boundary.
# In preview stage, the pipeline stops after previewVerified; phases B-F are
# reported as "preview-gated" rather than pending.
set -euo pipefail
[ -f .palate-skill-state.json ] || { echo "no-state"; exit 0; }
STAGE=$(jq -r '.stage // "preview"' .palate-skill-state.json)

# Preview-stage phases: up to and including previewVerified
for p in brandAsCode scaffold previewVerified; do
  s=$(jq -r --arg p "$p" '.phases[$p].status' .palate-skill-state.json)
  [ "$s" != "complete" ] && { echo "$p"; exit 0; }
done

if [ "$STAGE" = "preview" ]; then
  echo "preview-complete"
  exit 0
fi

# Production-stage phases
for p in sanity cloudflare github domain optional; do
  s=$(jq -r --arg p "$p" '.phases[$p].status' .palate-skill-state.json)
  [ "$s" != "complete" ] && { echo "$p"; exit 0; }
done
echo "all-complete"
