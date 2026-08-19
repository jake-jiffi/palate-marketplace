#!/usr/bin/env bash
# Tests the PreToolUse DIVERGE wall (hooks/palate-pretooluse.mjs).
#
# The wall is DEFAULT-ON for an active build site (a .palate-skill-state.json marker is
# present) and blocks the first NEW page/section source Write until build-manifest.json
# records a VALID diverge+converge. It must NEVER trap a non-build session: no marker,
# Edit, a non-source write, write-over-existing config, or PALATE_GATE_OFF=1 all pass.
#
# The hook emits its decision as JSON on stdout: a deny prints
# permissionDecision":"deny"; an allow exits 0 and prints nothing. We detect a block by
# grepping stdout for "deny".
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$DIR/../../hooks/palate-pretooluse.mjs"
pass=0; fail=0

# run <cwd> <tool> <file_path> [env...] ; echoes "DENY" or "ALLOW"
run() {
  local cwd="$1" tool="$2" fp="$3"; shift 3
  local payload
  payload=$(printf '{"tool_name":"%s","cwd":"%s","tool_input":{"file_path":"%s"}}' "$tool" "$cwd" "$fp")
  local out
  out=$(printf '%s' "$payload" | env "$@" node "$HOOK" 2>/dev/null)
  if printf '%s' "$out" | grep -q '"deny"'; then echo "DENY"; else echo "ALLOW"; fi
}

