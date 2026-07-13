#!/usr/bin/env bash
# Tests scripts/taste-profile.mjs (W5): the positive profile picks up recurring KEPT
# choices, DEBIASES by pick-rate (a hero pattern shown often but never picked is not a
# preference), always carries a non-zero exploration budget (the diversity guard), and
# stays inert on too little history.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MOD="$DIR/../taste-profile.mjs"
pass=0; fail=0
check() { local d="$1" ec="$2"; if [ "$ec" -eq 0 ]; then echo "ok   - $d"; pass=$((pass+1)); else echo "FAIL - $d"; fail=$((fail+1)); fi; }

# 1. recurring kept signature_move + picked hero pattern -> a positive preference; a
#    SHOWN-but-never-PICKED hero pattern is NOT a preference (propensity debiasing).
node --input-type=module -e '
import { buildTasteProfile } from "file://'"$MOD"'";
const mk = (sig, pickedHero) => ({
  signature_move: sig, donors: ["aesop"], faces: ["simula"],
  explore: { shown: [
    { id:"v1", hero_pattern:"asymmetric-left", donor_slug:"aesop" },
    { id:"v2", hero_pattern:"centred-stock", donor_slug:"x" },   // shown every time, never picked
  ], picks: [ { surface:"hero", variant_id: pickedHero } ] },
});
const log = [ mk("carried-timeline","v1"), mk("carried-timeline","v1"), mk("carried-timeline","v1"), mk("split-flip","v1") ];
const p = buildTasteProfile(log, 8);
const sig = p.preferences.signatureMove.find(s => s.value === "carried-timeline");
const heroAsym = p.preferences.heroPattern.find(h => h.value === "asymmetric-left");
const heroStock = p.preferences.heroPattern.find(h => h.value === "centred-stock");
const ok = p.hasSignal &&
  sig && sig.confidence >= 0.5 && sig.seen >= 3 &&         // recurring kept signature move
  heroAsym && heroAsym.confidence >= 0.5 &&                // picked hero pattern is a preference
  !heroStock;                                              // shown-but-never-picked is debiased out
process.exit(ok ? 0 : 1);
'
check "positive preference from recurring KEPT choices; shown-not-picked debiased out" $?

# 2. the diversity guard: exploration budget is always >= 2 (the breadth floor).
node --input-type=module -e '
import { buildTasteProfile } from "file://'"$MOD"'";
const log = Array.from({length:6}, () => ({ signature_move:"x", donors:["a"], faces:["f"] }));
const p = buildTasteProfile(log, 8);
process.exit((p.diversityGuard.explorationBudget >= 2 && p.diversityGuard.explorationBudget <= 8) ? 0 : 1);
'
check "diversity guard: exploration budget in [2..variantCount] (breadth floor holds)" $?

# 3. too little history -> inert (no signal, Explore proceeds neutral).
node --input-type=module -e '
import { buildTasteProfile } from "file://'"$MOD"'";
const p = buildTasteProfile([{ signature_move:"x", donors:["a"], faces:["f"] }], 8); // 1 build < MIN_SEEN
process.exit(p.hasSignal ? 1 : 0);
'
check "too little history -> inert (no house style hardens from one build)" $?

echo ""; echo "taste-profile: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
