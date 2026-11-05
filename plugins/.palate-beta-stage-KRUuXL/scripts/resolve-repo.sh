#!/usr/bin/env bash
# Resolve the brand repo: create palate-projects/{slug}-brand if absent,
# verify it is empty if it already exists. Clones it to the current parent dir.
# Usage: resolve-repo.sh <slug>
# Prints: CLONED:<path> on success
set -euo pipefail
SLUG="${1:?slug required}"
REPO="palate-projects/${SLUG}-brand"
DIR="${SLUG}-brand"

if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "repo $REPO exists; checking it is empty..." >&2
  # An empty repo has no commits. Check via the API.
  commit_count=$(gh api "repos/${REPO}/commits" --jq 'length' 2>/dev/null || echo "0")
  if [ "$commit_count" != "0" ]; then
    echo "RESOLVE_FAIL: $REPO already has commits. It is not empty." >&2
    echo "  If this is a resume, the brand state file will guide continuation." >&2
    echo "  If this is a genuine conflict, choose a different slug or archive the old repo." >&2
    exit 2
  fi
else
  echo "creating private repo $REPO..." >&2
  gh repo create "$REPO" --private --description "Brand-as-code for ${SLUG}" >/dev/null
fi

# Clone (or note already-cloned)
if [ -d "$DIR/.git" ]; then
  echo "already cloned at ./$DIR" >&2
else
  gh repo clone "$REPO" "$DIR" >/dev/null 2>&1 || git clone "https://github.com/${REPO}.git" "$DIR" >/dev/null 2>&1
fi
echo "CLONED:$(cd "$DIR" && pwd)"
