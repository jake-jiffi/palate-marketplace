#!/usr/bin/env bash
# Tests the Explore PRESENTATION gate (scripts/gate-explore.mjs).
#
# It holds three things that are easy to skip and impossible to notice missing: the page that
# explains the range exists, every rung carries its own argument, and the ladder positions are
# real. It must have no OPINION on anything else, because a gate that fires on an ordinary edit
# gets switched off and then protects nothing. Having no opinion is a SKIP with a printed reason
# and exit 2, never exit 0: a gate that exits clean having inspected nothing reads as a pass.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-explore.mjs"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# run <dir> -> "PASS", "SKIP" or "BLOCK".
#
# A SKIP AND A BLOCK BOTH EXIT 2, and the first stderr line is what separates them, exactly as
# gate-done.sh reads it. Classifying here rather than in the gate keeps the two in step: if the
# gate ever stops printing its skip line, these cases report BLOCK and the suite says so.
run() {
  local err ec
  err="$(node "$GATE" "$1" 2>&1 >/dev/null)"; ec=$?
  if [ "$ec" -eq 0 ]; then echo PASS; return; fi
  case "${err%%$'\n'*}" in
    "gate-explore: skipped ("*) echo SKIP ;;
    *) echo BLOCK ;;
  esac
}
# The output is CAPTURED and then searched, never piped into `grep -q`. Under `set -o pipefail`
# a `-q` grep exits on the first match, SIGPIPEs node, and the pipeline reports the signal, so
# every assertion fails at the exact moment it should pass. That cost a debugging round here.
why() { node "$GATE" "$1" 2>&1 >/dev/null || true; }
want() { if [ "$2" = "$3" ]; then echo "ok   - $1"; pass=$((pass+1));
         else echo "FAIL - $1 (got $3, want $2)"; fail=$((fail+1)); fi; }
has() { local out; out="$(why "$2")"
        if printf '%s' "$out" | grep -qiF "$3"; then echo "ok   - $1"; pass=$((pass+1));
        else echo "FAIL - $1 (no '$3' in output)"; fail=$((fail+1)); fi; }

mk() { mkdir -p "$1/src/lib" "$1/src/pages" "$1/.palate/explore/seed"; }
page() { : > "$1/src/pages/explore.astro"; }
boards() { for id in "${@:2}"; do n="${id#b}"; printf '<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style></style></helmet><section class="hero" data-section-id="%s-hero"></section></x-dc></body></html>' "$id" > "$1/.palate/explore/seed/B$n.dc.html"; done; }

# A fully-argued two-rung set, with the artboards it registers.
write_valid() { cat > "$1/src/lib/variants.ts" <<'TS'
export interface Variant { id: string; name: string; artboard: string; href?: string; ambition: number; what: string; why: string; feeling: string; donor: string; section: string; motion: string; ctas: string[]; }
export const variants: Variant[] = [
  { id: "b1", name: "The Quiet Room", artboard: "B1.dc.html", ambition: 1,
    what: "One column, one photograph, and a great deal of air.",
    why: "People arriving here are anxious and have usually been dismissed once already, so nothing asks anything of them before they have read a sentence.",
    feeling: "unhurried, private, adult",
    donor: "therapy-in-london", section: "services",
    motion: "Nothing at all on load. Everything settles slowly once it is scrolled to, never before.",
    ctas: ["Book a first visit", "Ask a question"] },
  { id: "b2", name: "The Folder", artboard: "B2.dc.html", ambition: 2,
    what: "The record itself becomes the interface, opening as you scroll.",
    why: "Their entire pitch is that a clinician finally sees six months of evidence instead of one appointment, so the page should behave like that evidence.",
    feeling: "purposeful, quietly technical",
    donor: "the-modern-house", section: "proof",
    motion: "Each layer lifts and offsets under the pointer, so depth is felt rather than drawn.",
    ctas: ["See the record", "Talk to us", "Read the method"] },
];
export const landingVariants: Variant[] = [];
TS
boards "$1" b1 b2
}

# === 1. NOT AN EXPLORE BUILD: nothing to say.
A="$TMP/none"; mk "$A"
want "no variants.ts at all -> skip, with a reason" SKIP "$(run "$A")"
has "and it says it is not an Explore build" "$A" "not an Explore build"

# === 2. THE SHIPPED TEMPLATE, whose example entry is COMMENTED OUT. A naive scan reads that
# comment as a fully-argued variant and passes a build that registered nothing.
B="$TMP/template"; mk "$B"
cp "$DIR/../../templates/astro-project/src/lib/variants.ts" "$B/src/lib/variants.ts"
want "the bare template (example is commented out) -> skip, not pass" SKIP "$(run "$B")"
has "and it says nothing is registered" "$B" "no boards registered"

