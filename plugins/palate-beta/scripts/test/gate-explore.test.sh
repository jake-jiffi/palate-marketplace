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
# The other half: a finding that must NOT be in the output, so two checks cannot contradict
# each other over one build.
hasnt_out() { local out; out="$(why "$2")"
        if printf '%s' "$out" | grep -qiF "$3"; then echo "FAIL - $1 (found '$3')"; fail=$((fail+1));
        else echo "ok   - $1"; pass=$((pass+1)); fi; }

mk() { mkdir -p "$1/src/lib" "$1/src/pages" "$1/.palate/explore/seed"; }
page() { : > "$1/src/pages/explore.astro"; }
# A DIRECTION IS FOUR ARTBOARDS, so the fixture draws four. The inner page, the phone board and
# the detail sheet are written as plain frames: the gate checks the sheet's `data-kit-piece`
# marks (check 10, and `sheet()` below writes a marked one over this) and checks the other two
# only for EXISTENCE, which is the whole of what check 4 owns.
boards() { local id n kind; for id in "${@:2}"; do n="${id#b}"
  printf '<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style></style></helmet><section class="hero" data-section-id="%s-hero"></section></x-dc></body></html>' "$id" > "$1/.palate/explore/seed/B$n.dc.html"
  for kind in I M S; do printf '<!doctype html><html><body><x-dc><section></section></x-dc></body></html>' > "$1/.palate/explore/seed/$kind$n.dc.html"; done
done; }

# sheet <dir> <rung> <navigation> <footer> <cta> <forms> - the direction's detail sheet.
#
# Only the `data-kit-piece` marks matter here: check 10 reads the sheet the client is shown and
# compares the variations on it with the ones the registry claims. The navigation deliberately
# carries TWO variations (the bar at rest and the drawer on a phone), because that is what a real
# sheet carries, and a check that demanded one variation per piece would refuse every honest one.
sheet() { printf '<!doctype html><html><body><x-dc>\
<section data-kit-piece="navigation:%s:default"><p>The bar at rest.</p></section>\
<section data-kit-piece="navigation:NavMobileSheet:open"><p>The drawer open on a phone.</p></section>\
<section data-kit-piece="footer:%s:default"><p>The footer.</p></section>\
<section data-kit-piece="cta:%s:default"><p>The closing band.</p></section>\
<section data-kit-piece="forms:%s:default"><p>The enquiry form filled in.</p></section>\
<section data-kit-piece="forms:%s:error"><p>The same form with its errors shown.</p></section>\
</x-dc></body></html>' "$3" "$4" "$5" "$6" "$6" > "$1/.palate/explore/seed/S$2.dc.html"; }

