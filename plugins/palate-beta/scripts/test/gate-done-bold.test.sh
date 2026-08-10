#!/usr/bin/env bash
# Tests the v1.5 BOLD BAR in scripts/gate-done.sh: the high-intensity-scoped blinded-pairwise,
# ambition dock-list, built-Explore, and iteration-cap-escalation gates. Cardinal rule under
# test: every bold gate is fail-open and binds ONLY when commission.intensity == "high", so a
# calm build (and a public-plugin user) is NEVER held to it. Self-contained: reuses
# fixtures/manifest-deep.json (passes the depth floor) + throwaway tmp dirs, no external build.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-done.sh"
DEEP="$DIR/fixtures/manifest-deep.json"
pass=0; fail=0

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

make_shots() { # <proj-dir>
  local proj="$1"
  mkdir -p "$proj/.palate-shots"
  printf '\x89PNG\r\n\x1a\n' > "$proj/.palate-shots/desktop-full.png"
  printf '\x89PNG\r\n\x1a\n' > "$proj/.palate-shots/mobile-full.png"
  echo '{"status":"captured","console_errors":0}' > "$proj/.palate-shots/manifest.json"
  echo '[]' > "$proj/.palate-shots/errors.json"
}

# A verify-report that PASSES the base visual + verdict checks; bold fields are added per scenario.
base_report() { cat <<'JSON'
{ "verdict": "pass",
  "visual": { "ran": true, "pass": true, "console_errors": 0,
    "iterations": [ { "i": 1, "axes": { "philosophy": 5, "hierarchy": 4, "execution": 4, "specificity": 4, "restraint": 4, "variety": 4 }, "score": 25,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png" } } ] },
  "shots_dir": ".palate-shots" }
JSON
}

# scen <name> <expected-exit> <manifest-jq> <report-jq> <substr|""> [env...]
scen() {
  local name="$1" want="$2" mjq="$3" rjq="$4" substr="$5"; shift 5
  local proj; proj="$TMP/$(echo "$name" | tr ' /+' '___')"; mkdir -p "$proj"
  jq "$mjq" "$DEEP" > "$proj/build-manifest.json"
  base_report | jq "$rjq" > "$proj/verify-report.json"
  make_shots "$proj"
  local out ec; out=$(env "$@" bash "$GATE" "$proj/build-manifest.json" 2>&1); ec=$?
  local ok=1
  [ "$ec" -eq "$want" ] || ok=0
  if [ -n "$substr" ]; then echo "$out" | grep -qiF "$substr" || ok=0; fi
  if [ "$ok" = 1 ]; then echo "ok   - $name"; pass=$((pass+1));
  else echo "FAIL - $name (exit $ec want $want${substr:+; want substr '$substr'})"; echo "       $(echo "$out" | tail -1)"; fail=$((fail+1)); fi
}

# calm baseline: no commission -> the bold bar never runs (backward-compat).
scen "calm baseline -> pass" 0 '.' '.' ""
# the HEADLINE: a high-intensity brief that collapsed Explore (variants:[]) is now CAUGHT.
scen "high + variants:0 -> block (explore collapsed)" 2 '.commission.intensity="high" | .variants=[]' '.' "Explore collapsed"
# explore_skip recorded (named-direction escape) -> the explore check is bypassed.
scen "high + explore_skip -> pass (fail-open on absent pairwise)" 0 '.commission.intensity="high" | .commission.explore_skip=true' '.' "UNPROVEN"
# the blinded pairwise: a LOSS blocks.
scen "high + pairwise lost -> block" 2 '.commission.intensity="high"' '.pairwise={ran:true,won:false,against:"gymbox"}' "LOST the blinded pairwise" PALATE_GATE_EXPLORE=0
# the ambition dock-list: not cleared and a gap is not human-accepted -> block.
scen "high + ambition uncleared -> block" 2 '.commission.intensity="high"' '.pairwise={ran:true,won:true} | .ambition={clears:false,dock_list:[{gap:"x",human_accepted:false}]}' "ambition bar is NOT cleared" PALATE_GATE_EXPLORE=0
# all bold gates satisfied -> pass.
scen "high + won + cleared -> pass" 0 '.commission.intensity="high"' '.pairwise={ran:true,won:true} | .ambition={clears:true,dock_list:[]}' "bold-bar=enforced" PALATE_GATE_EXPLORE=0
# CARDINAL: high but the verifier emitted no pairwise/ambition -> fail-open (reminder, NOT a trap).
scen "high + absent evidence -> pass (fail-open)" 0 '.commission.intensity="high"' 'del(.pairwise,.ambition)' "UNPROVEN" PALATE_GATE_EXPLORE=0
# human-accept override: an uncleared but explicitly accepted gap -> pass.
scen "high + human-accepted gap -> pass" 0 '.commission.intensity="high"' '.pairwise={ran:true,won:true} | .ambition={clears:false,dock_list:[{gap:"x",human_accepted:true}]}' "Done gate passed" PALATE_GATE_EXPLORE=0
# item 7: at the iteration cap with the bar unmet -> ESCALATE (not loop, not accept).
scen "high + lost + cap(3) -> escalate" 2 '.commission.intensity="high"' '.pairwise={ran:true,won:false,against:"gymbox"} | .visual.iterations=[{i:1},{i:2},{i:3}]' "ESCALATE" PALATE_GATE_EXPLORE=0
# escape hatch: PALATE_GATE_BOLD=0 disables the whole bold bar.
scen "high + lost but BOLD=0 -> pass" 0 '.commission.intensity="high"' '.pairwise={ran:true,won:false}' "Done gate passed" PALATE_GATE_BOLD=0
# CARDINAL: a calm build is never bound, even with a lost pairwise + variants:[] present.
scen "calm + lost pairwise + variants:0 -> pass (not bound)" 0 '.commission.intensity="calm" | .variants=[]' '.pairwise={ran:true,won:false}' "Done gate passed"
# heal BOLD-1/BOLD-2: a non-numeric numeric-env-var must NOT wrongly block or spew `[:` errors.
scen "high + garbage MIN_VARIANTS -> pass (env sanitised)" 0 '.commission.intensity="high" | .variants=[{},{}]' '.pairwise={ran:true,won:true} | .ambition={clears:true,dock_list:[]}' "Done gate passed" PALATE_MIN_VARIANTS=xyz
scen "high + garbage ITER_CAP -> pass (env sanitised)" 0 '.commission.intensity="high"' '.pairwise={ran:true,won:true} | .ambition={clears:true,dock_list:[]}' "Done gate passed" PALATE_ITER_CAP=abc PALATE_GATE_EXPLORE=0

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
