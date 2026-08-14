#!/usr/bin/env bash
# Initialise .palate-brand-state.json in the brand repo working dir.
# Usage: brand-state-init.sh <slug> <client-name> [--force]
#
# IT REFUSES TO CLOBBER, for the same reason scripts/state-init.sh does: every step here is a
# checkpoint, and re-running this on a resumed brand build reset repoCreated, tokensGenerated,
# packagePublished and pushed back to "pending", so the next resume would redo published work.
set -euo pipefail

FORCE=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}   # bash 3.2 (macOS) errors on "${ARGS[@]}" when empty under set -u

SLUG="${1:?slug required}"
CLIENT="${2:?client name required}"
STATE=".palate-brand-state.json"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ -e "$STATE" ] && [ "$FORCE" != "1" ]; then
  echo "refusing to overwrite the existing $STATE in $(pwd)." >&2
  echo "  It records which brand steps completed; overwriting marks published work as pending again." >&2
  echo "  To CONTINUE: scripts/brand-state-resume.sh (or scripts/brand-state-update.sh)." >&2
  echo "  To START OVER and discard it: scripts/brand-state-init.sh $* --force" >&2
  exit 1
fi

cat > "$STATE" <<JSON
{
  "schemaVersion": "1.0",
  "skill": { "name": "palate-brand-as-code", "version": "1.0.0", "startedAt": "${TS}", "lastUpdatedAt": "${TS}" },
  "client": { "name": "${CLIENT}", "slug": "${SLUG}" },
  "package": { "name": "@palate-projects/${SLUG}-brand", "version": null, "contentHash": null },
  "steps": {
    "repoCreated": "pending",
    "assetsInventoried": "pending",
    "assetsCopied": "pending",
    "tokensGenerated": "pending",
    "fontsCssWritten": "pending",
    "componentsWritten": "pending",
    "examplesWritten": "pending",
    "docsWritten": "pending",
    "metaFilesWritten": "pending",
    "packagePublished": "pending",
    "pushed": "pending",
    "photographyPass": "not-applicable"
  }
}
JSON
echo "state initialised: .palate-brand-state.json"
