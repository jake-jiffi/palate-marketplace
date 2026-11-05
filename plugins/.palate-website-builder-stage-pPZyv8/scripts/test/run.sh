#!/usr/bin/env bash
# Run every test in the repo. There was no runner before this, so suites only ran
# when somebody remembered which ones existed, and a new suite could sit green-by-
# absence for weeks.
#
# Usage: scripts/test/run.sh [--fast]
#   --fast  skip the browser-driven suites (hygiene-loop, verify-rendered-a11y),
#           which need Playwright and take minutes.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
FAST=0; for a in "$@"; do [ "$a" = "--fast" ] && FAST=1; done
SLOW="hygiene-loop verify-rendered-a11y"
pass=0; fail=0; skipped=0; failed_names=""

run() { # label  command...
  local label="$1"; shift
  if out="$("$@" 2>&1)"; then
    printf '  %-34s PASS\n' "$label"; pass=$((pass+1))
  else
    printf '  %-34s *** FAIL ***\n' "$label"; fail=$((fail+1)); failed_names="$failed_names $label"
    printf '%s\n' "$out" | tail -6 | sed 's/^/      /'
  fi
}

echo "shell suites"
for t in "$DIR"/*.test.sh; do
  [ -e "$t" ] || continue
  n="$(basename "$t" .test.sh)"
  case " $SLOW " in *" $n "*) [ "$FAST" = "1" ] && { printf '  %-34s skipped (--fast)\n' "$n"; skipped=$((skipped+1)); continue; };; esac
  run "$n" bash "$t"
done

echo "node suites"
for t in "$DIR"/*.test.mjs; do
  [ -e "$t" ] || continue
  run "$(basename "$t" .test.mjs)" node --test "$t"
done

echo "---"
echo "passed=$pass failed=$fail skipped=$skipped"
[ "$fail" -eq 0 ] || { echo "failed:$failed_names"; exit 1; }
