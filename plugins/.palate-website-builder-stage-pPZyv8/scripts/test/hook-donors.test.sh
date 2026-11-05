#!/usr/bin/env bash
# The taste lineage survives the build.
#
# recordDonors writes .palate/donors.json when a build passes its gates, so RUN SITE
# commands can re-ground on the SAME library references the site's craft came from
# (/post pulls the spine's copy_voice, /page prefers a recorded donor over a stranger).
# Before this existed, every later session searched the library cold: the manifest knew
# the donors and the knowledge never left the build.
#
# Three directions:
#   1. a deep, passing build writes donors.json with the spine from the hero pick
#   2. a BLOCKED build (shallow survey) writes nothing: lineage is recorded at done, not attempt
#   3. no references surveyed writes nothing, never an invented donor
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$DIR/../../hooks/palate-stop.mjs"
DEEP="$DIR/fixtures/manifest-deep.json"
TMP="$(mktemp -d)"; pass=0; fail=0
trap 'rm -rf "$TMP"' EXIT

check() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then echo "ok   - $desc"; pass=$((pass + 1));
  else echo "FAIL - $desc (got '$got', want '$want')"; fail=$((fail + 1)); fi
}

scaffold() { # dir
  mkdir -p "$1/src/pages"
  echo '{"name":"x"}' > "$1/package.json"
  printf -- '---\n---\n<h1>x</h1>\n' > "$1/src/pages/index.astro"
}
run_hook() { # dir
  printf '{"cwd":"%s","stop_hook_active":false}' "$1" | node "$HOOK" >/dev/null 2>&1
}

# 1. deep build, hero picked from v3 whose donor is gitbook -> spine = gitbook
P="$TMP/pass"; scaffold "$P"
node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('$DEEP','utf8'));
m.explore={ran:true,shown:[{id:'v1',donor_slug:'basehub'},{id:'v3',donor_slug:'gitbook'}],
           picks:[{surface:'hero',variant_id:'v3'}]};
fs.writeFileSync('$P/build-manifest.json', JSON.stringify(m));"
run_hook "$P"
check "a passing build writes donors.json" "$([ -f "$P/.palate/donors.json" ] && echo yes || echo no)" "yes"
check "the spine is the hero pick's donor" \
  "$(node -e "console.log(require('$P/.palate/donors.json').spine)" 2>/dev/null)" "gitbook"
check "the full survey travels with it" \
  "$(node -e "console.log(require('$P/.palate/donors.json').donors.length)" 2>/dev/null)" \
  "$(node -e "console.log(require('$DEEP').references_surveyed.length)")"

# 2. a blocked build (one reference, under the depth floor) records no lineage
B="$TMP/blocked"; scaffold "$B"
echo '{"schema":3,"references_surveyed":["basehub"],"mcp_calls":[{"tool":"refs_get"}]}' > "$B/build-manifest.json"
run_hook "$B"
check "a blocked build writes no lineage" "$([ -f "$B/.palate/donors.json" ] && echo yes || echo no)" "no"

# 3. nothing surveyed, nothing invented
N="$TMP/none"; scaffold "$N"
node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('$DEEP','utf8'));
m.references_surveyed=[];
fs.writeFileSync('$N/build-manifest.json', JSON.stringify(m));"
run_hook "$N"
check "no survey means no invented donors" "$([ -f "$N/.palate/donors.json" ] && echo yes || echo no)" "no"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
