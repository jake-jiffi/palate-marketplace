#!/usr/bin/env bash
# Initialise .palate-brand-state.json in the brand repo working dir.
# Usage: state-init.sh <slug> <client-name>
set -euo pipefail
SLUG="${1:?slug required}"
CLIENT="${2:?client name required}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > .palate-brand-state.json <<JSON
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
