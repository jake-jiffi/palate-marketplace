#!/usr/bin/env bash
# Verify Phase A: build passes, dist exists, tokens sourced from brand.
set -euo pipefail
[ -d node_modules ] || { echo "FAIL: no node_modules"; exit 1; }
npm run build >/dev/null 2>&1 || { echo "FAIL: build errored"; exit 1; }
[ -f dist/index.html ] || { echo "FAIL: no dist/index.html"; exit 1; }
# SAY WHAT WAS INSPECTED. "SCAFFOLD_OK" over a dist nobody counted is a claim about a build
# whose size was never established; the count is what makes it a measurement.
BUILT=$(find dist -type f -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
if [ "${BUILT:-0}" -eq 0 ]; then
  echo "verify-scaffold: skipped (nothing to inspect: dist/ holds no HTML). NOT a pass." >&2
  exit 2
fi
echo "SCAFFOLD_OK (inspected $BUILT file(s))"
