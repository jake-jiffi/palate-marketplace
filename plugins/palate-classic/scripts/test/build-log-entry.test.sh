#!/usr/bin/env bash
# Tests hooks/build-log-entry.mjs buildLogEntry() - the W1 explore-label capture.
#
# The done-gate it measures: EVERY Explore variant SHOWN is logged, not just the pick,
# with the surface context (position) that later propensity correction needs. Plus the
# regression guard that the lean diversification fields (business/signature_move/donors/
# faces/ts) survive unchanged, so gate-novelty.mjs's reader is undisturbed, and that a
# build with no Explore (a calm / edit build) stays lean (no explore key).
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
MOD="$DIR/../../hooks/build-log-entry.mjs"
pass=0; fail=0
check() { # desc  exit-code
  local desc="$1" ec="$2"
  if [ "$ec" -eq 0 ]; then echo "ok   - $desc"; pass=$((pass+1));
  else echo "FAIL - $desc"; fail=$((fail+1)); fi
}

# 1. THE DONE-GATE: all variants SHOWN are logged (not just the 2 picks), each carrying
#    surface context, and the pick set is a strict subset of the shown set.
node --input-type=module -e '
import { buildLogEntry } from "file://'"$MOD"'";
const m = {
  business: "Aria Dental", signature_move: "carried-timeline",
  references_surveyed: ["aesop", "leoleo"],
  explore: {
    ran: true,
    shown: [
      { id: "v1", name: "Deep Trawl",   donor_slug: "aesop",            hero_pattern: "centred-display", position: 1 },
      { id: "v2", name: "Morning Paper", donor_slug: "leoleo",           hero_pattern: "split-left",      position: 2 },
      { id: "v3", name: "Low Tide",      donor_slug: "the-modern-house", hero_pattern: "full-bleed",      position: 3 }
    ],
    picks: [ { surface: "hero", variant_id: "v3" }, { surface: "cta", variant_id: "v1" } ],
    edits: [ { surface: "hero", variant_id: "v3", note: "shortened headline" } ]
  }
};
const e = buildLogEntry(m, ["fraunces"]);
const ok =
  Array.isArray(e.explore?.shown) && e.explore.shown.length === 3 &&
  e.explore.shown.every((s) => Number.isFinite(s.position)) &&
  Array.isArray(e.explore.picks) && e.explore.picks.length === 2 &&
  Array.isArray(e.explore.edits) && e.explore.edits.length === 1 &&
  e.explore.shown.length > e.explore.picks.length;
process.exit(ok ? 0 : 1);
'
check "every Explore variant shown is logged with surface context (not just the pick)" $?

# 2. the lean diversification fields survive unchanged (the gate-novelty.mjs contract).
node --input-type=module -e '
import { buildLogEntry } from "file://'"$MOD"'";
const e = buildLogEntry({ business: "X", signature_move: "m", references_surveyed: ["a"] }, ["satoshi"]);
const ok = e.business === "X" && e.signature_move === "m" &&
  JSON.stringify(e.donors) === JSON.stringify(["a"]) &&
  JSON.stringify(e.faces) === JSON.stringify(["satoshi"]) &&
  typeof e.ts === "string";
process.exit(ok ? 0 : 1);
'
check "lean fields (business/signature_move/donors/faces/ts) preserved" $?

# 3. a build with no Explore (calm / edit) logs no explore key - the entry stays lean.
node --input-type=module -e '
import { buildLogEntry } from "file://'"$MOD"'";
const e = buildLogEntry({ business: "X", references_surveyed: [] }, []);
process.exit(("explore" in e) ? 1 : 0);
'
check "no Explore block -> entry omits explore (stays lean)" $?

echo ""
echo "build-log-entry: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