# A fully-argued two-rung set, with the artboards it registers.
#
# `pieces` carries the per-piece provenance: every direction names the kit variation it used for
# the navigation, the hero, the closing band, the enquiry form, the footer and its own inner
# section, and the reference each of those came from. Note b1's navigation and b2's inner section
# both name `aesop`: a PIECE donor is not a BOARD donor, and reading one as the other reports two
# boards drawn from one reference when nothing of the sort happened.
write_valid() { cat > "$1/src/lib/variants.ts" <<'TS'
export interface Variant { id: string; name: string; artboard: string; presentation: { inner: string; mobile: string; sheet: string }; href?: string; ambition: number; what: string; why: string; feeling: string; donor: string; section: string; motion: string; ctas: string[]; pieces: Record<string, { variation: string; donor: string }>; }
export const variants: Variant[] = [
  { id: "b1", name: "The Quiet Room", artboard: "B1.dc.html", ambition: 1,
    presentation: { inner: "I1.dc.html", mobile: "M1.dc.html", sheet: "S1.dc.html" },
    what: "One column, one photograph, and a great deal of air.",
    why: "People arriving here are anxious and have usually been dismissed once already, so nothing asks anything of them before they have read a sentence.",
    feeling: "unhurried, private, adult",
    donor: "therapy-in-london", section: "services",
    motion: "Nothing at all on load. Everything settles slowly once it is scrolled to, never before.",
    ctas: ["Book a first visit", "Ask a question"],
    pieces: {
      navigation: { variation: "NavSimple", donor: "aesop" },
      hero: { variation: "HeroTextImage", donor: "anthropic" },
      trust: { variation: "TrustRatings", donor: "lava-dental" },
      cta: { variation: "CtaClosing", donor: "parsley-health" },
      forms: { variation: "FormEnquiry", donor: "pilot-accounting" },
      footer: { variation: "FooterSimple", donor: "loom" },
      services: { variation: "BenefitCards", donor: "linear" },
    } },
  { id: "b2", name: "The Folder", artboard: "B2.dc.html", ambition: 2,
    presentation: { inner: "I2.dc.html", mobile: "M2.dc.html", sheet: "S2.dc.html" },
    what: "The record itself becomes the interface, opening as you scroll.",
    why: "Their entire pitch is that a clinician finally sees six months of evidence instead of one appointment, so the page should behave like that evidence.",
    feeling: "purposeful, quietly technical",
    donor: "the-modern-house", section: "proof",
    motion: "Each layer lifts and offsets under the pointer, so depth is felt rather than drawn.",
    ctas: ["See the record", "Talk to us", "Read the method"],
    pieces: {
      navigation: { variation: "NavDropdown", donor: "stripe" },
      hero: { variation: "HeroCentredPreview", donor: "linear" },
      trust: { variation: "TrustLogos", donor: "mercury" },
      cta: { variation: "CtaWithProof", donor: "vercel" },
      forms: { variation: "FormContact", donor: "basecamp" },
      footer: { variation: "FooterGrouped", donor: "glossier" },
      proof: { variation: "TestimonialGrid", donor: "aesop" },
    } },
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
    presentation: { inner: "I3.dc.html", mobile: "M3.dc.html", sheet: "S3.dc.html" },
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

# === 11c. THE OTHER THREE ARTBOARDS, REGISTERED AND NEVER DRAWN. boards-render owns this at
# DRAW time and gate-done never runs boards-render, so a direction whose inner page, phone board
# or detail sheet was deleted, renamed or never committed used to clear every done-time gate.
for pk in I M S; do
  K3="$TMP/k11c-$pk"; mk "$K3"; page "$K3"; write_valid "$K3"
  rm -f "$K3/.palate/explore/seed/${pk}2.dc.html"
  want "a direction whose ${pk}2.dc.html was never drawn -> block" BLOCK "$(run "$K3")"
  has "and it names the file that is missing" "$K3" ".palate/explore/seed/${pk}2.dc.html"
done

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
# Every board judged, so the canvas is genuinely owed: the two checks are ordered, and check 8
# suppresses check 7 while a judgement is outstanding (case 18b below).
echo '{"schema":3,"explore":{"ran":true,"boards":[],"board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},{"id":"b2","donor":"the-modern-house","rung":"comparable","consistent":true}],"shown_at":"2026-09-11T04:00:00Z"}}' > "$R/build-manifest.json"
want "shown and judged, no canvas record -> block" BLOCK "$(run "$R")"
has "and it says what to record" "$R" "explore.canvas"
echo '{"schema":3,"explore":{"ran":true,"board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},{"id":"b2","donor":"the-modern-house","rung":"comparable","consistent":true}],"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"}}}' > "$R/build-manifest.json"
want "shown, canvas url recorded -> pass" PASS "$(run "$R")"
echo '{"schema":3,"explore":{"ran":true,"board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},{"id":"b2","donor":"the-modern-house","rung":"comparable","consistent":true}],"shown_at":"2026-09-11T04:00:00Z","canvas":{"skipped":true,"reason":"no design skill in this session"}}}' > "$R/build-manifest.json"
want "shown, canvas skip recorded with a reason -> pass" PASS "$(run "$R")"
echo '{"schema":3,"explore":{"ran":true,"board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},{"id":"b2","donor":"the-modern-house","rung":"comparable","consistent":true}],"shown_at":"2026-09-11T04:00:00Z","canvas":{"skipped":true}}}' > "$R/build-manifest.json"
want "shown and judged, canvas skipped with NO reason -> block" BLOCK "$(run "$R")"

# === 17. NOT YET SHOWN: the canvas cannot be owed before the boards exist.
S="$TMP/k17"; mk "$S"; page "$S"; boards "$S" b1 b2 b3; write_valid "$S"
echo '{"schema":3}' > "$S/build-manifest.json"
want "not shown yet, no canvas record -> pass" PASS "$(run "$S")"

# === 18. A SHOWN BOARD WITH NO JUDGEMENT. The judge runs on every rung at every intensity, so
# once the boards are in front of a client, "was this compared with the reference it was drawn
# from?" has to have an answer for each of them.
T="$TMP/k18"; mk "$T"; page "$T"; boards "$T" b1 b2; write_valid "$T"
cat > "$T/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"},
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true}]}}
JSON
want "shown, only one of two boards judged -> block" BLOCK "$(run "$T")"
has "and it names the unjudged board" "$T" "b2"
has "and it names the gate that judges it" "$T" "gate-board-judge.mjs"
# WHO dispatches. The verifier has no Agent tool, so a finding that says only "dispatch each
# comparison to a fresh subagent" reads, to the agent most likely to be running this, as an
# instruction it cannot follow.
has "and it says who dispatches the comparisons" "$T" "the main build agent dispatches"

