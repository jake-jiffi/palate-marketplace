#!/usr/bin/env bash
# Promote a preview build to production. Verifies the preview is a real Astro
# project FIRST (anti-freestyle gate), then flips the stage so the build
# pipeline runs phases B-F on the SAME project. No rebuild.
# Run from the project directory. Usage: promote-to-production.sh
set -euo pipefail
[ -f .palate-skill-state.json ] || { echo "no project state here; run a preview build first" >&2; exit 1; }

stage=$(jq -r '.stage' .palate-skill-state.json)
if [ "$stage" = "production" ]; then
  echo "already in production stage; resuming production phases"
else
  # Gate 1: the preview MUST be a real Astro project before we promote it.
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  echo "verifying the preview is a real Astro build before promoting..."
  bash "$SCRIPT_DIR/verify-is-real-astro.sh" || {
    echo "REFUSING TO PROMOTE: the preview is not a real Astro project." >&2
    echo "Fix Phase A (scaffold from template) before promoting to production." >&2
    exit 2
  }

  # Gate 2: the PRODUCTION preflight MUST pass before we flip the stage. A preview
  # is built with preview-preflight only (no cloud creds), so promotion is the
  # first time the production credentials are actually required. Run the full
  # production preflight HERE so a missing credential fails loudly and early with
  # its remediation, rather than dying mid-provision inside provision-sanity.sh.
  # Mirror the build flow: production targets the chosen host (default vercel).
  export PALATE_HOST="${PALATE_HOST:-vercel}"
  echo "running the production preflight before promoting (host: ${PALATE_HOST})..."
  bash "$SCRIPT_DIR/preflight.sh" || {
    echo "REFUSING TO PROMOTE: the production preflight failed." >&2
    echo "Fix the missing credential it reported above, then re-run promotion." >&2
    exit 2
  }

  tmp=$(mktemp)
  jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.stage="production" | .skill.lastUpdatedAt=$ts' \
    .palate-skill-state.json > "$tmp" && mv "$tmp" .palate-skill-state.json
  echo "promoted to production stage."
fi
echo "Next: the build pipeline runs phases sanity -> cloudflare -> github -> domain -> optional on this project."
