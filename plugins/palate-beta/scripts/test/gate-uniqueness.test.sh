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

# --- THE ARCHIVED STYLESHEET IS NOT A STYLE SIGNATURE --------------------------------------
# boards-render inlines the build's whole stylesheet into every archived render so the render
# survives the next build. That stylesheet is one shared Tailwind output, byte-identical on
# every board, so signing it puts the style axis near 1.00 for every pair and collapses this
# gate to structure-only, silently. Two boards whose actual styling differs must still read
# as differing.
AC="$(mktemp -d)"
shared='<style data-palate-archived-css="1">.a{color:#111111}.b{background:#222222}.c{font-family: Georgia, serif}.d{border-radius: 4px}</style>'
printf '<html><head>%s</head><body><section class="hero"><h1 style="color:#2f5d50">a</h1></section></body></html>\n' "$shared" > "$AC/a.html"
printf '<html><head>%s</head><body><main class="wall"><h2 style="color:#8a3b12">b</h2></main></body></html>\n' "$shared" > "$AC/b.html"
uniq_out="$(node "$GATE" "$AC/a.html" "$AC/b.html" 2>&1 >/dev/null || true)"
style_score="$(printf '%s' "$uniq_out" | sed -n 's/.*style \([0-9.]*\).*/\1/p' | head -1)"
awk -v s="${style_score:-1}" 'BEGIN { exit !(s <= 0.2) }' \
  && { echo "ok   - the shared archived stylesheet is stripped before signing (style ${style_score:-?})"; pass=$((pass+1)); } \
  || { echo "FAIL - the archived stylesheet is being signed, so the style axis is ~1 on every pair (style ${style_score:-?})"; fail=$((fail+1)); }
rm -rf "$AC"

# --- --project FINDS THE RENDERS, in both places they live ---------------------------------
# gate-done.sh used to glob `.palate-shots/v*/rendered.html` in the shell. Explore writes its
# renders to `.palate/explore/shots/b*/` now, so that glob found nothing and every board build
# reported "fewer than 2 to compare" with five renders sitting on disk: a gate switched off by
# a path, silently, which is the class of fault this suite exists for.
PT="$(mktemp -d)"
mkdir -p "$PT/.palate/explore/shots/b1" "$PT/.palate/explore/shots/b2"
cp "$DIR/fixtures/uniq-a.html" "$PT/.palate/explore/shots/b1/rendered.html"
cp "$DIR/fixtures/uniq-b.html" "$PT/.palate/explore/shots/b2/rendered.html"
check "--project finds two board renders and compares them" 0 --project "$PT"

cp "$DIR/fixtures/uniq-dup.html" "$PT/.palate/explore/shots/b2/rendered.html"
check "--project blocks a near-duplicate pair of boards" 2 --project "$PT"

# The older shape still counts, so a site mid-flight is not suddenly unchecked.
rm -rf "$PT/.palate"
mkdir -p "$PT/.palate-shots/v1" "$PT/.palate-shots/v2"
cp "$DIR/fixtures/uniq-a.html" "$PT/.palate-shots/v1/rendered.html"
cp "$DIR/fixtures/uniq-b.html" "$PT/.palate-shots/v2/rendered.html"
check "--project still finds the older /vN renders" 0 --project "$PT"

# ONE render is nothing to compare, and it says so in the shape gate-done reads.
rm -rf "$PT/.palate-shots/v2"
one_err="$(node "$GATE" --project "$PT" 2>&1 >/dev/null || true)"
case "${one_err%%$'\n'*}" in
  "uniqueness gate: skipped ("*) echo "ok   - one render skips with the reason, in the shape gate-done reads"; pass=$((pass+1)) ;;
  *) echo "FAIL - one render did not print the skip line (got: ${one_err%%$'\n'*})"; fail=$((fail+1)) ;;
esac
rm -rf "$PT"

echo "---"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]

