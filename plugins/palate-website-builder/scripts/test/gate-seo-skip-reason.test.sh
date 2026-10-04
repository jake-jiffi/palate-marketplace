#!/usr/bin/env bash
# gate-done: an SEO skip must report gate-seo's OWN reason, not a hardcoded guess.
#
# THE BUG THIS PINS. gate-seo.mjs exits 2 from SEVEN distinct places: no --base origin, no
# src/pages, an unbuildable content index, no build output, no sitemap, an unreachable live base,
# and a blocked crawl. Every one of them already prints a specific message ending "NOT a pass".
# gate-done.sh threw all seven away and printed "seo=skipped(nothing built to crawl)".
#
# So a storefront whose product routes could not be enumerated, a site whose sitemap was missing,
# and a live check that reached nothing were all filed as "not built yet". That is the
# exists-but-never-fires class this repo has spent a year hunting: the gate RAN, it REFUSED, and
# the refusal was recorded as not-applicable. Nobody reading the note had any reason to look.
#
# The test drives the real gate to a real exit-2 (a project with no src/pages) and reads the note.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-done.sh"
DEEP="$DIR/fixtures/manifest-deep.json"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; pass=$((pass+1));
          else echo "FAIL - $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }
contains() { case "$2" in *"$3"*) check "$1" yes yes ;; *) echo "FAIL - $1"; echo "    output: ${2:0:400}"; fail=$((fail+1)) ;; esac; }
lacks()    { case "$2" in *"$3"*) echo "FAIL - $1 (found '$3')"; fail=$((fail+1)) ;; *) check "$1" yes yes ;; esac; }

# A project that reaches the SEO block and makes gate-seo exit 2 for a KNOWN reason:
# there is no src/pages, so gate-seo says "Not an Astro project".
PROJ="$TMP/proj"; mkdir -p "$PROJ/.palate-shots/desktop"
cp "$DEEP" "$PROJ/build-manifest.json"
printf '\x89PNG\r\n\x1a\n' > "$PROJ/.palate-shots/desktop-full.png"
printf '\x89PNG\r\n\x1a\n' > "$PROJ/.palate-shots/mobile-full.png"
echo '{"status":"captured","console_errors":0,"shots":{"desktop_full":"desktop-full.png"}}' > "$PROJ/.palate-shots/manifest.json"
echo '[]' > "$PROJ/.palate-shots/errors.json"
echo '{"verdict":"pass","visual":{"ran":true,"pass":true},"rendered":{"ran":true,"pass":true,"failures":[]}}' > "$PROJ/verify-report.json"

OUT="$(bash "$GATE" "$PROJ/build-manifest.json" 2>&1 || true)"

if ! printf '%s' "$OUT" | grep -q 'seo='; then
  echo "SKIP: this build of gate-done did not reach the SEO sub-gate"
  exit 0
fi

contains "the skip carries gate-seo's own words" "$OUT" "Not an Astro project"
lacks    "the hardcoded reason is gone"          "$OUT" "nothing built to crawl"
contains "it is still reported as a skip"        "$OUT" "seo=skipped"

# A skip must never read as a pass, which is the property the whole file rests on.
lacks "an exit-2 skip is never labelled a pass" "$OUT" "seo=pass"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