# === 3. THE HAPPY PATH.
C="$TMP/good"; mk "$C"; write_valid "$C"; page "$C"
want "argued boards + the explore page -> pass" PASS "$(run "$C")"

# === 4. VARIANTS BUT NO COACHING PAGE.
D="$TMP/nopage"; mk "$D"; write_valid "$D"
want "variants with no explore.astro -> block" BLOCK "$(run "$D")"
has "and it says the client would get a list of URLs" "$D" "list of URLs"

# === 5. A VARIANT THAT DOES NOT ARGUE FOR ITSELF.
E="$TMP/thin"; mk "$E"; page "$E"
cat > "$E/src/lib/variants.ts" <<'TS'
export const variants = [
  { id: "b1", name: "The Quiet Room", artboard: "B1.dc.html", ambition: 1 },
];
export const landingVariants = [];
TS
want "a board with no what/why/feeling -> block" BLOCK "$(run "$E")"
has "and it names every missing field" "$E" "missing what, why, feeling, donor, section, motion, ctas"

# === 6. A FEELING THAT DESCRIBES ANY WEBSITE.
F="$TMP/generic"; mk "$F"; page "$F"; write_valid "$F"
sed -i '' 's/unhurried, private, adult/modern and clean/' "$F/src/lib/variants.ts"
want "feeling \"modern and clean\" -> block" BLOCK "$(run "$F")"
has "and it says it would be true of any page" "$F" "describes any website"

# === 7. A "why" THAT ONLY RESTATES THE "what".
G="$TMP/restate"; mk "$G"; page "$G"; boards "$G" b1
cat > "$G/src/lib/variants.ts" <<'TS'
export const variants = [
  { id: "b1", name: "The Quiet Room", artboard: "B1.dc.html", ambition: 1,
    what: "One column with a single photograph and a great deal of quiet air.",
    why: "A single photograph, one quiet column, and a great deal of air.",
    feeling: "unhurried, private",
    donor: "therapy-in-london", section: "services",
    motion: "Nothing moves until it is scrolled to, and then it settles rather than arrives.",
    ctas: ["Book", "Ask"] },
];
export const landingVariants = [];
TS
want "a why that restates the what -> block" BLOCK "$(run "$G")"

# === 8. TWO VARIANTS CLAIMING THE SAME RUNG.
H="$TMP/samerung"; mk "$H"; page "$H"; write_valid "$H"
sed -i '' 's/ambition: 2,/ambition: 1,/' "$H/src/lib/variants.ts"
want "two variants on one rung -> block" BLOCK "$(run "$H")"
has "and it names both" "$H" "b1, b2"

# === 9. A LADDER WITH A GAP.
I="$TMP/gap"; mk "$I"; page "$I"; write_valid "$I"
sed -i '' 's/ambition: 2,/ambition: 7,/' "$I/src/lib/variants.ts"
want "positions 1 and 7 for two variants -> block" BLOCK "$(run "$I")"

# === 10. A PLACEHOLDER NAME.
J="$TMP/placeholder"; mk "$J"; page "$J"; write_valid "$J"
sed -i '' 's/The Quiet Room/Option 1/' "$J/src/lib/variants.ts"
want "a board named \"Option 1\" -> block" BLOCK "$(run "$J")"

# === 11. A REGISTERED BOARD WITH NO ARTBOARD. The canvas shows a hole where the rung should be.
K="$TMP/k11"; mk "$K"; page "$K"; boards "$K" b1 b2 b3; write_valid "$K"
rm -f "$K/.palate/explore/seed/B2.dc.html"
want "a registered board with no artboard -> block" BLOCK "$(run "$K")"
has "and it names the file it needs" "$K" ".palate/explore/seed/B2.dc.html"

# === 11b. AN ARTBOARD THE READ-BACK WILL NEVER OPEN. `/pick --canvas` derives the file from the
# RUNG, so B7.dc.html on rung 3 clears a shape check and then reads the client's edits back from
# a file that is not this board's.
K2="$TMP/k11b"; mk "$K2"; page "$K2"
cat > "$K2/src/lib/variants.ts" <<'TS'
export const variants = [
  { id: "b3", name: "The Loud Room", artboard: "B7.dc.html", ambition: 3,
    what: "The whole entrance is one photograph with the offer struck across it.",
    why: "This buyer has already seen four identical quotes and remembers none of them.",
    feeling: "brash, certain, a little rude",
    donor: "utsubo", section: "proof",
    motion: "The struck word redraws itself once, slowly, the first time it is scrolled past.",
    ctas: ["Get a price", "See the work"] },
];
export const landingVariants = [];
TS
boards "$K2" b3
mv "$K2/.palate/explore/seed/B3.dc.html" "$K2/.palate/explore/seed/B7.dc.html"
want "rung 3 registering B7.dc.html -> block" BLOCK "$(run "$K2")"
has "and it names the file the rung reads back" "$K2" "B3.dc.html"
has "and it names the file the board registered" "$K2" "B7.dc.html"

