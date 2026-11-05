#!/usr/bin/env bash
# Deploy the current scaffolded project to a Vercel PREVIEW deployment and print
# a shareable URL for client feedback. This is the default preview handover:
# every pause point (Explore variants, Composed site) is shared as a live
# *.vercel.app link with the Vercel Toolbar (point-and-click Comments).
#
# It is NOT a production deploy: no --prod, no custom domain, and no Sanity
# project is required - the build runs on the src/lib/content.ts fallback layer.
# Idempotent (env upserts; `vercel link --yes` reuses the link).
#
#   Usage: deploy-preview.sh <project-dir> <slug> [--explore]
#
#   --explore  turn the bottom-right direction picker + section labels ON
#              (PUBLIC_EXPLORE_MODE=true) so the client can pick a direction.
#              Omit it for the composed-site confirmation preview.
#
# Requires `vercel login` (assumed done). The shareable link opens WITHOUT a
# Vercel login automatically: the script enables automation Protection Bypass
# via the CLI (`vercel project protection enable ... --protection-bypass`) and
# appends the secret to the URL. No dashboard step, no extra token.
# See references/hosting-vercel.md.
set -euo pipefail
PROJ="${1:?project dir}"; SLUG="${2:?slug}"
EXPLORE="false"
for a in "$@"; do case "$a" in --explore) EXPLORE="true";; esac; done
PROJECT="${SLUG}-site"

command -v vercel >/dev/null 2>&1 \
  || { echo "vercel CLI not installed. Run: npm i -g vercel" >&2; exit 1; }
cd "$PROJ"
[ -f package.json ] || { echo "DEPLOY_FAIL: no package.json in $PROJ (not a scaffolded site)" >&2; exit 1; }

echo "linking Vercel project '${PROJECT}'..."
vercel link --yes --project "$PROJECT" >/dev/null

# Idempotent env upsert (vercel env add errors if the key exists).
upsert_env() {
  local key="$1" value="$2" target="$3"
  [ -n "$value" ] || return 0
  vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" "$target" >/dev/null
}

# Build-time vars for the PREVIEW environment. No Sanity project yet, so the
# build renders from content.ts. The private brand package needs the token.
upsert_env GITHUB_PACKAGES_TOKEN "${GITHUB_PACKAGES_TOKEN:-}" preview
upsert_env PUBLIC_SANITY_VISUAL_EDITING_ENABLED "false"       preview
upsert_env PUBLIC_EXPLORE_MODE "$EXPLORE"                      preview

echo "deploying preview (explore=${EXPLORE})..."
URL=$(vercel deploy --yes | tail -1)
[ -n "$URL" ] || { echo "DEPLOY_FAIL: no URL returned by vercel deploy" >&2; exit 1; }

# Make the link open for ANYONE (a client not on the Vercel team) - fully
# automatic, no dashboard step. Enable automation Protection Bypass with a
# stable per-project secret (persisted + gitignored so previously shared links
# keep working) and append it to the URL.
SECRET_FILE=".palate-vercel-bypass"
if [ -f "$SECRET_FILE" ]; then
  BYPASS="$(cat "$SECRET_FILE")"
else
  BYPASS="$(LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 32)"
  printf '%s' "$BYPASS" > "$SECRET_FILE"
fi
if vercel project protection enable "$PROJECT" --protection-bypass --protection-bypass-secret "$BYPASS" --non-interactive >/dev/null 2>&1; then
  echo "PROTECTION_BYPASS:enabled"
else
  echo "PROTECTION_BYPASS:reused-existing"
fi
SHARE="${URL}?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=true"

echo "PREVIEW_DEPLOYED:${PROJECT}"
echo "PREVIEW_URL:${URL}"
echo "SHAREABLE_URL:${SHARE}"
[ "$EXPLORE" = "true" ] && echo "EXPLORE_MODE:on (direction picker visible)" || echo "EXPLORE_MODE:off"
echo "Send SHAREABLE_URL to the client: it opens with no Vercel login. Logged-in reviewers can also leave Toolbar Comments."
