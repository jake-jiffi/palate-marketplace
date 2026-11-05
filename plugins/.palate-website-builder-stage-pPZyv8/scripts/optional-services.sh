#!/usr/bin/env bash
# Phase F: optional services. Humblytics (default) or Plausible, Kit, Turnstile,
# IndexNow. Non-blocking: a failure here warns but does not fail the build.
# Usage: optional-services.sh <slug> <domain> [--analytics=humblytics|plausible]
set -euo pipefail
SLUG="${1:?slug}"; DOMAIN="${2:?domain}"; ANALYTICS="humblytics"
for arg in "$@"; do case "$arg" in --analytics=*) ANALYTICS="${arg#*=}";; esac; done

echo "analytics: ${ANALYTICS}"
case "$ANALYTICS" in
  humblytics) echo "  add the Humblytics script + data-site to BaseLayout (HUMBLYTICS_SITE_ID env)";;
  plausible)  echo "  add the Plausible script for ${DOMAIN} to BaseLayout";;
esac

# IndexNow key for instant search engine notification
KEY=$(openssl rand -hex 16 2>/dev/null || echo "$(date +%s)indexnowkey")
echo "$KEY" > "public/${KEY}.txt" 2>/dev/null || true
echo "  IndexNow key written to public/${KEY}.txt"

echo "  Kit + Turnstile: wired in templates; set KIT_API_KEY and TURNSTILE_* when ready"
echo "OPTIONAL_DONE"
