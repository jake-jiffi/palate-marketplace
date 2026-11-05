#!/usr/bin/env bash
# brand-name-needs-translate-no has to be satisfiable by the fix it prescribes. Its pattern's
# lookbehind excluded `\w@/."` and not `>`, so `<span translate="no">Stripe</span>` still fired,
# and every customer build that wrapped a name the way the rule told it to was told again that it
# had not (found by critic 10). A bare name fires; a wrapped one is clean.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
LINT="$DIR/../ux-lint.sh"
FIXSRC="$DIR/fixtures/uxlint"
FIXTMP="$(mktemp -d)"; trap 'rm -rf "$FIXTMP"' EXIT
cp -R "$FIXSRC" "$FIXTMP/uxlint"
FIX="$FIXTMP/uxlint"
pass=0; fail=0

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

fires "bare brand names in prose -> fires"            brand-name-needs-translate-no "$FIX/brand-translate-bad"  yes
fires "brand names wrapped in translate=no -> clean"  brand-name-needs-translate-no "$FIX/brand-translate-good" no

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
