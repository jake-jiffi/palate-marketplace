#!/usr/bin/env bash
# Run every test in the repo. There was no runner before this, so suites only ran
# when somebody remembered which ones existed, and a new suite could sit green-by-
# absence for weeks.
#
# Usage: scripts/test/run.sh [--fast]
#   --fast  skip the browser-driven and build-driven suites, which need Playwright or an npm
#           install and take minutes. template-csp-live, boards-render, explore-page-boards and
#           gate-fidelity all install and build the template, which is the only honest way to
#           prove a policy, a render or a fidelity comparison.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
FAST=0; for a in "$@"; do [ "$a" = "--fast" ] && FAST=1; done
# Optional release evidence: retain each suite's full output, including the first
# failure, while keeping the terminal summary short.
LOG_DIR="${PALATE_TEST_LOG_DIR:-}"
[ -z "$LOG_DIR" ] || mkdir -p "$LOG_DIR" || exit 2
# FULL FILE NAMES, and the extension is load-bearing. The list used to hold bare names and
# only filtered the shell loop, so a browser suite written as .test.mjs was named here and
# ran under --fast anyway. Filtering both loops on a bare name is worse again: hygiene-loop
# is BOTH a browser suite and a 72ms unit suite, and the bare name silently took the unit one
# out of every fast run. A missing entry is warned about below, because a list that names a
# file nobody has skips nothing and says nothing.
SLOW="verify-rendered-forms.test.mjs hygiene-loop.test.sh verify-rendered-a11y.test.sh verify-rendered-incremental.test.mjs template-csp-live.test.sh boards-render.test.mjs explore-page-boards.test.sh gate-fidelity.test.mjs gate-page-judge.test.mjs motion-proof.test.mjs live-gallery.test.mjs"
for s in $SLOW; do
  [ -e "$DIR/$s" ] || echo "  WARNING: the slow list names $s, which does not exist"
done
pass=0; fail=0; skipped=0; failed_names=""

run() { # label  command...
  local label="$1"; shift
  if out="$("$@" 2>&1)"; then
    [ -z "$LOG_DIR" ] || printf '%s\n' "$out" > "$LOG_DIR/$label-${1##*/}.log"
    printf '  %-34s PASS\n' "$label"; pass=$((pass+1))
  else
    [ -z "$LOG_DIR" ] || printf '%s\n' "$out" > "$LOG_DIR/$label-${1##*/}.log"
    printf '  %-34s *** FAIL ***\n' "$label"; fail=$((fail+1)); failed_names="$failed_names $label"
    printf '%s\n' "$out" | tail -6 | sed 's/^/      /'
  fi
}

echo "shell suites"
for t in "$DIR"/*.test.sh; do
  [ -e "$t" ] || continue
  n="$(basename "$t" .test.sh)"
  case " $SLOW " in *" $(basename "$t") "*) [ "$FAST" = "1" ] && { printf '  %-34s skipped (--fast)\n' "$n"; skipped=$((skipped+1)); continue; };; esac
  run "$n" bash "$t"
done

echo "node suites"
for t in "$DIR"/*.test.mjs; do
  [ -e "$t" ] || continue
  n="$(basename "$t" .test.mjs)"
  case " $SLOW " in *" $(basename "$t") "*) [ "$FAST" = "1" ] && { printf '  %-34s skipped (--fast)\n' "$n"; skipped=$((skipped+1)); continue; };; esac
  run "$n" node --test "$t"
done

echo "---"
echo "passed=$pass failed=$fail skipped=$skipped"
[ "$fail" -eq 0 ] || { echo "failed:$failed_names"; exit 1; }
