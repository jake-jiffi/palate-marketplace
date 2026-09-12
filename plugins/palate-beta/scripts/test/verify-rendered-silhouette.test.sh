#!/usr/bin/env bash
# Tests the REPEATED SILHOUETTE check in verify-rendered.mjs.
#
# The bug it pins: a real client build shipped service pages carrying two identical five-card
# grids back to back, one for the products and one for the reasons to choose them. Every gate
# passed, because every gate reads markup, copy or contrast and the fault was the rhythm. The
# client read a page that looks like one long grid with a heading dropped into the middle.
#
# AS WITH THE DEAD-SPACE CHECK, THE WHOLE RISK IS FALSE POSITIVES, so most of the fixture is
# cases that must stay SILENT. A shape that returns after another band is a motif; the same
# shape twice in a row is a stutter. All four criteria (child count, columns, aspect, ground)
# have to hold before anything is said, and each silent case here differs on exactly one of
# them, so a criterion that stops being checked shows up as a new finding rather than as
# nothing at all.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
VR="$DIR/../reference-capture/verify-rendered.mjs"
PORT="${SILHOUETTE_TEST_PORT:-8798}"
TMP="$(mktemp -d)"; pass=0; fail=0

cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; pass=$((pass+1));
          else echo "FAIL - $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 not available"; exit 0; }
node -e "require('$DIR/../reference-capture/node_modules/playwright')" 2>/dev/null \
  || { echo "SKIP: playwright not installed (scripts/reference-capture/setup.sh)"; exit 0; }