# === 12. A MOTION PLAN THAT RESTATES THE "what". A board is mostly a still, so this is the
# field whose absence is least visible and most expensive.
L="$TMP/motion-restate"; mk "$L"; page "$L"; write_valid "$L"
sed -i '' 's/    motion: "Nothing at all on load\. Everything settles slowly once it is scrolled to, never before\.",/    motion: "One column, one photograph, and a great deal of air.",/' "$L/src/lib/variants.ts"
want "a motion plan that restates the what -> block" BLOCK "$(run "$L")"
has "and it says the motion was never written" "$L" "restates its"

# === 13. TWO BOARDS FROM ONE DONOR. Five boards from one reference are one idea in five skins.
M="$TMP/onedonor"; mk "$M"; page "$M"; write_valid "$M"
sed -i '' 's/donor: "the-modern-house"/donor: "therapy-in-london"/' "$M/src/lib/variants.ts"
want "two boards sharing a donor -> block" BLOCK "$(run "$M")"
has "and it names the donor and both boards" "$M" "therapy-in-london"

# === 14. ONE CTA, OR FOUR.
N="$TMP/ctas"; mk "$N"; page "$N"; write_valid "$N"
sed -i '' 's/ctas: \["Book a first visit", "Ask a question"\]/ctas: ["Book a first visit"]/' "$N/src/lib/variants.ts"
want "a board offering one call to action -> block" BLOCK "$(run "$N")"
has "and it says two or three" "$N" "Two or three"

# === 15. A BOLD BRIEF WITH TOO FEW RUNGS. Below three there is no "between".
O="$TMP/thin-ladder"; mk "$O"; page "$O"; write_valid "$O"
echo '{"schema":3,"commission":{"intensity":"high"}}' > "$O/build-manifest.json"
want "a high-intensity brief with two boards -> block" BLOCK "$(run "$O")"
has "and it says how many rungs it needs" "$O" "at least 3 rungs"
# The same two boards on a CALM brief are fine: the floor is about a bold brief collapsing.
P="$TMP/calm-ladder"; mk "$P"; page "$P"; write_valid "$P"
echo '{"schema":3,"commission":{"intensity":"calm"}}' > "$P/build-manifest.json"
want "the same two boards on a calm brief -> pass" PASS "$(run "$P")"
# An OFF-ENUM intensity fails toward bold, the way gate-done.sh reads the same field.
Q="$TMP/offenum-ladder"; mk "$Q"; page "$Q"; write_valid "$Q"
echo '{"schema":3,"commission":{"intensity":"confident"}}' > "$Q/build-manifest.json"
want "an off-enum intensity is treated as high -> block" BLOCK "$(run "$Q")"

# === 16. SHOWN BUT THE CANVAS WAS NEITHER PUBLISHED NOR DECLINED. Silence is the failure.
R="$TMP/k16"; mk "$R"; page "$R"; boards "$R" b1 b2 b3; write_valid "$R"
echo '{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","boards":[]}}' > "$R/build-manifest.json"
want "shown, no canvas record -> block" BLOCK "$(run "$R")"
has "and it says what to record" "$R" "explore.canvas"
echo '{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"}}}' > "$R/build-manifest.json"
want "shown, canvas url recorded -> pass" PASS "$(run "$R")"
echo '{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"skipped":true,"reason":"no design skill in this session"}}}' > "$R/build-manifest.json"
want "shown, canvas skip recorded with a reason -> pass" PASS "$(run "$R")"
echo '{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"skipped":true}}}' > "$R/build-manifest.json"
want "shown, canvas skipped with NO reason -> block" BLOCK "$(run "$R")"

# === 17. NOT YET SHOWN: the canvas cannot be owed before the boards exist.
S="$TMP/k17"; mk "$S"; page "$S"; boards "$S" b1 b2 b3; write_valid "$S"
echo '{"schema":3}' > "$S/build-manifest.json"
want "not shown yet, no canvas record -> pass" PASS "$(run "$S")"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
