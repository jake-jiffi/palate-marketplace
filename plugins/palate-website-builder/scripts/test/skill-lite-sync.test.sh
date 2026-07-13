#!/usr/bin/env bash
# Drift guard (mirrors anti-patterns-sync.test.sh): the committed per-tool skill-lite files
# MUST equal a fresh projection of references/core-doctrine.md. Never hand-edit the generated
# files; edit the doctrine and run `node scripts/gen-skill-lite.mjs`.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if node "$DIR/scripts/gen-skill-lite.mjs" --check; then
  echo "PASS: skill-lite is in sync with references/core-doctrine.md"
else
  echo "FAIL: skill-lite/ drifted from references/core-doctrine.md"
  echo "  re-sync: node scripts/gen-skill-lite.mjs"
  exit 1
fi