want() { # desc want got
  if [ "$2" = "$3" ]; then echo "ok   - $1"; pass=$((pass+1));
  else echo "FAIL - $1 (got $3, want $2)"; fail=$((fail+1)); fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MARKER='{"schemaVersion":"1.1","stage":"preview"}'

# A manifest with a VALID brand-CREATION diverge+converge (>=8 distinct concepts, spread,
# low tail, colour + type in axes_varied, >=3 distinct colourways AND type directions).
# This is the back-compat fixture: a marker with NO brandMode defaults to brand-creation,
# so this must pass that default.
write_valid_manifest() { # <dir>
  cat > "$1/build-manifest.json" <<'JSON'
{ "schema":3,
  "diverge": { "ran":true, "n":8, "mode":"brand-creation",
    "axes_varied":["colour","type","mood","layout","motion"],
    "concepts": [
    {"id":"c1","mechanic":"flood","lens":"worst-moment","analogical_seed":"tide chart","conventionality":0.1,"colourway":"ink + bone + signal-red","type":"grotesk display + serif body"},
    {"id":"c2","mechanic":"tap","lens":"founder-obsession","analogical_seed":"signage","conventionality":0.25,"colourway":"forest + cream","type":"slab display + grotesk body"},
    {"id":"c3","mechanic":"scroll","lens":"physical-object","analogical_seed":"architecture","conventionality":0.4,"colourway":"cobalt + chalk + amber","type":"humanist serif + mono caption"},
    {"id":"c4","mechanic":"reveal","lens":"after-feeling","analogical_seed":"film","conventionality":0.5,"colourway":"ink + bone + signal-red","type":"grotesk display + serif body"},
    {"id":"c5","mechanic":"index","lens":"category-refuses","analogical_seed":"map","conventionality":0.6,"colourway":"forest + cream","type":"slab display + grotesk body"},
    {"id":"c6","mechanic":"timeline","lens":"worst-moment","analogical_seed":"relay baton","conventionality":0.7,"colourway":"cobalt + chalk + amber","type":"humanist serif + mono caption"},
    {"id":"c7","mechanic":"press","lens":"founder-obsession","analogical_seed":"instrument","conventionality":0.8,"colourway":"ink + bone + signal-red","type":"grotesk display + serif body"},
    {"id":"c8","mechanic":"crowd","lens":"physical-object","analogical_seed":"games","conventionality":0.55,"colourway":"forest + cream","type":"slab display + grotesk body"} ] },
  "converge": { "ran":true, "advanced":["c1","c2"] } }
JSON
}

# === 1. ACTIVE BUILD SITE, no diverge yet, NEW page source -> DENY ===========
B="$TMP/build1"; mkdir -p "$B"; echo "$MARKER" > "$B/.palate-skill-state.json"
want "build site, no diverge, new src/pages write -> deny" DENY \
  "$(run "$B" Write "$B/src/pages/index.astro")"

# === 2. ACTIVE BUILD SITE, VALID diverge recorded, NEW page source -> ALLOW ==
B2="$TMP/build2"; mkdir -p "$B2"; echo "$MARKER" > "$B2/.palate-skill-state.json"
write_valid_manifest "$B2"
want "build site, valid diverge, new page write -> allow" ALLOW \
  "$(run "$B2" Write "$B2/src/components/Hero.astro")"

# === 3. NON-BUILD (no marker), NEW page source -> ALLOW (fail-open scope wall) =
N="$TMP/nobuild"; mkdir -p "$N"
want "no marker (not a build), new page write -> allow" ALLOW \
  "$(run "$N" Write "$N/src/pages/index.astro")"

# === 4. ACTIVE BUILD SITE, no diverge, but EDIT (not Write) -> ALLOW =========
# Edit is never matched by the hook's tool filter.
want "build site, no diverge, Edit -> allow" ALLOW \
  "$(run "$B" Edit "$B/src/pages/index.astro")"

# === 5. ACTIVE BUILD SITE, no diverge, NON-SOURCE write (.json) -> ALLOW =====
# The manifest itself is .json, so the model can always write its diverge block.
want "build site, no diverge, .json (manifest) write -> allow" ALLOW \
  "$(run "$B" Write "$B/build-manifest.json")"

# === 6. ACTIVE BUILD SITE, no diverge, CONFIG write (astro.config.mjs) -> ALLOW
want "build site, no diverge, config write -> allow" ALLOW \
  "$(run "$B" Write "$B/astro.config.mjs")"

# === 7. ACTIVE BUILD SITE, no diverge, PALATE_GATE_OFF=1 -> ALLOW ============
want "build site, no diverge, PALATE_GATE_OFF=1 -> allow" ALLOW \
  "$(run "$B" Write "$B/src/pages/index.astro" PALATE_GATE_OFF=1)"

# === 8. ACTIVE BUILD SITE, no diverge, write-over-EXISTING non page/section file -> ALLOW
# A lib file that already exists on disk = scaffold iteration, allowed.
B8="$TMP/build8"; mkdir -p "$B8/src/lib"; echo "$MARKER" > "$B8/.palate-skill-state.json"
echo "export const x = 1;" > "$B8/src/lib/util.ts"
want "build site, no diverge, write-over-existing lib file -> allow" ALLOW \
  "$(run "$B8" Write "$B8/src/lib/util.ts")"

# === 9. ACTIVE BUILD SITE, no diverge, write-over-EXISTING page/section stub -> DENY
# Overwriting a template's src/pages stub before diverging is the loophole we close.
B9="$TMP/build9"; mkdir -p "$B9/src/pages"; echo "$MARKER" > "$B9/.palate-skill-state.json"
echo "<h1>stub</h1>" > "$B9/src/pages/index.astro"
want "build site, no diverge, overwrite existing page stub -> deny" DENY \
  "$(run "$B9" Write "$B9/src/pages/index.astro")"

# === 10. ACTIVE BUILD SITE, THIN diverge (only 3 concepts) -> DENY ===========
B10="$TMP/build10"; mkdir -p "$B10"; echo "$MARKER" > "$B10/.palate-skill-state.json"
cat > "$B10/build-manifest.json" <<'JSON'
{ "schema":3,
  "diverge": { "ran":true, "n":3, "concepts": [
    {"id":"c1","lens":"a","analogical_seed":"x","conventionality":0.1},
    {"id":"c2","lens":"b","analogical_seed":"y","conventionality":0.5},
    {"id":"c3","lens":"c","analogical_seed":"z","conventionality":0.9} ] },
  "converge": { "ran":true, "advanced":["c1"] } }
JSON
want "build site, thin diverge (<8) -> deny" DENY \
  "$(run "$B10" Write "$B10/src/pages/index.astro")"

# === 11. ACTIVE BUILD SITE, 8 CLONED concepts (no spread, ran:true) -> DENY ==
# Anti-gaming: 8 identical-signature concepts all at the mode must not pass.
B11="$TMP/build11"; mkdir -p "$B11"; echo "$MARKER" > "$B11/.palate-skill-state.json"
cat > "$B11/build-manifest.json" <<'JSON'
{ "schema":3,
  "diverge": { "ran":true, "n":8, "concepts": [
    {"id":"c1","lens":"same","analogical_seed":"same","conventionality":0.7},
    {"id":"c2","lens":"same","analogical_seed":"same","conventionality":0.7},
    {"id":"c3","lens":"same","analogical_seed":"same","conventionality":0.7},
    {"id":"c4","lens":"same","analogical_seed":"same","conventionality":0.7},
    {"id":"c5","lens":"same","analogical_seed":"same","conventionality":0.7},
    {"id":"c6","lens":"same","analogical_seed":"same","conventionality":0.7},
    {"id":"c7","lens":"same","analogical_seed":"same","conventionality":0.7},
    {"id":"c8","lens":"same","analogical_seed":"same","conventionality":0.7} ] },
  "converge": { "ran":true, "advanced":["c1"] } }
JSON
want "build site, 8 cloned concepts (no spread) -> deny" DENY \
  "$(run "$B11" Write "$B11/src/pages/index.astro")"

# Markers carrying an explicit brandMode (the new mode-aware cases below).
MARKER_CREATION='{"schemaVersion":"1.2","stage":"preview","brandMode":"brand-creation"}'
MARKER_PROVIDED='{"schemaVersion":"1.2","stage":"preview","brandMode":"brand-provided"}'

# === 12. brand-creation marker + diverge that varies ONLY layout (no colour/type) -> DENY
# 8 concepts with a spread + tail but axes_varied has no colour/type and one colourway/type.
B12="$TMP/build12"; mkdir -p "$B12"; echo "$MARKER_CREATION" > "$B12/.palate-skill-state.json"
cat > "$B12/build-manifest.json" <<'JSON'
{ "schema":3,
  "diverge": { "ran":true, "n":8, "mode":"brand-creation",
    "axes_varied":["layout","motion"],
    "concepts": [
    {"id":"c1","lens":"a","analogical_seed":"p","conventionality":0.1,"colourway":"ink + bone","type":"grotesk + serif","layout":"split"},
    {"id":"c2","lens":"b","analogical_seed":"q","conventionality":0.2,"colourway":"ink + bone","type":"grotesk + serif","layout":"stack"},
    {"id":"c3","lens":"c","analogical_seed":"r","conventionality":0.3,"colourway":"ink + bone","type":"grotesk + serif","layout":"grid"},
    {"id":"c4","lens":"d","analogical_seed":"s","conventionality":0.4,"colourway":"ink + bone","type":"grotesk + serif","layout":"rail"},
    {"id":"c5","lens":"e","analogical_seed":"t","conventionality":0.5,"colourway":"ink + bone","type":"grotesk + serif","layout":"canvas"},
    {"id":"c6","lens":"f","analogical_seed":"u","conventionality":0.6,"colourway":"ink + bone","type":"grotesk + serif","layout":"index"},
    {"id":"c7","lens":"g","analogical_seed":"v","conventionality":0.7,"colourway":"ink + bone","type":"grotesk + serif","layout":"poster"},
    {"id":"c8","lens":"h","analogical_seed":"w","conventionality":0.8,"colourway":"ink + bone","type":"grotesk + serif","layout":"feed"} ] },
  "converge": { "ran":true, "advanced":["c1"] } }
JSON
want "brand-creation, varies only layout (no colour/type) -> deny" DENY \
  "$(run "$B12" Write "$B12/src/pages/index.astro")"

# === 13. brand-creation marker + colour+type varied (>=3 each) + spread + tail + >=6 sigs -> ALLOW
B13="$TMP/build13"; mkdir -p "$B13"; echo "$MARKER_CREATION" > "$B13/.palate-skill-state.json"
write_valid_manifest "$B13"
want "brand-creation, colour+type varied (>=3 each) -> allow" ALLOW \
  "$(run "$B13" Write "$B13/src/pages/index.astro")"

# === 14. brand-provided marker + diverge that VARIES colour/type (colour in axes_varied) -> DENY
# Brand drift: declaring colour in axes_varied under brand-provided is a fail.
B14="$TMP/build14"; mkdir -p "$B14"; echo "$MARKER_PROVIDED" > "$B14/.palate-skill-state.json"
cat > "$B14/build-manifest.json" <<'JSON'
{ "schema":3,
  "diverge": { "ran":true, "n":8, "mode":"brand-provided",
    "axes_varied":["colour","layout","motion"],
    "locked": { "colour": false, "type": false },
    "concepts": [
    {"id":"c1","lens":"a","analogical_seed":"p","conventionality":0.1,"colourway":"navy","layout":"split","motion":"rise"},
    {"id":"c2","lens":"b","analogical_seed":"q","conventionality":0.2,"colourway":"gold","layout":"stack","motion":"fade"},
    {"id":"c3","lens":"c","analogical_seed":"r","conventionality":0.3,"colourway":"navy","layout":"grid","motion":"slide"},
    {"id":"c4","lens":"d","analogical_seed":"s","conventionality":0.4,"colourway":"gold","layout":"rail","motion":"pin"},
    {"id":"c5","lens":"e","analogical_seed":"t","conventionality":0.5,"colourway":"navy","layout":"canvas","motion":"draw"},
    {"id":"c6","lens":"f","analogical_seed":"u","conventionality":0.6,"colourway":"gold","layout":"index","motion":"tilt"},
    {"id":"c7","lens":"g","analogical_seed":"v","conventionality":0.7,"colourway":"navy","layout":"poster","motion":"wipe"},
    {"id":"c8","lens":"h","analogical_seed":"w","conventionality":0.8,"colourway":"gold","layout":"feed","motion":"snap"} ] },
  "converge": { "ran":true, "advanced":["c1"] } }
JSON
want "brand-provided, colour in axes_varied (brand drift) -> deny" DENY \
  "$(run "$B14" Write "$B14/src/pages/index.astro")"

# === 15. brand-provided marker + colour/type LOCKED, >=6 distinct layout/motion skins -> ALLOW
B15="$TMP/build15"; mkdir -p "$B15"; echo "$MARKER_PROVIDED" > "$B15/.palate-skill-state.json"
cat > "$B15/build-manifest.json" <<'JSON'
{ "schema":3,
  "diverge": { "ran":true, "n":8, "mode":"brand-provided",
    "axes_varied":["layout","motion","density"],
    "locked": { "colour": true, "type": true, "palette_source": "@palate/brand@2.1.0", "faces": ["soehne","tiempos"] },
    "concepts": [
    {"id":"c1","lens":"a","analogical_seed":"p","conventionality":0.1,"colourway":"brand","type":"brand","layout":"split","motion":"rise"},
    {"id":"c2","lens":"b","analogical_seed":"q","conventionality":0.2,"colourway":"brand","type":"brand","layout":"stack","motion":"fade"},
    {"id":"c3","lens":"c","analogical_seed":"r","conventionality":0.3,"colourway":"brand","type":"brand","layout":"grid","motion":"slide"},
    {"id":"c4","lens":"d","analogical_seed":"s","conventionality":0.4,"colourway":"brand","type":"brand","layout":"rail","motion":"pin"},
    {"id":"c5","lens":"e","analogical_seed":"t","conventionality":0.5,"colourway":"brand","type":"brand","layout":"canvas","motion":"draw"},
    {"id":"c6","lens":"f","analogical_seed":"u","conventionality":0.6,"colourway":"brand","type":"brand","layout":"index","motion":"tilt"},
    {"id":"c7","lens":"g","analogical_seed":"v","conventionality":0.7,"colourway":"brand","type":"brand","layout":"poster","motion":"wipe"},
    {"id":"c8","lens":"h","analogical_seed":"w","conventionality":0.8,"colourway":"brand","type":"brand","layout":"feed","motion":"snap"} ] },
  "converge": { "ran":true, "advanced":["c1"] } }
JSON
want "brand-provided, locked colour/type + >=6 skins -> allow" ALLOW \
  "$(run "$B15" Write "$B15/src/pages/index.astro")"

# === 16. marker says brand-provided but manifest.diverge.mode says brand-creation -> DENY
# Mode mismatch (anti-tamper). Reuse the valid creation manifest under a provided marker.
B16="$TMP/build16"; mkdir -p "$B16"; echo "$MARKER_PROVIDED" > "$B16/.palate-skill-state.json"
write_valid_manifest "$B16"   # this manifest declares mode:"brand-creation"
want "mode mismatch (marker provided, manifest creation) -> deny" DENY \
  "$(run "$B16" Write "$B16/src/pages/index.astro")"

# === 17. marker with NO brandMode (legacy) + a brand-creation-valid manifest -> ALLOW
# Back-compat: the default-brand-creation path accepts the valid creation manifest.
B17="$TMP/build17"; mkdir -p "$B17"; echo "$MARKER" > "$B17/.palate-skill-state.json"  # legacy MARKER, no brandMode
write_valid_manifest "$B17"
want "legacy marker (no brandMode) + valid creation manifest -> allow" ALLOW \
  "$(run "$B17" Write "$B17/src/pages/index.astro")"

# ===================================================================================
# THE SURVEY WALL (18-24). DIVERGE being valid used to be the whole bar on a build site,
# so a build could write every line of code having barely touched the library. It now
# also has to clear the depth gate, but ONLY once the MCP has proven it answers.
# ===================================================================================

# Add MCP telemetry to an existing valid manifest. <dir> <jq-expr>
add_calls() { local d="$1" expr="$2"; local t; t=$(mktemp)
  jq "$expr" "$d/build-manifest.json" > "$t" && mv "$t" "$d/build-manifest.json"; }

# The pelvy shape, exactly: one catalogue listing and two hero screenshots. Enough to prove
# the MCP answers, nowhere near enough to have read anything.
SHALLOW='.mcp_calls=[
  {"tool":"mcp__palate__refs_list_verticals","args":{},"slugs":[],"evidence":"content"},
  {"tool":"mcp__palate__refs_get_screenshot","args":{"slug":"therapy-in-london","viewport":"desktop"},"slugs":["therapy-in-london"],"evidence":"content"},
  {"tool":"mcp__palate__refs_get_screenshot","args":{"slug":"august-health-ehr","viewport":"desktop"},"slugs":["august-health-ehr"],"evidence":"content"}
] | .references_surveyed=["therapy-in-london","august-health-ehr"] | .inner_pages_viewed=[] | .layers_read=[]'

