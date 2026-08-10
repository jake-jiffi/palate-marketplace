#!/usr/bin/env bash
# capture-reference-site.sh - run the headless capture engine over one site.
#
# Wrapper around scripts/reference-capture/capture.mjs. Ensures Playwright and
# headless Chromium are installed (idempotent, cached after first run), then
# captures the site into the deep reference schema under <out-dir>.
#
# Usage:
#   capture-reference-site.sh <slug> <url> <out-dir> [inner-pages-csv] [phase]
# phase is one of: desktop (default) | responsive | full
# Example:
#   capture-reference-site.sh stripe https://stripe.com catalog/stripe /pricing,/customers desktop
#   capture-reference-site.sh stripe https://stripe.com catalog/stripe "" responsive
#
# Designed to run UNATTENDED: an unreachable site exits 0 with a manifest
# marked status:"unreachable" so an overnight batch keeps going.
set -uo pipefail

SLUG="${1:?site slug e.g. stripe}"
URL="${2:?site url e.g. https://stripe.com}"
OUT="${3:?output dir e.g. catalog/stripe}"
INNER="${4:-}"
PHASE="${5:-desktop}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP_DIR="${SCRIPT_DIR}/reference-capture"

# --- ensure the Playwright npm package -------------------------------------
if [ ! -d "${CAP_DIR}/node_modules/playwright" ]; then
  echo "[capture] installing playwright (first run only)..."
  ( cd "$CAP_DIR" && npm install --no-audit --no-fund --silent ) \
    || { echo "[capture] npm install failed" >&2; exit 1; }
fi

# --- ensure headless Chromium (cached in ~/.cache/ms-playwright) ------------
( cd "$CAP_DIR" && npx --yes playwright install chromium >/dev/null 2>&1 ) \
  || echo "[capture] note: 'playwright install chromium' reported an issue; continuing if a cached build exists" >&2

# --- run -------------------------------------------------------------------
ARGS=(--slug "$SLUG" --url "$URL" --out "$OUT" --phase "$PHASE")
[ -n "$INNER" ] && ARGS+=(--inner "$INNER")

node "${CAP_DIR}/capture.mjs" "${ARGS[@]}"
RC=$?
if [ "$RC" -ne 0 ]; then
  echo "[capture] capture.mjs exited $RC" >&2
  exit "$RC"
fi
echo "[capture] complete: ${SLUG} -> ${OUT}"
