#!/usr/bin/env bash
# setup.sh - install the capture engine's dependencies. Idempotent.
#
# Run once before a capture batch. Installs the Playwright npm package and the
# headless Chromium build (cached in ~/.cache/ms-playwright after first run).
# Safe to re-run. If a 45s shell-call limit interrupts it, just run it again -
# both npm and 'playwright install' resume from where they stopped.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -d node_modules/playwright ]; then
  echo "[setup] installing the playwright npm package..."
  npm install --no-audit --no-fund --silent || { echo "[setup] npm install failed" >&2; exit 1; }
else
  echo "[setup] playwright npm package already present."
fi

echo "[setup] ensuring headless chromium (cached after first run)..."
npx --yes playwright install chromium || { echo "[setup] chromium install failed" >&2; exit 1; }

echo "[setup] OK - capture engine ready."
