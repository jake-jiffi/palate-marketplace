#!/usr/bin/env bash
# Phase E: attach the custom domain. If the zone is on Cloudflare, full-auto via
# API. Otherwise emit CNAME + email DNS instructions and mark manual_pending.
# Usage: attach-domain.sh <slug> <domain>
set -euo pipefail
SLUG="${1:?slug}"; DOMAIN="${2:?domain}"; WORKER="${SLUG}-site"
CF="https://api.cloudflare.com/client/v4"
AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN:?}"

# Is the zone on this Cloudflare account?
zone=$(curl -s "${CF}/zones?name=${DOMAIN}" -H "$AUTH" | jq -r '.result[0].id // empty')
if [ -n "$zone" ]; then
  echo "zone on Cloudflare; attaching custom domain to worker..."
  curl -s -X PUT "${CF}/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains" -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"zone_id\":\"${zone}\",\"hostname\":\"${DOMAIN}\",\"service\":\"${WORKER}\",\"environment\":\"production\"}" >/dev/null
  echo "DOMAIN_ATTACHED:${DOMAIN} (SSL provisioning 5-30min; site works on workers.dev meanwhile)"
else
  cat <<TXT
DOMAIN_EXTERNAL:${DOMAIN}
  The domain is not on this Cloudflare account. Give the client these records:
    CNAME  ${DOMAIN}  ->  ${WORKER}.<account>.workers.dev
    (email) add Resend SPF/DKIM records per the Resend dashboard
  Marked manual_pending; re-run verify-domain.sh once DNS propagates.
TXT
fi
