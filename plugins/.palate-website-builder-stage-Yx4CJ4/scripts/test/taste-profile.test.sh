#!/usr/bin/env bash
# Tests scripts/taste-profile.mjs (W5): the profile REFUSES on a sample too small to mean
# anything and says so, counts distinct BRIEFS rather than log rows, debiases by pick-rate,
# never treats the surveyed-donor list as a preference, drops a value that appears in every
# build as uninformative, reports what it could not read, and always carries a non-zero
# exploration budget.
#
# The bar moved deliberately on 2026-08-13. The old version returned a confident profile
# (100% confidence on `linear` and `gsap`) from a log whose 1,735 rows held 37 signature
# moves and 2 face records, because it sized the sample on rows and read the survey list as
# a preference. These tests pin the refusal.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MOD="$DIR/../taste-profile.mjs"
pass=0; fail=0
check() { local d="$1" ec="$2"; if [ "$ec" -eq 0 ]; then echo "ok   - $d"; pass=$((pass+1)); else echo "FAIL - $d"; fail=$((fail+1)); fi; }
run() { node --input-type=module -e "import { buildTasteProfile } from \"file://$MOD\";$1"; }

# 1. Below the sample floor -> REFUSE, loudly, with no preferences at all.
run '
const log = Array.from({length:4}, (_,i) => ({
  ts:"t"+i, business:"brief-"+i, signature_move:"carried-timeline", donors:["aesop"], faces:["simula"],
}));
const p = buildTasteProfile(log, 8);
const ok = p.refused === true && p.hasSignal === false &&
  p.usableBuilds === 4 &&
  p.preferences.signatureMove.length === 0 &&
  /Refusing to bias/.test(p.refusedReason) &&
  /NO TASTE PROFILE/.test(p.summary);
process.exit(ok ? 0 : 1);
'
check "below the sample floor -> refuses and says so (no confident profile from 4 briefs)" $?

# 2. Above the floor: a hero pattern SHOWN and PICKED is a preference; SHOWN-but-never-
#    PICKED is not (propensity debiasing, the one real rate the log carries).
run '
const log = Array.from({length:12}, (_,i) => ({
  ts:"t"+i, business:"brief-"+i, signature_move:"move-"+i,
  explore: { ran:true, shown:[
    { id:"v1", hero_pattern:"asymmetric-left", donor_slug:"aesop" },
    { id:"v2", hero_pattern:"centred-stock",  donor_slug:"stocky" },
  ], picks:[{ surface:"hero", variant_id:"v1" }] },
}));
const p = buildTasteProfile(log, 8);
const asym  = p.preferences.heroPattern.find(h => h.value === "asymmetric-left");
const stock = p.preferences.heroPattern.find(h => h.value === "centred-stock");
const ok = p.refused === false && p.hasSignal === true &&
  asym && asym.pickRate === 1 && asym.briefs === 12 && asym.evidence === "pick-rate" &&
  !stock;
process.exit(ok ? 0 : 1);
'
check "picked hero pattern is a preference; shown-but-never-picked is debiased out" $?

# 3. The surveyed-donor list is NEVER a preference. `donors` is manifest.references_surveyed
#    (the whole survey), so recurrence in it measures the library, not the operator. This is
#    the exact path that reported linear + gsap at 100% on the real log.
run '
const log = Array.from({length:12}, (_,i) => ({
  ts:"t"+i, business:"brief-"+i, signature_move:"move-"+i,
  donors:["linear","gsap","anthropic","aesop"], faces:[],
}));
const p = buildTasteProfile(log, 8);
const ok = p.preferences.donor.length === 0 &&
  !/linear/.test(p.summary) && !/gsap/.test(p.summary) &&
  /survey list/.test(p.excluded.surveyedDonors);
process.exit(ok ? 0 : 1);
'
check "surveyed donors never become a preference (linear/gsap cannot be inferred)" $?

# 4. Re-runs of ONE brief are one observation. The real log holds the same Gelato Messina
#    build nine times; counting rows turned that into a nine-build house style.
run '
const log = [];
for (let i=0;i<9;i++) log.push({ ts:"m"+i, business:"Gelato Messina", signature_move:"the-cabinet-thawed" });
for (let i=0;i<11;i++) log.push({ ts:"o"+i, business:"other-"+i, signature_move:"unique-"+i });
const p = buildTasteProfile(log, 8);
const cab = p.preferences.signatureMove.find(s => s.value === "the-cabinet-thawed");
const ok = p.refused === false && p.usableBuilds === 12 && !cab;
process.exit(ok ? 0 : 1);
'
check "nine re-runs of one brief count once, not nine (no house style from one client)" $?

# 5. A value present in EVERY build is the constant, not the preference: biasing toward it
#    can only remove variety.
run '
const log = Array.from({length:12}, (_,i) => ({ ts:"t"+i, business:"brief-"+i, signature_move:"same-move" }));
const p = buildTasteProfile(log, 8);
process.exit((p.preferences.signatureMove.length === 0 && p.hasSignal === false) ? 0 : 1);
'
check "a value in 100% of briefs is dropped as uninformative, not reported as certainty" $?

# 6. The older id-only `explore.shown: ["v1","v2"]` shape (five entries in the real log) is
#    COUNTED and reported, never silently matched against nothing.
run '
const log = Array.from({length:12}, (_,i) => ({
  ts:"t"+i, business:"brief-"+i,
  explore: { ran:true, n:3, shown:["v1","v2","v3"] },
}));
const p = buildTasteProfile(log, 8);
const ok = p.unreadable.exploreIdOnlyShown === 36 &&
  p.unreadable.exploreWithNoPicks === 12 &&
  p.preferences.heroPattern.length === 0;
process.exit(ok ? 0 : 1);
'
check "id-only explore.shown is counted under unreadable, not silently dropped" $?

# 7. The diversity guard: exploration budget is always >= 2 (the breadth floor), including
#    on a refused profile.
run '
const p = buildTasteProfile([], 8);
const q = buildTasteProfile(Array.from({length:20},(_,i)=>({ts:"t"+i,business:"b"+i,signature_move:"m"+i})), 4);
process.exit((p.diversityGuard.explorationBudget >= 2 && q.diversityGuard.explorationBudget >= 2) ? 0 : 1);
'
check "diversity guard: exploration budget >= 2 even when the profile refuses" $?

# 8. An empty log refuses rather than returning an empty-but-confident profile.
run '
const p = buildTasteProfile([], 8);
process.exit((p.refused === true && p.hasSignal === false && p.usableBuilds === 0) ? 0 : 1);
'
check "empty log -> refuses (no log is not a neutral pass)" $?

echo ""; echo "taste-profile: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
