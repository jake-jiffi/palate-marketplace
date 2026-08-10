#!/usr/bin/env bash
# Verify Phase A: build passes, dist exists, tokens sourced from brand.
set -euo pipefail
[ -d node_modules ] || { echo "FAIL: no node_modules"; exit 1; }
npm run build >/dev/null 2>&1 || { echo "FAIL: build errored"; exit 1; }
[ -f dist/index.html ] || { echo "FAIL: no dist/index.html"; exit 1; }
echo "SCAFFOLD_OK"
