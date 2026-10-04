#!/usr/bin/env bash
# Tests scripts/phantom-utility-check.mjs (compiler-as-oracle) with hand-made dist oracles -
# no npm/build needed. A good fixture (every used utility present in dist CSS) exits 0; a bad
# fixture (a brand-* class absent from dist) exits 1 naming it; a custom non-utility class is
# never flagged; --require-fresh SKIPs (exit 0) when src is newer than dist.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$DIR/phantom-utility-check.mjs"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ck() { local desc="$1" want="$2"; shift 2; "$@" >/dev/null 2>&1; local rc=$?; if [ "$rc" -eq "$want" ]; then echo "ok   - $desc (rc=$rc)"; pass=$((pass+1)); else echo "FAIL - $desc (rc=$rc want $want)"; fail=$((fail+1)); fi; }

# good: every utility used is present in the compiled CSS oracle; nf-card is a custom class.
mkdir -p "$T/good/src/pages" "$T/good/dist"
printf '<a class="px-4 text-center nf-card">x</a>\n' > "$T/good/src/pages/index.astro"
printf '.px-4{padding:1rem}.text-center{text-align:center}\n' > "$T/good/dist/styles.css"
ck "good build is clean (custom class ignored)" 0 node "$CHECK" "$T/good" --no-build

# bad: bg-brand-accent is a utility candidate (ns 'bg') absent from the oracle = phantom.
mkdir -p "$T/bad/src/pages" "$T/bad/dist"
printf '<a class="px-4 bg-brand-accent rounded-brand">x</a>\n' > "$T/bad/src/pages/index.astro"
printf '.px-4{padding:1rem}\n' > "$T/bad/dist/styles.css"
ck "bad build flags the phantom (exit 1)" 1 node "$CHECK" "$T/bad" --no-build
out="$(node "$CHECK" "$T/bad" --no-build --ci 2>/dev/null)"
echo "$out" | grep -q "bg-brand-accent" && { echo "ok   - names bg-brand-accent"; pass=$((pass+1)); } || { echo "FAIL - did not name bg-brand-accent"; fail=$((fail+1)); }

# per-line escape suppresses it.
printf '<!-- phantom-class-disable bg-brand-accent -->\n<a class="bg-brand-accent">x</a>\n' > "$T/bad/src/pages/index.astro"
ck "phantom-class-disable suppresses" 0 node "$CHECK" "$T/bad" --no-build

# --require-fresh: a src newer than dist is a SKIP (exit 0), never a false flag.
mkdir -p "$T/stale/src/pages" "$T/stale/dist"
printf '.px-4{padding:1rem}\n' > "$T/stale/dist/styles.css"
sleep 1; printf '<a class="px-4 bg-brand-accent">x</a>\n' > "$T/stale/src/pages/index.astro"
ck "stale dist SKIPs under --require-fresh (no false flag)" 0 node "$CHECK" "$T/stale" --no-build --require-fresh

echo "----"; echo "phantom-utility.test: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
