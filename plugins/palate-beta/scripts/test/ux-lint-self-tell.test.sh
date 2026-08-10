#!/usr/bin/env bash
# Tests the new "break the skill's own default style" lint rules in ux-lint.sh:
#   banned-display-bricolage / banned-body-hanken  (the reflex face pairing, JUSTIFY-OR-FLAG)
#   hero-status-pill                               (the status pill above the hero h1, hard High)
#   two-tone-heading                               (two solid colours in a hero h1, JUSTIFY-OR-FLAG)
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
LINT="$DIR/../ux-lint.sh"
FIX="$DIR/fixtures/uxlint"
pass=0; fail=0

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

# --- the reflex face pairing (justify-or-flag) -------------------------------
fires "bricolage display, no reason -> fires"   banned-display-bricolage "$FIX/reflex-faces-bad"  yes
fires "hanken body, no reason -> fires"          banned-body-hanken       "$FIX/reflex-faces-bad"  yes
fires "bricolage justified -> clean"             banned-display-bricolage "$FIX/reflex-faces-good" no
fires "hanken justified -> clean"                banned-body-hanken       "$FIX/reflex-faces-good" no

# --- the status pill above the hero heading (hard High) ---------------------
fires "status pill above hero h1 -> fires"       hero-status-pill "$FIX/hero-pill-bad"  yes
fires "clean hero (CTA button, far pill) -> clean" hero-status-pill "$FIX/hero-pill-good" no

# --- the two-tone (solid) hero heading (justify-or-flag) --------------------
fires "two solid colours in h1 -> fires"         two-tone-heading "$FIX/two-tone-bad"  yes
fires "single-colour heading -> clean"           two-tone-heading "$FIX/two-tone-good" no

# --- the mid-word kinetic heading split (bug-class d) -----------------------
fires "SplitText type:chars only -> fires"       kinetic-heading-char-split "$FIX/kinetic-split-bad"  yes
fires "SplitText type:words,chars -> clean"      kinetic-heading-char-split "$FIX/kinetic-split-good" no

# --- severity: the bad face + pill fixtures must FAIL the build (High >= fail-on High) ---
bash "$LINT" "$FIX/hero-pill-bad" >/dev/null 2>&1
if [ "$?" -eq 1 ]; then echo "ok   - hero-pill-bad exits 1 (blocks)"; pass=$((pass + 1));
else echo "FAIL - hero-pill-bad should exit 1"; fail=$((fail + 1)); fi

# the good fixtures must exit 0 (no High findings)
bash "$LINT" "$FIX/hero-pill-good" >/dev/null 2>&1
if [ "$?" -eq 0 ]; then echo "ok   - hero-pill-good exits 0 (clean)"; pass=$((pass + 1));
else echo "FAIL - hero-pill-good should exit 0"; fail=$((fail + 1)); fi

# --disable suppresses the block-aware checks
hits=$(bash "$LINT" "$FIX/hero-pill-bad" --disable hero-status-pill --ci 2>/dev/null | grep -c "	hero-status-pill	")
if [ "$hits" -eq 0 ]; then echo "ok   - --disable suppresses hero-status-pill"; pass=$((pass + 1));
else echo "FAIL - --disable should suppress hero-status-pill ($hits)"; fail=$((fail + 1)); fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
