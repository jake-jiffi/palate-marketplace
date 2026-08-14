#!/usr/bin/env bash
# Tests scripts/gate-brand-token-usage.mjs: does the BUILT site actually use the brand?
#
# WHY IT EXISTS. Every other brand check stops at wiring (the package is a dependency, it
# exports tokens.css, the record exists). A build could import the tokens, reference none
# of them, hardcode a second palette and a face nobody chose, and pass the lot.
#
# The fixtures below encode the two false-positive shapes the calibration run turned up on
# real builds - a one-off hex in an SVG fill, and a shadow colour - so a later tightening
# of the rules cannot quietly start failing good work.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
G="$DIR/../gate-brand-token-usage.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
check() { local d="$1" want="$2" got="$3"; if [ "$got" -eq "$want" ]; then echo "ok   - $d"; pass=$((pass+1)); else echo "FAIL - $d (exit $got, want $want)"; fail=$((fail+1)); fi; }

mk() { mkdir -p "$TMP/$1/dist/_astro"; cat > "$TMP/$1/dist/_astro/s.css"; }

TOKENS=':root{--brand-bg:#f4efe4;--brand-text:#2c2622;--brand-accent:#5c6648;--brand-font-display:"Archivo",sans-serif}
@font-face{font-family:Archivo;src:url(/a.woff2)}'

# 1. On-brand build. Includes the two documented false-positive shapes: an SVG fill and a
#    shadow, both off-token, both deliberately not policed.
mk clean <<CSS
$TOKENS
body{background:var(--brand-bg);color:var(--brand-text);font-family:var(--brand-font-display)}
.btn{background:#5c6648;color:#fff}
.icon{fill:#ff00ff}
.card{box-shadow:0 2px 8px #12345680}
.veil{background:linear-gradient(#00000080,#00000000)}
.mono{font-family:Archivo,ui-monospace,monospace}
.note{font-family:"Archivo",Georgia,serif}
CSS
node "$G" "$TMP/clean" >/dev/null 2>&1; check "on-brand build passes (svg fill + shadow + generic fallbacks are not findings)" 0 $?

# 2. The failure this gate exists for: tokens defined, then ignored.
mk slop <<CSS
$TOKENS
body{background:#1a1a1a;color:#e8e4dd;font-family:"Playfair Display",serif}
.hero{background-color:#1a1a1a}.card{background:#1a1a1a}.foot{background:#1a1a1a}
.a{border-color:#1a1a1a}.b{color:#c0392b}.c{color:#2980b9}.d{background:#8e44ad}
CSS
node "$G" "$TMP/slop" >/dev/null 2>&1; check "tokens defined then hardcoded everywhere is a blocking finding" 1 $?

# 3. A face the brand never declares blocks on its own, with no colour problem at all.
mk face <<CSS
$TOKENS
body{background:var(--brand-bg);color:var(--brand-text)}
h1{font-family:"Playfair Display",serif}
CSS
node "$G" "$TMP/face" >/dev/null 2>&1; check "an undeclared typeface blocks even when every colour is a token" 1 $?

# 4. One off-token colour repeated past the threshold blocks; a token repeated does not.
mk repeat <<CSS
$TOKENS
.a{background:#123456}.b{background:#123456}.c{background:#123456}.d{background:#123456}.e{color:#123456}
CSS
node "$G" "$TMP/repeat" >/dev/null 2>&1; check "one off-token hex in 5 declarations blocks (it is a brand colour with no token)" 1 $?

mk repeat_ok <<CSS
$TOKENS
.a{background:var(--brand-accent)}.b{background:#5c6648}.c{background:#5c6648}.d{background:#5c6648}
.e{background:#5c6648}.f{background:#5c6648}.g{background:#5c6648}
CSS
node "$G" "$TMP/repeat_ok" >/dev/null 2>&1; check "a token's own hex repeated many times is not a finding" 0 $?

# 5. Three distinct one-off literals is advisory (exit 3), not a block: one of the eight
#    shipped demos does exactly this and a rule that fails good work gets switched off.
mk advisory <<CSS
$TOKENS
.a{color:#111213}.b{color:#141516}.c{background:#171819}
CSS
node "$G" "$TMP/advisory" >/dev/null 2>&1; check "three distinct one-off literals is advisory, not blocking" 3 $?
node "$G" "$TMP/advisory" --strict >/dev/null 2>&1; check "--strict promotes the advisory to blocking" 1 $?

# 6. Cannot run must never read as a pass.
mkdir -p "$TMP/nodist"
node "$G" "$TMP/nodist" >/dev/null 2>&1; check "no dist/ exits 2 (cannot run), never 0" 2 $?
mkdir -p "$TMP/emptydist/dist"
node "$G" "$TMP/emptydist" >/dev/null 2>&1; check "a dist/ with no CSS exits 2 (cannot run), never 0" 2 $?

# 7. A build whose CSS declares no colour token at all is the brand not reaching the build.
mk notokens <<'CSS'
body{background:#1a1a1a;color:#eeeeee}
CSS
node "$G" "$TMP/notokens" >/dev/null 2>&1; check "no colour token in the built CSS fails (the brand never reached the build)" 1 $?

# 8. Inline <style> in dist HTML is read too, not just .css files. A build that puts its
#    escape hatch in a page-level <style> must not slip past.
mkdir -p "$TMP/inline/dist"
printf '%s\n' "<html><style>$TOKENS</style><style>.h{font-family:\"Playfair Display\",serif}</style></html>" > "$TMP/inline/dist/index.html"
node "$G" "$TMP/inline" >/dev/null 2>&1; check "an undeclared face inside a dist <style> block is found" 1 $?

echo ""; echo "brand-token-usage: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
