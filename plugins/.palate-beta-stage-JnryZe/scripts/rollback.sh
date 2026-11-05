#!/usr/bin/env bash
# Roll back a build for a slug. By default rolls back only the site
# (Cloudflare worker, Sanity project, GitHub repo). --include-brand also
# archives the brand repo and attempts to unpublish the package.
# Usage: rollback.sh <slug> [--include-brand] [--yes]
set -euo pipefail
SLUG="${1:?slug}"; INCLUDE_BRAND=0; CONFIRM=0
for a in "$@"; do case "$a" in --include-brand) INCLUDE_BRAND=1;; --yes) CONFIRM=1;; esac; done

echo "ROLLBACK PLAN for ${SLUG}:"
echo "  - delete Cloudflare worker ${SLUG}-site"
echo "  - delete Sanity project (tagged palate:project-slug=${SLUG})"
echo "  - delete GitHub repo palate-projects/${SLUG}"
[ "$INCLUDE_BRAND" = "1" ] && echo "  - archive brand repo palate-projects/${SLUG}-brand + unpublish package"
[ "$CONFIRM" = "1" ] || { echo "DRY RUN. Re-run with --yes to execute."; exit 0; }

echo "deleting GitHub repo..."; gh repo delete "palate-projects/${SLUG}" --yes 2>/dev/null || echo "  (skip)"
echo "deleting Cloudflare worker..."; wrangler delete --name "${SLUG}-site" 2>/dev/null || echo "  (skip/manual)"
echo "Sanity project deletion is manual via the management API (safety)."
if [ "$INCLUDE_BRAND" = "1" ]; then
  gh repo archive "palate-projects/${SLUG}-brand" --yes 2>/dev/null || echo "  (brand archive skip)"
  echo "  package unpublish has time limits; do manually if within window."
fi
echo "ROLLBACK_DONE"
