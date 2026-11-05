#!/usr/bin/env bash
# Verify the brand package exports the entry points the site depends on.
#
# Two faults this used to have, both of which mattered for PARTIAL brands:
#
#  1. `./fonts.css` was treated as mandatory, so a client who provided colours and no
#     type published a package with no fonts.css and the check called it broken. Phase 0
#     then routed it to "older format, regenerate or vendor", which throws away a real
#     brand. Doctrine is the opposite: a partial brand IS a provided brand, lock the given
#     half and choose the missing half to fit. So fonts.css is now OPTIONAL and its absence
#     is REPORTED as "type is a free axis" rather than as a defect.
#
#  2. `npm view ... || echo "{}"` collapsed a network/auth failure into an empty exports
#     map, so "I could not reach the registry" printed exactly the same MISSING_EXPORTS
#     line as "this package really is missing tokens.css". Those need different responses,
#     so a failed lookup now exits 2 and says so.
#
# Usage: verify-brand-exports.sh <slug> <version>
# Prints: OK                          both halves present
#         OK:PARTIAL:type-free        colour tokens present, no fonts.css, type is free
#         MISSING_EXPORTS:<list>      a required export is genuinely absent   (exit 1)
#         CANNOT_VERIFY:<reason>      the registry could not be asked         (exit 2)
set -euo pipefail
SLUG="${1:?slug required}"
VERSION="${2:?version required}"
PKG="@palate-projects/${SLUG}-brand"
REGISTRY="https://npm.pkg.github.com"

if ! exports=$(npm view "${PKG}@${VERSION}" exports --registry="$REGISTRY" --json 2>&1); then
  echo "CANNOT_VERIFY:npm view ${PKG}@${VERSION} failed against ${REGISTRY} (auth or network). This is NOT a missing-exports result: $(printf '%s' "$exports" | tr '\n' ' ' | cut -c1-160)"
  exit 2
fi
if ! printf '%s' "$exports" | jq -e 'type == "object"' >/dev/null 2>&1; then
  echo "CANNOT_VERIFY:${PKG}@${VERSION} returned no exports map (got: $(printf '%s' "$exports" | tr '\n' ' ' | cut -c1-80))"
  exit 2
fi

has() { printf '%s' "$exports" | jq -e --arg k "$1" 'has($k)' >/dev/null 2>&1; }

# Required: the colour/token core and the preset that maps it into the site's utilities.
required=("./tokens.css" "./tailwind.preset" "./components/*")
missing=()
for exp in "${required[@]}"; do has "$exp" || missing+=("$exp"); done
if [ ${#missing[@]} -gt 0 ]; then
  echo "MISSING_EXPORTS:${missing[*]}"
  exit 1
fi

# Optional: the type half. Absent means the client gave no type, which is a legitimate
# partial brand, and the caller must record it as `locked.type: false` in brand-record.json
# so DIVERGE knows type is the axis it may vary.
if has "./fonts.css"; then
  echo "OK"
else
  echo "OK:PARTIAL:type-free"
fi
