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

# --- the class capture actually fires ------------------------------------------------------
# The original one-regex signature put a lazy [^>]*? before an OPTIONAL class group, so the
# capture NEVER fired, every element signed as `tag.`, and two genuinely different pages
# scored structure 1.00. TWO real builds hit the false block and adjudicated around the gate.
# On brand-provided builds style is legitimately ~1.0, so a blind structural half blocks
# EVERY multi-variant Explore.
UT="$(mktemp -d)"
cat > "$UT/a.html" <<'HTML'
<html><body><section class="hero hero--calm"><div class="grid"><h2 class="t">x</h2></div></section></body></html>
HTML
cat > "$UT/b.html" <<'HTML'
<html><body><section class="masthead"><div class="cards"><h2 class="lede">y</h2></div></section></body></html>
HTML
if node "$GATE" "$UT/a.html" "$UT/b.html" >/dev/null 2>&1; then
  echo "ok   - two structurally different pages are NOT near-duplicates"; pass=$((pass+1))
else
  echo "FAIL - two structurally different pages false-blocked (the class capture is blind again)"; fail=$((fail+1))
fi
if node "$GATE" "$UT/a.html" "$UT/a.html" >/dev/null 2>&1; then
  echo "FAIL - an identical pair passed (the gate cannot see duplicates at all)"; fail=$((fail+1))
else
  echo "ok   - an identical pair still blocks"; pass=$((pass+1))
fi
rm -rf "$UT"

echo "---"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]

