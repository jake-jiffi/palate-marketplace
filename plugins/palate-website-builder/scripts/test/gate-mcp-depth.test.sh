#!/usr/bin/env bash
# Tests the portable MCP-depth gate against known-good / known-bad manifests.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-mcp-depth.sh"
pass=0; fail=0

check() { # desc  expected_exit  manifest_path
  bash "$GATE" "$3" >/dev/null 2>&1
  local ec=$?
  if [ "$ec" -eq "$2" ]; then
    echo "ok   - $1"; pass=$((pass + 1))
  else
    echo "FAIL - $1 (exit $ec, want $2)"; fail=$((fail + 1))
  fi
}

check "deep build passes" 0 "$DIR/fixtures/manifest-deep.json"
check "shallow build is blocked" 2 "$DIR/fixtures/manifest-shallow.json"
# Fail-open contract: a missing manifest is NOT a tracked build, so the gate SKIPS
# (exit 0), never blocks. A public-plugin user editing an existing app, or one whose
# MCP token is not set, must never be trapped. (The gate is the spine of the fail-open
# invariant; this asserts the contract the gate actually implements, not a stricter one.)
check "missing manifest skips (fail-open)" 0 "$DIR/fixtures/no-such-manifest.json"
check "token/concept-only read is blocked (R2 rich-layer gate)" 2 "$DIR/fixtures/manifest-token-only.json"
check "layer:pages counts as a rich read" 0 "$DIR/fixtures/manifest-pages.json"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
