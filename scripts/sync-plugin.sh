#!/usr/bin/env bash
# Sync the vendored customer plugin from the skill repo's main branch.
# Run at every release, AFTER the skill repo's version bump is pushed:
#   ./scripts/sync-plugin.sh [path-to-skill-clone]
# The plugin is vendored (source "./plugins/palate-website-builder") so
# /plugin install never needs a second git clone: Claude Code's installer
# clones plugin git sources over SSH with strict host checking, which fails
# on machines that never connected to GitHub (anthropics/claude-code#50725);
# marketplace add itself has an HTTPS fallback, so the vendored copy is the
# transport-safe path.
#
# From 2.0 the source is the live-design tree, which needs the same packaging
# step as beta (the skill nested under skills/, a root compatibility marker,
# the Codex manifest, provenance). build-beta.mjs does that for both tracks;
# the prod track keeps the source's own name and command namespace.
set -euo pipefail
SKILL="${1:-$HOME/dev/palate/skill}"
MARKETPLACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(git -C "$SKILL" show main:VERSION | tr -d '[:space:]')"
node "$MARKETPLACE/scripts/build-beta.mjs" --source "$SKILL" --marketplace "$MARKETPLACE" \
  --version "$VERSION" --track prod > /dev/null
echo "synced $VERSION from $SKILL main"
