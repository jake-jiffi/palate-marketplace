#!/usr/bin/env bash
# Phase C: provision Cloudflare Workers. Uploads secrets (incl Sanity write
# token for the form handler), does the initial local deploy (local has .npmrc
# so the brand package installs). Subsequent deploys go through CI.
# Usage: provision-cloudflare.sh <slug> <write-token>
set -euo pipefail
SLUG="${1:?slug}"; WRITE_TOKEN="${2:?sanity write token}"
WORKER="${SLUG}-site"

echo "uploading Worker secrets..."
# Read token + others from .env; write token passed in (never in .env)
set -a; [ -f .env ] && . ./.env; set +a
printf '%s' "${SANITY_API_READ_TOKEN:-}" | wrangler secret put SANITY_API_READ_TOKEN --name "$WORKER" >/dev/null 2>&1 || true
printf '%s' "$WRITE_TOKEN"               | wrangler secret put SANITY_API_WRITE_TOKEN --name "$WORKER" >/dev/null 2>&1 || true
printf '%s' "${RESEND_API_KEY:-}"        | wrangler secret put RESEND_API_KEY --name "$WORKER" >/dev/null 2>&1 || true
printf '%s' "${TURNSTILE_SECRET:-}"      | wrangler secret put TURNSTILE_SECRET --name "$WORKER" >/dev/null 2>&1 || true

echo "initial local build + deploy..."
npm run build
wrangler deploy
echo "CLOUDFLARE_PROVISIONED:${WORKER}"