cat > "$T/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"},
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},
                     {"id":"b2","donor":"the-modern-house","rung":"clearly_worse","consistent":true}]}}
JSON
want "shown with a board judged clearly worse -> block" BLOCK "$(run "$T")"
has "and it says which board is worse than its donor" "$T" "clearly worse"

cat > "$T/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"},
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},
                     {"id":"b2","donor":"the-modern-house","rung":"better","consistent":true}]}}
JSON
want "shown with every board judged comparable or better -> pass" PASS "$(run "$T")"

# The release valve, and it must release the whole check rather than soften it.
cat > "$T/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"}}}
JSON
want "shown, no judgements at all -> block" BLOCK "$(run "$T")"
export PALATE_GATE_JUDGE=0
want "PALATE_GATE_JUDGE=0 -> pass" PASS "$(run "$T")"
unset PALATE_GATE_JUDGE

# === 18a. A DIRECTION WHOSE PAGE ENDING WAS NEVER JUDGED. The library holds no whole-page
# capture for every reference, so the foot pair is dropped rather than refused, and a dropped
# surface has to be VISIBLE: "lowest across three surfaces" quietly means "lowest across the two
# we managed" otherwise, and the record reads the same either way. A warning, never a failure.
W="$TMP/k18a"; mk "$W"; page "$W"; boards "$W" b1 b2; write_valid "$W"
cat > "$W/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"},
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true,"rungs":{"entrance":"comparable","foot":"comparable","inner":"comparable"}},
                     {"id":"b2","donor":"the-modern-house","rung":"comparable","consistent":true,"rungs":{"entrance":"comparable","foot":null,"inner":"comparable"}}]}}
JSON
want "a direction judged on two surfaces still passes" PASS "$(run "$W")"
has "and the run WARNS, naming the direction" "$W" "b2"
has "and it says which surface went unjudged" "$W" "page ending"
hasnt_out "and it does not name the direction judged on all three" "$W" "b1 (the-modern-house)"

# Every surface judged: nothing to warn about.
cat > "$W/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"},
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true,"rungs":{"entrance":"comparable","foot":"comparable","inner":"comparable"}},
                     {"id":"b2","donor":"the-modern-house","rung":"comparable","consistent":true,"rungs":{"entrance":"comparable","foot":"comparable","inner":"comparable"}}]}}
JSON
want "every surface judged -> pass" PASS "$(run "$W")"
hasnt_out "and nothing is warned about" "$W" "page ending"

# A record from before the surfaces existed carries no `rungs` at all. That is not a dropped
# surface, it is an older gate, and inventing a warning for it would cry wolf on every build
# judged before this change.
cat > "$W/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","canvas":{"url":"https://claude.ai/code/artifact/abc"},
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},
                     {"id":"b2","donor":"the-modern-house","rung":"comparable","consistent":true}]}}
JSON
want "a record with no per-surface rungs -> pass" PASS "$(run "$W")"
hasnt_out "and it is not warned about either" "$W" "page ending"

# === 18b. ROUND ONE: the boards are rendered and judged by nothing yet, and the canvas is not
# owed until the judge has passed. The two checks used to CO-FIRE and contradict each other,
# telling one build to publish the canvas and to judge the boards it would have published.
V="$TMP/k18c"; mk "$V"; page "$V"; boards "$V" b1 b2; write_valid "$V"
cat > "$V/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z"}}
JSON
want "shown, nothing judged and no canvas -> block" BLOCK "$(run "$V")"
has "and it names both unjudged boards" "$V" "b1, b2"
hasnt_out "and it does NOT also demand a canvas record" "$V" "neither published nor declined"
has "and it says the canvas comes after EVERY board passes" "$V" "once EVERY board has passed the judge"

