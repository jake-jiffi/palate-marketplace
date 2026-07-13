#!/usr/bin/env bash
# Initialise .palate-skill-state.json
# Usage: state-init.sh <slug> <client-name> <domain> [stage] [brand_mode]
#   stage:      preview (default) | production
#   brand_mode: brand-creation (default) | brand-provided
#
# brand_mode records whether the build was handed a brand (a brand package / real brand
# tokens or assets / stated colours+fonts) or is inventing the identity. It is determined
# at the end of Phase 0 (brand detection) and set HERE so the DIVERGE wall can scope its
# divergence axes by mode: brand-creation diverges the full identity space (colour + type
# + mood + layout + motion); brand-provided LOCKS colour + type and diverges only layout /
# composition / motion / density / art-direction WITHIN the brand. The default is the
# stricter brand-creation, so an older caller that omits it still demands colour+type
# variation. Read by hooks/palate-pretooluse.mjs and scripts/gate-novelty.mjs.
set -euo pipefail
SLUG="${1:?slug}"; CLIENT="${2:?client}"; DOMAIN="${3:?domain}"; STAGE="${4:-preview}"; BRAND_MODE="${5:-brand-creation}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
case "$STAGE" in preview|production) ;; *) echo "stage must be preview or production" >&2; exit 1;; esac
case "$BRAND_MODE" in brand-creation|brand-provided) ;; *) echo "brand_mode must be brand-creation or brand-provided" >&2; exit 1;; esac
cat > .palate-skill-state.json <<JSON
{
  "schemaVersion": "1.2",
  "skill": { "name": "palate-website-builder", "version": "1.1.0", "startedAt": "${TS}", "lastUpdatedAt": "${TS}" },
  "stage": "${STAGE}",
  "brandMode": "${BRAND_MODE}",
  "client": { "name": "${CLIENT}", "slug": "${SLUG}", "domain": "${DOMAIN}" },
  "brand": { "mode": null, "repoUrl": null, "packageName": null, "packageVersion": null, "vendored": false },
  "design": { "websiteStyle": null, "designMode": null, "references": [] },
  "phases": {
    "brandAsCode": { "status": "pending", "resources": {} },
    "scaffold": { "status": "pending", "resources": {} },
    "previewVerified": { "status": "pending", "resources": {} },
    "sanity": { "status": "pending", "resources": {} },
    "cloudflare": { "status": "pending", "resources": {} },
    "github": { "status": "pending", "resources": {} },
    "domain": { "status": "pending", "resources": {} },
    "optional": { "status": "pending", "resources": {} }
  },
  "cro": { "enabled": false, "dormantUntilSessions": 500 }
}
JSON
echo "state initialised: stage=${STAGE} brandMode=${BRAND_MODE}"
