#!/usr/bin/env bash
# Tests the uniqueness gate against distinct and near-duplicate variant sets.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-uniqueness.mjs"
pass=0; fail=0
check() { node "$GATE" "${@:3}" >/dev/null 2>&1; local ec=$?; if [ "$ec" -eq "$2" ]; then echo "ok   - $1"; pass=$((pass+1)); else echo "FAIL - $1 (exit $ec, want $2)"; fail=$((fail+1)); fi; }
check "two distinct variants pass" 0 "$DIR/fixtures/uniq-a.html" "$DIR/fixtures/uniq-b.html"
check "a variant and its copy fail" 2 "$DIR/fixtures/uniq-a.html" "$DIR/fixtures/uniq-dup.html"
check "three (one a dup) fail" 2 "$DIR/fixtures/uniq-a.html" "$DIR/fixtures/uniq-b.html" "$DIR/fixtures/uniq-dup.html"
echo "---"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