# A real survey: 5 references, 3 distinct tools, a deep read that pulled a craft layer, and
# two inner pages.
DEEP='.mcp_calls=[
  {"tool":"mcp__palate__refs_search","args":{"query":"pelvic health clinic"},"slugs":["a","b","c","d","e"],"evidence":"content"},
  {"tool":"mcp__palate__refs_get","args":{"slug":"a","layer":["do_dont","component_prompts"]},"slugs":["a"],"evidence":"content"},
  {"tool":"mcp__palate__refs_get_screenshot","args":{"slug":"a","page":"pricing"},"slugs":["a"],"evidence":"content"},
  {"tool":"mcp__palate__refs_get_screenshot","args":{"slug":"b","page":"booking"},"slugs":["b"],"evidence":"content"}
] | .references_surveyed=["a","b","c","d","e"]
  | .inner_pages_viewed=[{"slug":"a","page":"pricing"},{"slug":"b","page":"booking"}]
  | .layers_read=["do_dont","component_prompts"]'

# === 18. valid diverge, ZERO Palate calls -> ALLOW. The tokenless user is never trapped,
# and this is the invariant the whole wall is keyed on.
S18="$TMP/survey18"; mkdir -p "$S18"; echo "$MARKER" > "$S18/.palate-skill-state.json"
write_valid_manifest "$S18"
want "no Palate calls at all (no token) -> allow" ALLOW "$(run "$S18" Write "$S18/src/pages/index.astro")"

