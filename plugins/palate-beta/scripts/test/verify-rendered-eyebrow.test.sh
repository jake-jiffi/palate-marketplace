#!/usr/bin/env bash
# Tests the STRUCTURAL eyebrow/kicker check in verify-rendered.mjs.
#
# WHY IT EXISTS HERE RATHER THAN IN ux-lint. `anti-patterns.md` bans the kicker
# "regardless of styling - it is the PATTERN", but the ux-lint rule reads CSS blocks and
# BOTH its branches require a mono font, so the commonest form of all - a small uppercase
# label in the BRAND SANS, styled by utility classes with no CSS block to parse - matched
# nothing. Measured before this check existed: that markup produced zero findings while an
# em dash in the same folder fired Critical. AI tells were reaching client previews.
#
# Four directions, because "it fires" alone would not have caught the real risk, which is
# a check so eager it flags ordinary editorial layout and gets switched off:
#   1. a sans-serif utility-class eyebrow FIRES (the case ux-lint cannot see)
#   2. a lede AFTER a heading is SILENT
#   3. an image above a heading is SILENT
#   4. a real paragraph above a heading is SILENT (long, and ends in a full stop)
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
VR="$DIR/../reference-capture/verify-rendered.mjs"
PORT="${EYEBROW_TEST_PORT:-8796}"
TMP="$(mktemp -d)"; pass=0; fail=0

cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

check() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then echo "ok   - $desc"; pass=$((pass + 1));
  else echo "FAIL - $desc (got '$got', want '$want')"; fail=$((fail + 1)); fi
}

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 not available"; exit 0; }
node -e "require('$DIR/../reference-capture/node_modules/playwright')" 2>/dev/null \
  || { echo "SKIP: playwright not installed (scripts/reference-capture/setup.sh)"; exit 0; }

cat > "$TMP/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Eyebrow fixture</title>
<style>
 body{margin:0;font:16px system-ui} main{padding:2rem}
 .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.18em;margin:0 0 8px}
 h2{font-size:40px;margin:0 0 24px} .lede{font-size:18px;margin:0 0 24px}
 img{width:120px;height:60px;background:#ccc;display:block}
</style></head><body><main>
 <p class="eyebrow">What we do</p>
 <h2>Built for the way you work</h2>

 <h2>Second section</h2>
 <p class="lede">A longer sentence that follows the heading and is not a kicker.</p>

 <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="x">
 <h2>Third section</h2>

 <p>This is a genuine paragraph of running copy that happens to precede a heading, and it ends properly.</p>
 <h2>Fourth section</h2>
</main></body></html>
HTML

# `exec` so $! is the server itself: without it the trap kills a wrapper shell and the
# server keeps the port for the next run. That exact leak cost a debugging session.
(cd "$TMP" && exec python3 -m http.server "$PORT" >/dev/null 2>&1) &
SRV_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://localhost:$PORT/" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://localhost:$PORT/" >/dev/null 2>&1 || {
  echo "verify-rendered-eyebrow: port $PORT is not serving this run's fixture. NOT a pass." >&2; exit 2; }

OUT="$(node "$VR" --url "http://localhost:$PORT" --routes / --no-vitals true 2>&1 || true)"

# One finding per viewport (3), and only for the kicker.
FIRED="$(printf '%s' "$OUT" | grep -c 'eyebrow/kicker' || true)"
check "the sans-serif utility eyebrow fires at all 3 viewports" "$FIRED" "3"
check "it names the offending label" \
  "$(printf '%s' "$OUT" | grep -c 'What we do' || true)" "3"
check "it is High, so it blocks" \
  "$(printf '%s' "$OUT" | grep 'eyebrow/kicker' | grep -c '\[High\]' || true)" "3"

for phrase in "A longer sentence" "Third section" "genuine paragraph"; do
  check "no false positive: $phrase" \
    "$(printf '%s' "$OUT" | grep 'eyebrow/kicker' | grep -c "$phrase" || true)" "0"
done

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
