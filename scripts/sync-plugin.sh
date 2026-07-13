#!/usr/bin/env bash
# Sync the vendored plugin copy from the skill repo's main branch.
# Run at every release, AFTER the skill repo's version bump is pushed:
#   ./scripts/sync-plugin.sh [path-to-skill-clone]
# The plugin is vendored (source "./plugins/palate-website-builder") so
# /plugin install never needs a second git clone: Claude Code's installer
# clones plugin git sources over SSH with strict host checking, which fails
# on machines that never connected to GitHub (anthropics/claude-code#50725);
# marketplace add itself has an HTTPS fallback, so the vendored copy is the
# transport-safe path.
set -euo pipefail
SKILL="${1:-$HOME/dev/palate/skill}"
cd "$(dirname "$0")/.."
rm -rf plugins/palate-website-builder
mkdir -p plugins/palate-website-builder
git -C "$SKILL" archive main | tar -x -C plugins/palate-website-builder
echo "synced $(cat plugins/palate-website-builder/VERSION) from $SKILL"
