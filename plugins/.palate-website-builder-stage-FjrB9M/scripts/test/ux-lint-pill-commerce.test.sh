#!/usr/bin/env bash
# hero-status-pill must stay fully armed on a brochure site and stand down on a PDP.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; LINT="$DIR/../ux-lint.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; pass=$((pass+1));
          else echo "FAIL - $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }

pill_page() { mkdir -p "$(dirname "$1")"; cat > "$1" <<'HTML'
---
---
<section>
  <div class="rounded-full border bg-white px-3 py-1">In stock</div>
  <h1>Wool Runner</h1>
</section>
HTML
}
fires() { bash "$LINT" "$1" 2>/dev/null | grep -c 'hero-status-pill' || true; }

# 1. brochure site: fires everywhere, including under products/, because there is no catalogue
P="$TMP/brochure"; mkdir -p "$P/.palate"
pill_page "$P/src/pages/index.astro"; pill_page "$P/src/pages/products/thing.astro"
check "brochure hero still fires"                "$(fires "$P")" "2"

# 2. commerce build: the PDP stands down, the homepage hero does NOT
C="$TMP/store"; mkdir -p "$C/.palate"
pill_page "$C/src/pages/index.astro"; pill_page "$C/src/pages/products/wool-runner.astro"
echo '{"ok":true,"products":[{"handle":"a","image":{"url":"x","width":10,"height":10}}]}' > "$C/.palate/catalogue.json"
check "PDP stands down, homepage hero still fires" "$(fires "$C")" "1"

# 3. a FAILED survey is not a commerce build: the rule stays fully armed
F="$TMP/failed"; mkdir -p "$F/.palate"
pill_page "$F/src/pages/index.astro"; pill_page "$F/src/pages/products/x.astro"
echo '{"ok":false,"reason":"channel-locked"}' > "$F/.palate/catalogue.json"
check "a failed survey keeps the rule armed"     "$(fires "$F")" "2"

# 4. input-missing-autocomplete must not fire on inputs that are never user-typed.
# Found by building a real storefront: a hidden form field and a radio variant picker both
# reported High, which is nonsense per the HTML spec and blocks a correct build.
A="$TMP/inputs"; mkdir -p "$A/src/pages"
cat > "$A/src/pages/index.astro" <<'HTML'
---
---
<form>
  <input type="hidden" name="handle" value="x" />
  <input type="radio" name="size" value="S" />
  <input type="checkbox" name="gift" />
  <input type="submit" value="Go" />
</form>
HTML
ac() { bash "$LINT" "$1" 2>/dev/null | grep -c 'input-missing-autocomplete' || true; }
check "hidden, radio, checkbox and submit are exempt" "$(ac "$A")" "0"

# and the rule must still fire where it genuinely matters
B="$TMP/realinput"; mkdir -p "$B/src/pages"
printf -- '---\n---\n<form><input type="email" name="email" /></form>\n' > "$B/src/pages/index.astro"
check "a real text input still fires"               "$(ac "$B")" "1"

echo "---"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