# === 19. THE PELVY CASE: valid diverge, MCP proven reachable, survey nowhere near depth.
S19="$TMP/survey19"; mkdir -p "$S19"; echo "$MARKER" > "$S19/.palate-skill-state.json"
write_valid_manifest "$S19"; add_calls "$S19" "$SHALLOW"
want "MCP answered but the survey is 3 shallow calls -> DENY" DENY "$(run "$S19" Write "$S19/src/pages/index.astro")"

# === 20. the same build once it has actually surveyed -> ALLOW.
S20="$TMP/survey20"; mkdir -p "$S20"; echo "$MARKER" > "$S20/.palate-skill-state.json"
write_valid_manifest "$S20"; add_calls "$S20" "$DEEP"
want "a real survey (5 refs, 2 inner pages, craft layer) -> allow" ALLOW "$(run "$S20" Write "$S20/src/pages/index.astro")"

# === 21/22. both escape hatches release it.
want "shallow survey + PALATE_GATE_SURVEY=0 -> allow" ALLOW \
  "$(run "$S19" Write "$S19/src/pages/index.astro" PALATE_GATE_SURVEY=0)"
want "shallow survey + PALATE_GATE_OFF=1 -> allow" ALLOW \
  "$(run "$S19" Write "$S19/src/pages/index.astro" PALATE_GATE_OFF=1)"

