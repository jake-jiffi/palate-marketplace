#!/usr/bin/env bash
# Add the Sanity CMS to a scaffolded Palate project. The default scaffold ships
# with NO CMS, so run this ONLY when the build genuinely needs one: the client
# will edit their own copy, or content is collection-shaped (blog, case studies,
# menu, listings). A brochure site that changes twice a year does not need it,
# and carrying it costs ~850 packages.
#
#   Usage:  scripts/add-sanity.sh <project-dir>
#
# Safe to run at ANY point after Phase A - during the build, at Phase B
# provisioning, or months later in continue-mode. It is ADDITIVE and idempotent:
#
#   * it never edits astro.config.mjs or BaseLayout.astro (both are customised
#     per build). They already delegate to astro.cms.mjs and CmsVisualEditing
#     .astro, and this script REPLACES those two files wholesale.
#   * output stays "server" and every page keeps calling loadPage(), so NO page
#     is touched and nothing is rebuilt.
#
# After this, provision the Sanity project itself with scripts/provision-sanity.sh.
# See references/cms-and-draft-preview.md.
set -euo pipefail
PROJ="${1:?project dir}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="${SKILL_DIR}/templates/cms-sanity"

[ -d "$OVERLAY" ] || { echo "add-sanity: overlay not found at $OVERLAY" >&2; exit 1; }
[ -d "$PROJ" ]    || { echo "add-sanity: project dir not found at $PROJ" >&2; exit 1; }
[ -f "$PROJ/package.json" ] || { echo "add-sanity: $PROJ is not a project (no package.json)" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "add-sanity: jq is required" >&2; exit 1; }

# The seam must exist, or this is not a Palate scaffold (or it predates the
# opt-in CMS split) and the wholesale file swaps below would silently do nothing.
grep -q "cmsIntegrations" "$PROJ/astro.config.mjs" 2>/dev/null || {
  echo "add-sanity: $PROJ/astro.config.mjs does not spread ...cmsIntegrations(env)." >&2
  echo "  This project predates the opt-in CMS seam. Add these two lines by hand first:" >&2
  echo "    import { cmsIntegrations } from \"./astro.cms.mjs\";" >&2
  echo "    integrations: [ ...cmsIntegrations(env), /* existing */ ]" >&2
  exit 1
}

echo "adding Sanity -> $PROJ"

# 1. The two seam files the base ships as no-ops, replaced wholesale.
cp "$OVERLAY/astro.cms.mjs"                        "$PROJ/astro.cms.mjs"
cp "$OVERLAY/src/components/CmsVisualEditing.astro" "$PROJ/src/components/CmsVisualEditing.astro"

# 2. The files that gain a Sanity-backed implementation. loadPage() keeps its
#    signature, so every caller is unaffected.
cp "$OVERLAY/src/lib/load.ts"         "$PROJ/src/lib/load.ts"
cp "$OVERLAY/src/env.d.ts"            "$PROJ/src/env.d.ts"
cp "$OVERLAY/src/pages/api/contact.ts" "$PROJ/src/pages/api/contact.ts"

# 3. The Sanity-only files: Studio config, schemas, image helper, seed scripts.
mkdir -p "$PROJ/src/sanity/schema" "$PROJ/src/lib" "$PROJ/scripts"
cp "$OVERLAY/sanity.config.ts"        "$PROJ/sanity.config.ts"
cp "$OVERLAY/src/lib/sanity.ts"       "$PROJ/src/lib/sanity.ts"
cp "$OVERLAY"/src/sanity/schema/*.ts  "$PROJ/src/sanity/schema/"
cp "$OVERLAY"/scripts/*.mjs           "$PROJ/scripts/"

# 4. Merge deps + scripts. The project's own values WIN on conflict, so a build
#    that pinned something deliberately is never silently downgraded.
jq -s '.[0] as $o | .[1]
       | .dependencies    = (($o.dependencies    // {}) + (.dependencies    // {}))
       | .devDependencies = (($o.devDependencies // {}) + (.devDependencies // {}))
       | .scripts         = (($o.scripts         // {}) + (.scripts         // {}))' \
   "$OVERLAY/deps.json" "$PROJ/package.json" > "$PROJ/package.json.tmp"
mv "$PROJ/package.json.tmp" "$PROJ/package.json"

# 5. Document the env vars (idempotent - only if not already there).
if [ -f "$PROJ/.env.example" ] && ! grep -q "SANITY_PROJECT_ID" "$PROJ/.env.example"; then
  cat >> "$PROJ/.env.example" <<'ENVVARS'

# --- Sanity (added by scripts/add-sanity.sh) ---
# Build-time vars - @sanity/astro reads these at `astro build`, so CI must pass
# them to the build step (the scaffold's ci.yml already does).
SANITY_PROJECT_ID=
SANITY_DATASET=production
SANITY_API_READ_TOKEN=

# "true" on the PREVIEW environment only - turns on click-to-edit overlays.
PUBLIC_SANITY_VISUAL_EDITING_ENABLED=false

# Runtime - the EDITOR token, used by /api/contact and the seed scripts.
SANITY_API_WRITE_TOKEN=
ENVVARS
fi

echo "SANITY_ADDED: $PROJ"
echo "Next:"
echo "  cd $PROJ && npm install     # pulls the Sanity tree (~850 packages)"
echo "  npm run build               # confirm it still compiles"
echo "  scripts/provision-sanity.sh <slug> <display-name> <site-domain>   # Phase B"
echo "  the Studio is embedded at /studio - there is no separate Studio to deploy"
