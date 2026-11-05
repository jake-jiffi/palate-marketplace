#!/usr/bin/env bash
# screenshot-build.sh - shoot a locally-served build for the VISUAL LOOP.
#
# Thin wrapper around scripts/reference-capture/screenshot-build.mjs (mirrors
# capture-reference-site.sh). Ensures the SAME Playwright + headless Chromium the
# capture engine uses are present (idempotent, cached after first run), then drives
# the served build and writes retina full-page + per-section PNGs, an errors.json,
# and a sibling manifest under <out-dir>.
#
# Usage:
#   screenshot-build.sh --url <http://localhost:PORT> --out <dir> [--label v1] [--sections]
# Example:
#   screenshot-build.sh --url http://localhost:4321 --out .palate-shots --label v1 --sections
#
# Exit 0 even on a capture problem (the loop reads the manifest, never crashes the
# build); exits non-zero only if Playwright itself cannot be installed.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP_DIR="${SCRIPT_DIR}/reference-capture"

# --- ensure the Playwright npm package (shared with the capture engine) ----
if [ ! -d "${CAP_DIR}/node_modules/playwright" ]; then
  echo "[shot] installing playwright (first run only)..."
  ( cd "$CAP_DIR" && npm install --no-audit --no-fund --silent ) \
    || { echo "[shot] npm install failed" >&2; exit 1; }
fi

# --- ensure headless Chromium (cached in ~/.cache/ms-playwright) ------------
( cd "$CAP_DIR" && npx --yes playwright install chromium >/dev/null 2>&1 ) \
  || echo "[shot] note: 'playwright install chromium' reported an issue; continuing if a cached build exists" >&2

# --- run (pass every CLI flag straight through) -----------------------------
node "${CAP_DIR}/screenshot-build.mjs" "$@"
