#!/usr/bin/env bash
# Generate only the beta package from the canonical source beta commit.
# Usage: sync-beta.sh [source-clone] [beta-version] [--output <directory>] [--rollback]
# --output builds an isolated candidate without changing marketplace files.
set -euo pipefail
PALATE_SOURCE="${1:-$HOME/dev/palate/skill}"
PALATE_BETA_VERSION="${2:-}"
[ "$#" -eq 0 ] || shift
[ "$#" -eq 0 ] || shift
PALATE_MARKETPLACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "$PALATE_BETA_VERSION" ]; then
  PALATE_SOURCE_VERSION="$(git -C "$PALATE_SOURCE" show beta:VERSION | tr -d '[:space:]')"
  PALATE_BETA_VERSION="${PALATE_SOURCE_VERSION}-beta.1"
fi
exec node "$PALATE_MARKETPLACE/scripts/build-beta.mjs" \
  --source "$PALATE_SOURCE" --marketplace "$PALATE_MARKETPLACE" \
  --version "$PALATE_BETA_VERSION" "$@"
