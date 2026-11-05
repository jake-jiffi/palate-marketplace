#!/usr/bin/env bash
# Tests the axe pass inside verify-rendered.mjs: the accessibility rules the GRADER
# scores, run locally at every viewport so a build that clears this gate does not lose
# those points on a re-grade.
#
# Three directions, because the first two alone would have passed every silent-skip bug
# this product has shipped:
#   1. a page with real violations FIRES, one finding per rule
#   2. a clean page is SILENT (no false positives; axe `incomplete` must never block)
#   3. a MISSING axe-core BLOCKS LOUDLY rather than reporting a clean page
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
VR="$DIR/../reference-capture/verify-rendered.mjs"
NM="$DIR/../reference-capture/node_modules/axe-core"
FIX="$DIR/fixtures/a11y"
TMP="$(mktemp -d)"; pass=0; fail=0
trap 'kill %1 %2 2>/dev/null; rm -rf "$TMP"' EXIT

check() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then echo "ok   - $desc"; pass=$((pass + 1));
  else echo "FAIL - $desc (got '$got', want '$want')"; fail=$((fail + 1)); fi
}

(cd "$FIX/broken" && python3 -m http.server 8731 >/dev/null 2>&1) &
(cd "$FIX/clean"  && python3 -m http.server 8732 >/dev/null 2>&1) &
sleep 2

# 1. Every rule fires, at all three viewports. Rules are asserted individually: a
#    total-count assertion passes even when one rule silently stops working.
node "$VR" --url http://localhost:8731 --routes / --out "$TMP/broken" >/dev/null 2>&1
for rule in color-contrast button-name link-name label image-alt html-has-lang \
            document-title landmark-one-main heading-order; do
  n=$(node -e "const f=require('$TMP/broken/interaction.json').interaction_failures;
      console.log(f.filter(x=>x.rule==='$rule').length)" 2>/dev/null)
  check "$rule fires at all 3 viewports" "$n" "3"
done

# Blocking entries must carry `msg`: the stop hook samples that field, and without it the
# build is blocked with [object Object], which an agent cannot act on.
withmsg=$(node -e "const f=require('$TMP/broken/interaction.json').interaction_failures;
    console.log(f.every(x=>typeof x.msg==='string'&&x.msg.length>20))" 2>/dev/null)
check "every blocking entry carries an actionable msg" "$withmsg" "true"

# 2. No false positives. Counted over AXE rules only: this file tests the axe pass, and
# the same artefact also carries design-measure findings (the fixture's 20px link genuinely
# misses WCAG 2.5.8), which are a separate gate with its own coverage.
node "$VR" --url http://localhost:8732 --routes / --out "$TMP/clean" >/dev/null 2>&1
n=$(node -e "const f=require('$TMP/clean/interaction.json').interaction_failures;
    const AXE=['color-contrast','button-name','link-name','input-button-name','select-name',
      'label','form-field-multiple-labels','html-has-lang','document-title','image-alt',
      'landmark-one-main','heading-order'];
    console.log(f.filter(x=>AXE.includes(x.rule)).length)" 2>/dev/null)
check "clean page produces zero axe findings" "$n" "0"

# 3. A missing dependency is a BLOCKED gate, not a pass.
mv "$NM" "$NM.hidden"
out=$(node "$VR" --url http://localhost:8732 --routes / --out "$TMP/noaxe" 2>&1)
mv "$NM.hidden" "$NM"
echo "$out" | grep -q "UNMEASURED" && r=yes || r=no
check "missing axe-core reports UNMEASURED, never clean" "$r" "yes"

echo "----"
echo "verify-rendered-a11y.test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