# === 23. a DEGRADING connection must not become a trap: more refusals than answers means
# the agent cannot satisfy any depth bar however hard it tries.
S23="$TMP/survey23"; mkdir -p "$S23"; echo "$MARKER" > "$S23/.palate-skill-state.json"
write_valid_manifest "$S23"; add_calls "$S23" "$SHALLOW"
add_calls "$S23" '.mcp_failures=[{"tool":"mcp__palate__refs_search"},{"tool":"mcp__palate__refs_get"},{"tool":"mcp__palate__refs_get"},{"tool":"mcp__palate__refs_search"}]'
want "refusals outnumber answers (degraded MCP) -> allow" ALLOW "$(run "$S23" Write "$S23/src/pages/index.astro")"

# === 24. NOT a build site: the wall must not reach a session that never started one.
S24="$TMP/survey24"; mkdir -p "$S24"
write_valid_manifest "$S24"; add_calls "$S24" "$SHALLOW"   # no marker written
want "no build-site marker + shallow survey -> allow" ALLOW "$(run "$S24" Write "$S24/src/pages/index.astro")"

# ===================================================================================
# THE ORCHESTRATION GUARD (25-29). A Palate build driven by the Workflow tool hands the
# creative work to agents that never load the doctrine. Measured on two real builds from
# the same prompt: Wildlings ran zero workflows and wrote its variants in-session (28
# Palate calls, delighted client); Pelvy ran ten including one for Explore and wrote zero
# variants in-session (3 Palate calls, a day lost).
# ===================================================================================

