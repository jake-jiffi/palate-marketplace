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

# Every dependency is checked, not just playwright. Guarding the install on ONE package
# means an existing install never picks up a newly added one: axe-core would have been
# permanently absent on every machine that had already run setup, and verify-rendered
# would have reported accessibility UNMEASURED forever with setup.sh insisting it was done.
# @huggingface/transformers is the local appearance head (grade-local.mjs). The PACKAGE is a
# few MB; the ~356MB SigLIP vision tower is downloaded on first grade, not here, and
# grade-local.mjs announces it before it starts.
missing=""
for dep in playwright axe-core @huggingface/transformers; do
  [ -d "node_modules/$dep" ] || missing="$missing $dep"
done
if [ -n "$missing" ]; then
  echo "[setup] installing npm packages:$missing"
  npm install --no-audit --no-fund --silent || { echo "[setup] npm install failed" >&2; exit 1; }
  for dep in $missing; do
    [ -d "node_modules/$dep" ] || { echo "[setup] $dep still missing after npm install" >&2; exit 1; }
  done
else
  echo "[setup] npm packages already present."
fi

# --with-taste pre-fetches the ~356MB SigLIP vision tower so the local grade never surprises
# someone with a third of a gigabyte in the middle of a build. Without it the appearance head
# refuses and the grade says what that cost.
if [ "${1:-}" = "--with-taste" ]; then
  echo "[setup] fetching the SigLIP vision tower (~356MB, once)..."
  PALATE_TASTE=1 node -e "import('./taste-local.mjs').then(m=>m.warmTaste({onFirstDownload:()=>console.log('[setup]   downloading...')})).then(()=>console.log('[setup] appearance head ready.')).catch(e=>{console.error('[setup] taste model failed: '+e.message);process.exit(1)})" || exit 1
fi

echo "[setup] ensuring headless chromium (cached after first run)..."
npx --yes playwright install chromium || { echo "[setup] chromium install failed" >&2; exit 1; }

echo "[setup] OK - capture engine ready."
