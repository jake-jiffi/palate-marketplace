#!/usr/bin/env bash
# Initialise .palate-skill-state.json
# Usage: state-init.sh <slug> <client-name> <domain> [stage] [brand_mode] [--force]
#   stage:      preview (default) | production
#   brand_mode: brand-creation (default) | brand-provided
#   --force:    overwrite an existing state file (see below)
#
# IT REFUSES TO CLOBBER. This script used to `cat >` over whatever was there, so re-running it
# on a resumed or repeated build silently reset every phase to "pending" and reset brandMode to
# its default. Both are load-bearing: the phases are how a partial build is resumable at all,
# and brandMode is read by the DIVERGE wall (hooks/palate-pretooluse.mjs) to decide WHICH axes
# the build must diverge on, so a brand-provided build quietly re-armed with the brand-creation
# bar and was then told to vary the client's colours. Resuming is scripts/state-resume.sh;
# starting over is --force, out loud.
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

# --force may sit anywhere in the arguments; everything else keeps its position.
FORCE=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}   # bash 3.2 (macOS) errors on "${ARGS[@]}" when empty under set -u

SLUG="${1:?slug}"; CLIENT="${2:?client}"; DOMAIN="${3:?domain}"; STAGE="${4:-preview}"; BRAND_MODE="${5:-brand-creation}"
STATE=".palate-skill-state.json"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
case "$STAGE" in preview|production) ;; *) echo "stage must be preview or production" >&2; exit 1;; esac
case "$BRAND_MODE" in brand-creation|brand-provided) ;; *) echo "brand_mode must be brand-creation or brand-provided" >&2; exit 1;; esac

if [ -e "$STATE" ] && [ "$FORCE" != "1" ]; then
  echo "refusing to overwrite the existing $STATE in $(pwd)." >&2
  echo "  It holds this build's phase progress and its brandMode, and overwriting resets both:" >&2
  echo "  a resumed build loses which phases completed, and the DIVERGE wall re-arms on the wrong axes." >&2
  echo "  To CONTINUE the existing build: scripts/state-resume.sh (or scripts/state-update.sh to change a field)." >&2
  echo "  To START OVER and discard it:   scripts/state-init.sh $* --force" >&2
  exit 1
fi

cat > "$STATE" <<JSON
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
