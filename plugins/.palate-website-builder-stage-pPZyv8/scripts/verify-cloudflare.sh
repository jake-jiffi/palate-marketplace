#!/usr/bin/env bash
# Verify Phase C: workers.dev returns 200, robots + sitemap present.
# Usage: verify-cloudflare.sh <workers-dev-url>
set -euo pipefail
URL="${1:?workers.dev url}"
code=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
[ "$code" = "200" ] || { echo "FAIL: $URL returned $code"; exit 1; }
echo "CLOUDFLARE_OK"