CSS='body{margin:0;font:16px/1.5 system-ui}
 section{padding:64px 40px;background:#ffffff}
 .grid{display:grid;gap:24px}
 .five{grid-template-columns:repeat(5,1fr)}
 .three{grid-template-columns:repeat(3,1fr)}
 .two{grid-template-columns:repeat(2,1fr)}
 article{padding:16px;border:1px solid #ddd}
 h2{font-size:30px;margin:0 0 24px}'

card() { printf '<article><h3>%s</h3><p>A card with a line of copy in it.</p></article>' "$1"; }
FIVE="$(card One)$(card Two)$(card Three)$(card Four)$(card Five)"
SIX="$(card One)$(card Two)$(card Three)$(card Four)$(card Five)$(card Six)"

# --- THE OFFENDER: two five-card grids back to back ----------------------------------
mkdir -p "$TMP/bad"
cat > "$TMP/bad/index.html" <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Two grids</title>
<style>$CSS</style></head><body><main>
 <section data-section-id="services"><h2>What we make</h2><div class="grid five">$FIVE</div></section>
 <section data-section-id="reasons"><h2>Why us</h2><div class="grid five">$FIVE</div></section>
</main></body></html>
HTML

# --- THE SAME PAGE, WITH THE REPEAT CLAIMED ------------------------------------------
mkdir -p "$TMP/claimed"
cat > "$TMP/claimed/index.html" <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Claimed</title>
<style>$CSS</style></head><body><main>
 <section data-section-id="services"><h2>What we make</h2><div class="grid five">$FIVE</div></section>
 <section data-section-id="reasons" data-palate-repeat="deliberate"><h2>Why us</h2><div class="grid five">$FIVE</div></section>
</main></body></html>
HTML

# --- INNOCENT 1: the same shape returns AFTER a statement band, which is a motif ------
# Plain <section> children of <main>, no data-section-id, so this also exercises the
# fallback selection. Drop the consecutive condition and this page fires.
mkdir -p "$TMP/spaced"
cat > "$TMP/spaced/index.html" <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spaced</title>
<style>$CSS</style></head><body><main>
 <section><h2>What we make</h2><div class="grid five">$FIVE</div></section>
 <section><h2>We have fitted doors on this coast for forty years, and we still measure every one by hand.</h2></section>
 <section><h2>Why us</h2><div class="grid five">$FIVE</div></section>
</main></body></html>
HTML

# --- INNOCENT 2: same child count, same ground, same aspect, DIFFERENT columns --------
# The heights are pinned so the aspect ratios match exactly: the ONLY thing separating
# these two sections is the column count, so dropping that criterion fires here.
mkdir -p "$TMP/columns"
cat > "$TMP/columns/index.html" <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Columns</title>
<style>$CSS section{height:600px;box-sizing:border-box;overflow:hidden}</style></head><body><main>
 <section data-section-id="services"><h2>What we make</h2><div class="grid three">$SIX</div></section>
 <section data-section-id="reasons"><h2>Why us</h2><div class="grid two">$SIX</div></section>
</main></body></html>
HTML

# --- INNOCENT 3: same count, same columns, same aspect, DIFFERENT ground --------------
# A shape repeated on a new ground reads as a new band, which is one of the fixes the
# finding itself offers. Drop the ground criterion and this page fires.
mkdir -p "$TMP/ground"
cat > "$TMP/ground/index.html" <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ground</title>
<style>$CSS section{height:600px;box-sizing:border-box;overflow:hidden}
 .dark{background:#101820;color:#fff}</style></head><body><main>
 <section data-section-id="services"><h2>What we make</h2><div class="grid five">$FIVE</div></section>
 <section data-section-id="reasons" class="dark"><h2>Why us</h2><div class="grid five">$FIVE</div></section>
</main></body></html>
HTML

# --- INNOCENT 4: same count, same columns, same ground, DIFFERENT aspect --------------
# One band is a strip and the next is a full screen: the same grid at two very different
# heights is not the same silhouette. Drop the aspect criterion and this page fires.
mkdir -p "$TMP/aspect"
cat > "$TMP/aspect/index.html" <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Aspect</title>
<style>$CSS section{box-sizing:border-box;overflow:hidden}
 .short{height:240px} .tall{height:900px}</style></head><body><main>
 <section data-section-id="services" class="short"><div class="grid five">$FIVE</div></section>
 <section data-section-id="reasons" class="tall"><div class="grid five">$FIVE</div></section>
</main></body></html>
HTML

serve() { (cd "$1" && exec python3 -m http.server "$PORT" >/dev/null 2>&1) & SRV_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://localhost:$PORT/" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "port $PORT is not serving this run's fixture. NOT a pass." >&2; exit 2; }

run() { serve "$1"
  OUT="$(node "$VR" --url "http://localhost:$PORT" --routes / --no-vitals true 2>&1 || true)"
  kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; printf '%s' "$OUT"; }

BAD="$(run "$TMP/bad")"
check "two identical five-card grids back to back FIRE" \
  "$(printf '%s' "$BAD" | grep -c 'repeated silhouette: sections services and reasons' || true)" "1"
check "it fires on DESKTOP only (every grid is one column at 390px)" \
  "$(printf '%s' "$BAD" | grep 'repeated silhouette' | grep -c 'mobile' || true)" "0"
check "it says why, on all four criteria" \
  "$(printf '%s' "$BAD" | grep -c 'same child count (5), same columns (5), aspect within 10%, same ground' || true)" "1"
check "it offers the fix rather than only the fault" \
  "$(printf '%s' "$BAD" | grep -c 'a different column count, a list or a single wide statement' || true)" "1"

CLAIMED="$(run "$TMP/claimed")"
check "a claimed repeat is NOT a finding" \
  "$(printf '%s' "$CLAIMED" | grep -c 'are drawn as the same shape' || true)" "0"
check "and the note names the section that claimed it" \
  "$(printf '%s' "$CLAIMED" | grep -c 'reasons is marked data-palate-repeat="deliberate"' || true)" "1"

SPACED="$(run "$TMP/spaced")"
check "the same shape either side of a statement band is silent" \
  "$(printf '%s' "$SPACED" | grep -c 'repeated silhouette' || true)" "0"

COLUMNS="$(run "$TMP/columns")"
check "two grids of the same count on different column counts are silent" \
  "$(printf '%s' "$COLUMNS" | grep -c 'repeated silhouette' || true)" "0"

GROUND="$(run "$TMP/ground")"
check "the same grid on a different ground is silent" \
  "$(printf '%s' "$GROUND" | grep -c 'repeated silhouette' || true)" "0"

ASPECT="$(run "$TMP/aspect")"
check "the same grid at two very different heights is silent" \
  "$(printf '%s' "$ASPECT" | grep -c 'repeated silhouette' || true)" "0"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
