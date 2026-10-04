#!/usr/bin/env bash
# Tests the custom-cursor-not-gated JUSTIFY-OR-FLAG rule (references/anti-patterns.md +
# ux-lint.sh): `cursor: none` (or the `cursor-none` utility) fires unless a
# ux-lint-disable directive carries a one-line reason.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
LINT="$DIR/../ux-lint.sh"
# THE FIXTURES ARE COPIED OUT OF THE REPO FIRST. ux-lint refuses any directory inside a Claude
# Code plugin checkout (this one), because run from a plugin it grades the plugin: the doctrine
# QUOTES the tells it hunts. A fixture that lives here must be linted somewhere else.
FIXSRC="$DIR/fixtures/uxlint"
FIXTMP="$(mktemp -d)"; trap 'rm -rf "$FIXTMP"' EXIT
cp -R "$FIXSRC" "$FIXTMP/uxlint"
FIX="$FIXTMP/uxlint"
pass=0; fail=0

fires() {
  local desc="$1" dir="$2" want="$3"
  local hits
  hits=$(bash "$LINT" "$dir" --severity Cosmetic --ci 2>/dev/null | grep -c "custom-cursor-not-gated")
  if { [ "$want" = "yes" ] && [ "$hits" -gt 0 ]; } || { [ "$want" = "no" ] && [ "$hits" -eq 0 ]; }; then
    echo "ok   - $desc ($hits hit(s))"; pass=$((pass + 1))
  else
    echo "FAIL - $desc (got $hits hit(s), want $want)"; fail=$((fail + 1))
  fi
}

fires "ungated cursor:none fires"                  "$FIX/cursor-bad"       yes
fires "reasoned disable is suppressed"             "$FIX/cursor-justified" no
fires "bare disable (no reason) still fires"       "$FIX/cursor-bare"      yes
fires "no cursor:none is clean"                    "$FIX/cursor-clean"     no

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
