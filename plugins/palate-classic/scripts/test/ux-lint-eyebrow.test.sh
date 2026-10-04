#!/usr/bin/env bash
# Tests the tracked-mono "eyebrow" kicker checks in ux-lint.sh:
#   ai-tell-tracked-eyebrow        (block-aware CSS check)
#   ai-tell-tracked-eyebrow-inline (per-line markdown rule, inline style)
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
LINT="$DIR/../ux-lint.sh"
FIX="$DIR/fixtures/uxlint"
pass=0; fail=0

# ux-lint takes a project DIRECTORY, so each case lives in its own dir.
# fires? <desc> <rule-id> <fixture-dir> <want: yes|no>
fires() {
  local desc="$1" rule="$2" dir="$3" want="$4"
  local hits
  hits=$(bash "$LINT" "$dir" --severity Cosmetic --ci 2>/dev/null | grep -c "	$rule	")
  if { [ "$want" = "yes" ] && [ "$hits" -gt 0 ]; } || { [ "$want" = "no" ] && [ "$hits" -eq 0 ]; }; then
    echo "ok   - $desc ($hits hit(s))"; pass=$((pass + 1))
  else
    echo "FAIL - $desc (got $hits hit(s), want $want)"; fail=$((fail + 1))
  fi
}

fires "tracked-mono CSS block fires"            ai-tell-tracked-eyebrow        "$FIX/bad"    yes
fires "cased low-tracking label is clean"       ai-tell-tracked-eyebrow        "$FIX/good"   no
fires "inline uppercase+mono+wide style fires"  ai-tell-tracked-eyebrow-inline "$FIX/inline" yes

# The bad CSS must make the linter exit non-zero (High >= fail-on High).
bash "$LINT" "$FIX/bad" >/dev/null 2>&1
if [ "$?" -eq 1 ]; then echo "ok   - bad CSS exits 1 (blocks the build)"; pass=$((pass + 1));
else echo "FAIL - bad CSS should exit 1"; fail=$((fail + 1)); fi

# The good CSS must exit 0 (no findings at or above High).
bash "$LINT" "$FIX/good" >/dev/null 2>&1
if [ "$?" -eq 0 ]; then echo "ok   - good CSS exits 0 (clean)"; pass=$((pass + 1));
else echo "FAIL - good CSS should exit 0"; fail=$((fail + 1)); fi

# The --disable flag suppresses the block check.
hits=$(bash "$LINT" "$FIX/bad" --disable ai-tell-tracked-eyebrow --ci 2>/dev/null | grep -c "	ai-tell-tracked-eyebrow	")
if [ "$hits" -eq 0 ]; then echo "ok   - --disable suppresses the block check"; pass=$((pass + 1));
else echo "FAIL - --disable should suppress ($hits hit(s))"; fail=$((fail + 1)); fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