# runw <cwd> [env...] -> DENY or ALLOW, for a Workflow call (which carries no file_path)
runw() {
  local cwd="$1"; shift
  local out
  # The payload is built with jq, not printf. A hand-escaped script value produced INVALID
  # JSON, the hook read nothing, allowed, and the assertion failed while the guard was working
  # perfectly. The harness lied, not the code.
  out=$(jq -cn --arg cwd "$cwd" '{tool_name:"Workflow",cwd:$cwd,tool_input:{script:"export const meta={name:1}"}}' \
    | env "$@" node "$HOOK" 2>/dev/null)
  if printf '%s' "$out" | grep -q '"deny"'; then echo "DENY"; else echo "ALLOW"; fi
}

O1="$TMP/orch-build"; mkdir -p "$O1"; echo "$MARKER" > "$O1/.palate-skill-state.json"
want "Workflow on an active build site -> deny" DENY "$(runw "$O1")"
want "Workflow + PALATE_ALLOW_WORKFLOW=1 -> allow" ALLOW "$(runw "$O1" PALATE_ALLOW_WORKFLOW=1)"
want "Workflow + PALATE_GATE_OFF=1 -> allow" ALLOW "$(runw "$O1" PALATE_GATE_OFF=1)"

O2="$TMP/orch-nonbuild"; mkdir -p "$O2"   # no marker: not a Palate build
want "Workflow with no build-site marker -> allow" ALLOW "$(runw "$O2")"

# The guard must not have broken the ordinary write path it shares a hook with.
O3="$TMP/orch-write"; mkdir -p "$O3"
want "a plain source write with no marker still passes" ALLOW "$(run "$O3" Write "$O3/src/pages/index.astro")"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
