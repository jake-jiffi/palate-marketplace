#!/usr/bin/env bash
# Apply the Cloudflare hosting overlay to a scaffolded project. The template is
# Vercel-native by default, so run this ONLY when the build's host is Cloudflare
# (`--host cloudflare`), during Phase A AFTER `templates/astro-project/` has been
# copied into the project directory. Idempotent.
#
#   Usage:  scripts/switch-host-cloudflare.sh <project-dir>
#
# See references/hosting-vercel.md for the host model (Vercel default, Cloudflare
# backup).
set -euo pipefail
PROJ="${1:?project dir}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY="${SKILL_DIR}/templates/host-cloudflare"

[ -d "$OVERLAY" ] || { echo "switch-host-cloudflare: overlay not found at $OVERLAY" >&2; exit 1; }
[ -d "$PROJ" ]    || { echo "switch-host-cloudflare: project dir not found at $PROJ" >&2; exit 1; }

echo "applying Cloudflare overlay -> $PROJ"

# Host-specific config, deps and env conventions.
for f in astro.config.mjs package.json .env.example wrangler.toml; do
  cp "$OVERLAY/$f" "$PROJ/$f"
done

# Cloudflare edge headers live at public/_headers.
mkdir -p "$PROJ/public"
cp "$OVERLAY/_headers" "$PROJ/public/_headers"

# Cloudflare deploys via GitHub Actions (build-in-CI, wrangler deploy). The
# Vercel baseline ships only ci.yml, so restore the Cloudflare workflows.
mkdir -p "$PROJ/.github/workflows"
cp "$OVERLAY"/.github/workflows/*.yml "$PROJ/.github/workflows/"

# Drop the Vercel-only config.
rm -f "$PROJ/vercel.json"

echo "SWITCHED_TO_CLOUDFLARE: $PROJ"
echo "Next:"
echo "  cd $PROJ && npm install"
echo "  npx wrangler login    # one-time, approves the browser"
echo "  npm run deploy         # or: scripts/provision-cloudflare.sh $(basename "$PROJ" -site)"