# One board judged, one not: still the judge's finding alone, still no canvas demand.
cat > "$V/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z",
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true}]}}
JSON
want "shown, half judged, no canvas -> block" BLOCK "$(run "$V")"
hasnt_out "and the canvas is still not owed" "$V" "neither published nor declined"

# Every board judged and no canvas record: NOW the canvas is owed, and check 7 fires as it did.
cat > "$V/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z",
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},
                     {"id":"b2","donor":"the-modern-house","rung":"comparable","consistent":true}]}}
JSON
want "shown, fully judged, no canvas -> block" BLOCK "$(run "$V")"
has "and now it IS the canvas that is owed" "$V" "neither published nor declined"

# === 18d. A BOARD THE JUDGE JUST REFUSED IS NOT "JUDGED, SO WHERE IS THE CANVAS?". A board read
# clearly_worse is redrawn, so the canvas is owed no more on it than on a board nobody looked at.
W="$TMP/k18d"; mk "$W"; page "$W"; boards "$W" b1 b2; write_valid "$W"
cat > "$W/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z",
 "board_judgements":[{"id":"b1","donor":"therapy-in-london","rung":"comparable","consistent":true},
                     {"id":"b2","donor":"the-modern-house","rung":"clearly_worse","consistent":true}]}}
JSON
want "shown, one board refused and no canvas -> block" BLOCK "$(run "$W")"
has "and it says which board is worse than its donor" "$W" "clearly worse"
hasnt_out "and the canvas is NOT owed on a build the judge refused" "$W" "neither published nor declined"

# === 18e. A BUILD WITH NO DONOR ROW IS OUTSIDE THE JUDGE, so the canvas check must fire as it
# always did. Reading "no judgements" as "still owed" would silence check 7 forever on exactly
# the builds that still owe a canvas.
X="$TMP/k18e"; mk "$X"; page "$X"; boards "$X" b1 b2; write_valid "$X"
cat > "$X/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","donor_row":{"skipped":true}}}
JSON
want "no donor row, no canvas record -> block" BLOCK "$(run "$X")"
has "and it IS the canvas that is owed" "$X" "neither published nor declined"
has "and it says the judge does not apply here" "$X" "the board judge does not apply here"
hasnt_out "and it does not ask for judgements nothing can produce" "$X" "never compared with their donor"

cat > "$X/build-manifest.json" <<'JSON'
{"schema":3,"explore":{"ran":true,"shown_at":"2026-09-11T04:00:00Z","donor_row":{"skipped":true},
 "canvas":{"url":"https://claude.ai/code/artifact/abc"}}}
JSON
want "no donor row, canvas recorded -> pass" PASS "$(run "$X")"

# Not shown yet: a judgement cannot be owed before a client has seen anything.
U="$TMP/k18b"; mk "$U"; page "$U"; boards "$U" b1 b2; write_valid "$U"
echo '{"schema":3}' > "$U/build-manifest.json"
want "not shown yet, no judgements -> pass" PASS "$(run "$U")"

# === 19. PROVENANCE PER PIECE. A direction is signed off piece by piece, so every piece names
# the kit variation it used and the reference that variation's craft came from. Without it the
# navigation, the form and the footer are decided later, by nobody, and the client discovers them
# on the built site.
AA="$TMP/k19"; mk "$AA"; page "$AA"; write_valid "$AA"
perl -0pi -e 's/\n    pieces: \{.*?\n    \} \}/ }/s' "$AA/src/lib/variants.ts"
want "a board that names no pieces -> block" BLOCK "$(run "$AA")"
has "and it shows the shape it wants" "$AA" "pieces: { navigation: { variation, donor }"
has "and it names the section the board itself declares" "$AA" "services"

