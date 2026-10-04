#!/usr/bin/env bash
# Tests the ASYMMETRIC DEAD SPACE check in verify-rendered.mjs.
#
# The bug it pins: a real client build's most restrained variant left 892px of a 1440px
# screen empty on 12 of 19 bands, content running 148px to 548px. Two independent judges
# flagged it before the client saw it and no gate caught it, so it shipped into the preview
# that the client reads first.
#
# THE WHOLE RISK IS FALSE POSITIVES, so the fixture is mostly cases that must stay SILENT.
# A narrow measure is good typography; a narrow measure pinned to one edge is a layout that
# was never finished. The check must be able to tell those apart, or it is noise and gets
# switched off, which is worse than not having it.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
VR="$DIR/../reference-capture/verify-rendered.mjs"
PORT="${DEADSPACE_TEST_PORT:-8797}"
TMP="$(mktemp -d)"; pass=0; fail=0

cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; pass=$((pass+1));
          else echo "FAIL - $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 not available"; exit 0; }
node -e "require('$DIR/../reference-capture/node_modules/playwright')" 2>/dev/null \
  || { echo "SKIP: playwright not installed (scripts/reference-capture/setup.sh)"; exit 0; }

# --- THE OFFENDER: the pelvy v1 shape, left-pinned columns in a wide band ------------
mkdir -p "$TMP/bad"
cat > "$TMP/bad/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Left-pinned</title>
<style>
 body{margin:0;font:16px/1.5 system-ui}
 section{padding:80px 0 80px 148px}
 .col{width:400px}
 h2{font-size:34px;margin:0 0 16px}
</style></head><body><main>
 <section><div class="col"><h2>A quiet room</h2><p>Content runs from 148px to 548px on a 1440px screen, and the remaining 892px is nothing at all.</p></div></section>
 <section><div class="col"><h2>What we treat</h2><p>The same band again, pinned to the same edge, with the same void beside it.</p></div></section>
 <section><div class="col"><h2>How it works</h2><p>And a third, so this is the layout rather than one unusual section.</p></div></section>
</main></body></html>
HTML

# --- THE INNOCENTS: every shape that must stay silent --------------------------------
mkdir -p "$TMP/good"
cat > "$TMP/good/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Considered</title>
<style>
 body{margin:0;font:16px/1.5 system-ui}
 section{padding:80px 0}
 /* 1. A NARROW CENTRED MEASURE. Deliberately only 620px of 1440px, which is correct
       typography, and the reason this check measures balance and never width. */
 .measure{width:620px;margin:0 auto}
 /* 2. A full-width two-column band. */
 .two{display:grid;grid-template-columns:1fr 1fr;gap:48px;padding:0 80px}
 /* 3. An asymmetric band that FILLS the width: offset, but nothing is left empty. */
 .offset{display:grid;grid-template-columns:2fr 3fr;gap:40px;padding:0 60px}
 h2{font-size:34px;margin:0 0 16px}
</style></head><body><main>
 <section><div class="measure"><h2>A narrow centred measure</h2><p>This band uses well under half the screen and is entirely correct, because the emptiness either side of it is equal and therefore reads as a decision rather than an oversight.</p></div></section>
 <section><div class="two"><div><h2>Left column</h2><p>Real copy on the left of a two column band.</p></div><div><h2>Right column</h2><p>Real copy on the right, so the band is full.</p></div></div></section>
 <section><div class="offset"><div><h2>Offset</h2><p>A narrow first column.</p></div><div><h2>And its pair</h2><p>A wider second column that carries the rest of the width, so nothing is void.</p></div></div></section>
</main></body></html>
HTML

serve() { (cd "$1" && exec python3 -m http.server "$PORT" >/dev/null 2>&1) & SRV_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://localhost:$PORT/" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "port $PORT is not serving this run's fixture. NOT a pass." >&2; exit 2; }

serve "$TMP/bad"
BAD="$(node "$VR" --url "http://localhost:$PORT" --routes / --no-vitals true 2>&1 || true)"
kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null

check "a left-pinned layout FIRES" \
  "$(printf '%s' "$BAD" | grep -c 'one-sided void' || true)" "1"
check "it fires on DESKTOP only (there is no void to leave at 390px)" \
  "$(printf '%s' "$BAD" | grep 'one-sided void' | grep -c 'mobile' || true)" "0"
check "it names the side that is empty" \
  "$(printf '%s' "$BAD" | grep -c 'empty on the right' || true)" "1"
check "it offers the fix rather than only the fault" \
  "$(printf '%s' "$BAD" | grep -c 'centre the band' || true)" "1"

serve "$TMP/good"
GOOD="$(node "$VR" --url "http://localhost:$PORT" --routes / --no-vitals true 2>&1 || true)"
kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null

check "a narrow CENTRED measure is silent" \
  "$(printf '%s' "$GOOD" | grep -c 'one-sided void' || true)" "0"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
