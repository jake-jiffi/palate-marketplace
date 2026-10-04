#!/usr/bin/env bash
# Verify the Vercel deployment is reachable. Parallel to verify-cloudflare.sh.
#   Usage:  verify-vercel.sh <url>
set -euo pipefail
URL="${1:?url}"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$URL" || echo "000")
echo "VERIFY_VERCEL: $URL -> $code"
[ "$code" = "200" ] \
  || { echo "verify-vercel: deployment not responding 200 ($code)" >&2; exit 1; }