# 19b. ONE REQUIRED PIECE LEFT OUT.
AB="$TMP/k19b"; mk "$AB"; page "$AB"; write_valid "$AB"
perl -0pi -e 's/\n      forms: \{ variation: "FormEnquiry", donor: "pilot-accounting" \},//' "$AB/src/lib/variants.ts"
want "a board whose pieces leave out the form -> block" BLOCK "$(run "$AB")"
has "and it names the piece that is missing" "$AB" "forms"
# The trust strip is on the required list because it is a required block on the detail sheet, and
# it is the block whose copy is most often invented, so it is the one that most needs a donor.
AB2="$TMP/k19b2"; mk "$AB2"; page "$AB2"; write_valid "$AB2"
perl -0pi -e 's/\n      trust: \{ variation: "TrustRatings", donor: "lava-dental" \},//' "$AB2/src/lib/variants.ts"
want "a board whose pieces leave out the trust strip -> block" BLOCK "$(run "$AB2")"
has "and it names the trust strip" "$AB2" "trust"

# 19c. A VARIATION THE KIT DOES NOT CARRY. The sheet is what the client signs off, so a variation
# nobody can build is a promise made on the build's behalf.
AC="$TMP/k19c"; mk "$AC"; page "$AC"; write_valid "$AC"
sed -i '' 's/variation: "NavSimple"/variation: "NavSplendid"/' "$AC/src/lib/variants.ts"
want "a piece naming a variation the kit does not carry -> block" BLOCK "$(run "$AC")"
has "and it names the variation" "$AC" "NavSplendid"
has "and it lists the ones that piece does carry" "$AC" "NavSimple, NavDropdown, NavMobileSheet"

# 19c2. A BESPOKE SECTION NAME. The registry's `section` is free text ("services", "proof"), so
# its variation cannot be held to one piece's list, and a finding that only says "no piece carries
# it" leaves the author with nothing to write instead.
AC2="$TMP/k19c2"; mk "$AC2"; page "$AC2"; write_valid "$AC2"
sed -i '' 's/services: { variation: "BenefitCards"/services: { variation: "ServiceSplendour"/' "$AC2/src/lib/variants.ts"
want "a bespoke section naming a variation no piece carries -> block" BLOCK "$(run "$AC2")"
has "and it says any kit variation would do here" "$AC2" "ANY variation in src/lib/kit.ts is acceptable"
has "and it enumerates what the kit carries" "$AC2" "benefits: BenefitCards, BenefitAlternating"

# 19d. A REAL VARIATION UNDER THE WRONG PIECE. It passes a spell check and builds nothing.
AD="$TMP/k19d"; mk "$AD"; page "$AD"; write_valid "$AD"
sed -i '' 's/navigation: { variation: "NavSimple"/navigation: { variation: "FooterSimple"/' "$AD/src/lib/variants.ts"
want "a footer variation registered as the navigation -> block" BLOCK "$(run "$AD")"
has "and it says where that variation actually belongs" "$AD" "belongs to footer"

# 19e. A PIECE DRAWN FROM A REFERENCE NOBODY READ. Provenance that names an unread reference is
# provenance invented after the fact, which is the exact fault the survey exists to stop.
AE="$TMP/k19e"; mk "$AE"; page "$AE"; write_valid "$AE"
cat > "$AE/build-manifest.json" <<'JSON'
{"schema":3,"references_surveyed":["aesop","anthropic","lava-dental","parsley-health","pilot-accounting","loom","linear","stripe","mercury","vercel","basecamp","glossier"]}
JSON
want "every piece donor surveyed -> pass" PASS "$(run "$AE")"
sed -i '' 's/donor: "pilot-accounting" }/donor: "a-site-nobody-read" }/' "$AE/src/lib/variants.ts"
want "a piece drawn from a reference nobody surveyed -> block" BLOCK "$(run "$AE")"
has "and it names the piece and the unread reference" "$AE" "a-site-nobody-read"
# And a build with no surveyed list has nothing to check the donors against: it says nothing
# rather than blocking every direction on a manifest that was never written.
rm -f "$AE/build-manifest.json"
hasnt_out "no surveyed list -> the donor check says nothing" "$AE" "a-site-nobody-read"

