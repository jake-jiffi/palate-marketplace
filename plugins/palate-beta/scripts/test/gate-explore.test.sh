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

mk() { mkdir -p "$1/src/lib" "$1/src/pages/boards"; }
page() { : > "$1/src/pages/explore.astro"; }
boards() { for id in "${@:2}"; do : > "$1/src/pages/boards/$id.astro"; done; }

# A fully-argued two-rung set, with the pages it registers.
good_variants() { cat > "$1/src/lib/variants.ts" <<'TS'
export interface Variant { id: string; name: string; href: string; ambition: number; what: string; why: string; feeling: string; donor: string; section: string; motion: string; ctas: string[]; }
export const variants: Variant[] = [
  { id: "b1", name: "The Quiet Room", href: "/boards/b1", ambition: 1,
    what: "One column, one photograph, and a great deal of air.",
    why: "People arriving here are anxious and have usually been dismissed once already, so nothing asks anything of them before they have read a sentence.",
    feeling: "unhurried, private, adult",
    donor: "therapy-in-london", section: "services",
    motion: "Nothing at all on load. Everything settles slowly once it is scrolled to, never before.",
    ctas: ["Book a first visit", "Ask a question"] },
  { id: "b2", name: "The Folder", href: "/boards/b2", ambition: 2,
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
C="$TMP/good"; mk "$C"; good_variants "$C"; page "$C"
want "argued boards + the explore page -> pass" PASS "$(run "$C")"

# === 4. VARIANTS BUT NO COACHING PAGE.
D="$TMP/nopage"; mk "$D"; good_variants "$D"
want "variants with no explore.astro -> block" BLOCK "$(run "$D")"
has "and it says the client would get a list of URLs" "$D" "list of URLs"

# === 5. A VARIANT THAT DOES NOT ARGUE FOR ITSELF.
E="$TMP/thin"; mk "$E"; page "$E"
cat > "$E/src/lib/variants.ts" <<'TS'
export const variants = [
  { id: "b1", name: "The Quiet Room", href: "/boards/b1", ambition: 1 },
];
export const landingVariants = [];
TS
want "a board with no what/why/feeling -> block" BLOCK "$(run "$E")"
has "and it names every missing field" "$E" "missing what, why, feeling, donor, section, motion, ctas"

# === 6. A FEELING THAT DESCRIBES ANY WEBSITE.
F="$TMP/generic"; mk "$F"; page "$F"; good_variants "$F"
sed -i '' 's/unhurried, private, adult/modern and clean/' "$F/src/lib/variants.ts"
want "feeling \"modern and clean\" -> block" BLOCK "$(run "$F")"
has "and it says it would be true of any page" "$F" "describes any website"

# === 7. A "why" THAT ONLY RESTATES THE "what".
G="$TMP/restate"; mk "$G"; page "$G"; boards "$G" b1
cat > "$G/src/lib/variants.ts" <<'TS'
export const variants = [
  { id: "b1", name: "The Quiet Room", href: "/boards/b1", ambition: 1,
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
H="$TMP/samerung"; mk "$H"; page "$H"; good_variants "$H"
sed -i '' 's/ambition: 2,/ambition: 1,/' "$H/src/lib/variants.ts"
want "two variants on one rung -> block" BLOCK "$(run "$H")"
has "and it names both" "$H" "b1, b2"

# === 9. A LADDER WITH A GAP.
I="$TMP/gap"; mk "$I"; page "$I"; good_variants "$I"
sed -i '' 's/ambition: 2,/ambition: 7,/' "$I/src/lib/variants.ts"
want "positions 1 and 7 for two variants -> block" BLOCK "$(run "$I")"

# === 10. A PLACEHOLDER NAME.
J="$TMP/placeholder"; mk "$J"; page "$J"; good_variants "$J"
sed -i '' 's/The Quiet Room/Option 1/' "$J/src/lib/variants.ts"
want "a board named \"Option 1\" -> block" BLOCK "$(run "$J")"

# === 11. A REGISTERED BOARD WITH NO PAGE. The client clicks it from /explore and gets a 404,
# which is the one impression a preview cannot recover from.
K="$TMP/nopage-board"; mk "$K"; page "$K"; good_variants "$K"
rm -f "$K/src/pages/boards/b2.astro"
want "a board whose page does not exist -> block" BLOCK "$(run "$K")"
has "and it names the file it needs" "$K" "src/pages/boards/b2.astro"

# === 12. A MOTION PLAN THAT RESTATES THE "what". A board is mostly a still, so this is the
# field whose absence is least visible and most expensive.
L="$TMP/motion-restate"; mk "$L"; page "$L"; good_variants "$L"
sed -i '' 's/    motion: "Nothing at all on load\. Everything settles slowly once it is scrolled to, never before\.",/    motion: "One column, one photograph, and a great deal of air.",/' "$L/src/lib/variants.ts"
want "a motion plan that restates the what -> block" BLOCK "$(run "$L")"
has "and it says the motion was never written" "$L" "restates its"

# === 13. TWO BOARDS FROM ONE DONOR. Five boards from one reference are one idea in five skins.
M="$TMP/onedonor"; mk "$M"; page "$M"; good_variants "$M"
sed -i '' 's/donor: "the-modern-house"/donor: "therapy-in-london"/' "$M/src/lib/variants.ts"
want "two boards sharing a donor -> block" BLOCK "$(run "$M")"
has "and it names the donor and both boards" "$M" "therapy-in-london"

# === 14. ONE CTA, OR FOUR.
N="$TMP/ctas"; mk "$N"; page "$N"; good_variants "$N"
sed -i '' 's/ctas: \["Book a first visit", "Ask a question"\]/ctas: ["Book a first visit"]/' "$N/src/lib/variants.ts"
want "a board offering one call to action -> block" BLOCK "$(run "$N")"
has "and it says two or three" "$N" "Two or three"

# === 15. A BOLD BRIEF WITH TOO FEW RUNGS. Below three there is no "between".
O="$TMP/thin-ladder"; mk "$O"; page "$O"; good_variants "$O"
echo '{"schema":3,"commission":{"intensity":"high"}}' > "$O/build-manifest.json"
want "a high-intensity brief with two boards -> block" BLOCK "$(run "$O")"
has "and it says how many rungs it needs" "$O" "at least 3 rungs"
# The same two boards on a CALM brief are fine: the floor is about a bold brief collapsing.
P="$TMP/calm-ladder"; mk "$P"; page "$P"; good_variants "$P"
echo '{"schema":3,"commission":{"intensity":"calm"}}' > "$P/build-manifest.json"
want "the same two boards on a calm brief -> pass" PASS "$(run "$P")"
# An OFF-ENUM intensity fails toward bold, the way gate-done.sh reads the same field.
Q="$TMP/offenum-ladder"; mk "$Q"; page "$Q"; good_variants "$Q"
echo '{"schema":3,"commission":{"intensity":"confident"}}' > "$Q/build-manifest.json"
want "an off-enum intensity is treated as high -> block" BLOCK "$(run "$Q")"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
