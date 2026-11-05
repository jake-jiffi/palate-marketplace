#!/usr/bin/env bash
# Verify Phase E: domain resolves and serves the site.
# Usage: verify-domain.sh <domain>
set -euo pipefail
DOMAIN="${1:?domain}"
code=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}" 2>/dev/null || echo "000")
[ "$code" = "200" ] && echo "DOMAIN_OK" || echo "DOMAIN_PENDING (got $code; DNS/SSL may still be propagating)"