# 19f. A PIECE DONOR IS NOT A BOARD DONOR, WHEREVER THE BLOCK SITS IN THE ENTRY. `pieces` carries
# a donor per entry, so a reader taking the first `donor:` in the object reads the NAVIGATION's
# reference as the direction's. Written with `pieces` ABOVE the board's own donor, which is the
# order that exposes it: both boards here name aesop for a piece and neither shares a board donor.
AF="$TMP/k19f"; mk "$AF"; page "$AF"; boards "$AF" b1 b2
cat > "$AF/src/lib/variants.ts" <<'TS'
export const variants = [
  { id: "b1", name: "The Quiet Room", artboard: "B1.dc.html", ambition: 1,
    presentation: { inner: "I1.dc.html", mobile: "M1.dc.html", sheet: "S1.dc.html" },
    pieces: {
      navigation: { variation: "NavSimple", donor: "aesop" },
      hero: { variation: "HeroTextImage", donor: "anthropic" },
      trust: { variation: "TrustRatings", donor: "lava-dental" },
      cta: { variation: "CtaClosing", donor: "parsley-health" },
      forms: { variation: "FormEnquiry", donor: "pilot-accounting" },
      footer: { variation: "FooterSimple", donor: "loom" },
      benefits: { variation: "BenefitCards", donor: "linear" },
    },
    what: "One column, one photograph, and a great deal of air.",
    why: "The people arriving are anxious and have usually been dismissed once already.",
    feeling: "unhurried, private, adult",
    donor: "therapy-in-london", section: "benefits",
    motion: "Nothing at all on load. Everything settles slowly once it is scrolled to, never before.",
    ctas: ["Book a first visit", "Ask a question"] },
  { id: "b2", name: "The Folder", artboard: "B2.dc.html", ambition: 2,
    presentation: { inner: "I2.dc.html", mobile: "M2.dc.html", sheet: "S2.dc.html" },
    pieces: {
      navigation: { variation: "NavDropdown", donor: "aesop" },
      hero: { variation: "HeroCentredPreview", donor: "linear" },
      trust: { variation: "TrustLogos", donor: "mercury" },
      cta: { variation: "CtaWithProof", donor: "vercel" },
      forms: { variation: "FormContact", donor: "basecamp" },
      footer: { variation: "FooterGrouped", donor: "glossier" },
      casestudies: { variation: "CaseCards", donor: "aesop" },
    },
    what: "The record itself becomes the interface, opening as you scroll.",
    why: "Their pitch is that a clinician finally sees six months of evidence, so the page behaves like it.",
    feeling: "purposeful, quietly technical",
    donor: "the-modern-house", section: "casestudies",
    motion: "Each layer lifts and offsets under the pointer, so depth is felt rather than drawn.",
    ctas: ["See the record", "Talk to us"] },
];
export const landingVariants = [];
TS
want "pieces written above the board's own donor -> pass" PASS "$(run "$AF")"
hasnt_out "a shared PIECE donor is not two boards from one reference" "$AF" "drawn from aesop"

# 19g. NO PRESENTATION AT ALL. Check 10 reads the sheet named by presentation.sheet, so a
# registry that declares none has nothing to compare and the comparison silently does not happen
# on the direction least likely to survive it.
AG="$TMP/k19g"; mk "$AG"; page "$AG"; write_valid "$AG"
perl -0pi -e 's/\n    presentation: \{[^\n]*\},//' "$AG/src/lib/variants.ts"
want "a direction that names none of its other three artboards -> block" BLOCK "$(run "$AG")"
has "and it names the field" "$AG" "presentation"

# === 20. THE SHEET AND THE REGISTRY AGREE. The sheet is the artefact the client signs; the
# registry is what Compose builds from. A direction whose sheet shows one footer and whose
# registry records another ships a footer nobody approved.
BA="$TMP/k20"; mk "$BA"; page "$BA"; write_valid "$BA"
sheet "$BA" 1 NavSimple FooterSimple CtaClosing FormEnquiry
want "a sheet whose variations match the registry -> pass" PASS "$(run "$BA")"
sheet "$BA" 1 NavSimple FooterGrouped CtaClosing FormEnquiry
want "a sheet showing a footer the registry does not record -> block" BLOCK "$(run "$BA")"
has "and it names the piece" "$BA" "footer"
has "and it names what the registry records" "$BA" "FooterSimple"
has "and it names what the sheet shows" "$BA" "FooterGrouped"
# A sheet that is not on disk is reported ONCE, by check 4, which owns the four files. Check 10
# still says nothing about it: comparing a sheet nobody drew against the registry would report
# the same absence twice in two different words.
rm -f "$BA/.palate/explore/seed/S1.dc.html"
want "a registered sheet that was never drawn -> block" BLOCK "$(run "$BA")"
hasnt_out "and check 10 does not report the same absence as a disagreement" "$BA" "disagree about the"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
