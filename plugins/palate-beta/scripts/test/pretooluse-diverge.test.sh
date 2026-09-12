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
  "plan_checkpoint": { "shown_at":"2026-09-11T04:00:00Z", "shown": { "pages":["/","/services","/contact"], "brand_source":"vendored", "references":["a","b"], "industry":"trades", "host":"vercel", "stage":"preview", "cms":false, "explore": { "mode":"ladder", "count":5 }, "intake": { "calibration": { "position":2, "why":"the second one, the first is too quiet for us" }, "admired":["https://northwind.example"], "disliked":["https://cheapquotes.example"], "primary_action":"call", "wow":"a postcode answers on the spot", "avoid":["no purple","no stock people photos","no sliders"] } }, "go": { "given":true, "how":"asked", "quote":"go ahead" } },
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
  "plan_checkpoint": { "shown_at":"2026-09-11T04:00:00Z", "shown": { "pages":["/","/services","/contact"], "brand_source":"vendored", "references":["a","b"], "industry":"trades", "host":"vercel", "stage":"preview", "cms":false, "explore": { "mode":"ladder", "count":5 }, "intake": { "calibration": { "position":2, "why":"the second one, the first is too quiet for us" }, "admired":["https://northwind.example"], "disliked":["https://cheapquotes.example"], "primary_action":"call", "wow":"a postcode answers on the spot", "avoid":["no purple","no stock people photos","no sliders"] } }, "go": { "given":true, "how":"asked", "quote":"go ahead" } },
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
  "plan_checkpoint": { "shown_at":"2026-09-11T04:00:00Z", "shown": { "pages":["/","/services","/contact"], "brand_source":"vendored", "references":["a","b"], "industry":"trades", "host":"vercel", "stage":"preview", "cms":false, "explore": { "mode":"ladder", "count":5 }, "intake": { "calibration": { "position":2, "why":"the second one, the first is too quiet for us" }, "admired":["https://northwind.example"], "disliked":["https://cheapquotes.example"], "primary_action":"call", "wow":"a postcode answers on the spot", "avoid":["no purple","no stock people photos","no sliders"] } }, "go": { "given":true, "how":"asked", "quote":"go ahead" } },
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
  "plan_checkpoint": { "shown_at":"2026-09-11T04:00:00Z", "shown": { "pages":["/","/services","/contact"], "brand_source":"vendored", "references":["a","b"], "industry":"trades", "host":"vercel", "stage":"preview", "cms":false, "explore": { "mode":"ladder", "count":5 }, "intake": { "calibration": { "position":2, "why":"the second one, the first is too quiet for us" }, "admired":["https://northwind.example"], "disliked":["https://cheapquotes.example"], "primary_action":"call", "wow":"a postcode answers on the spot", "avoid":["no purple","no stock people photos","no sliders"] } }, "go": { "given":true, "how":"asked", "quote":"go ahead" } },
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
  "plan_checkpoint": { "shown_at":"2026-09-11T04:00:00Z", "shown": { "pages":["/","/services","/contact"], "brand_source":"vendored", "references":["a","b"], "industry":"trades", "host":"vercel", "stage":"preview", "cms":false, "explore": { "mode":"ladder", "count":5 }, "intake": { "calibration": { "position":2, "why":"the second one, the first is too quiet for us" }, "admired":["https://northwind.example"], "disliked":["https://cheapquotes.example"], "primary_action":"call", "wow":"a postcode answers on the spot", "avoid":["no purple","no stock people photos","no sliders"] } }, "go": { "given":true, "how":"asked", "quote":"go ahead" } },
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
  "plan_checkpoint": { "shown_at":"2026-09-11T04:00:00Z", "shown": { "pages":["/","/services","/contact"], "brand_source":"vendored", "references":["a","b"], "industry":"trades", "host":"vercel", "stage":"preview", "cms":false, "explore": { "mode":"ladder", "count":5 }, "intake": { "calibration": { "position":2, "why":"the second one, the first is too quiet for us" }, "admired":["https://northwind.example"], "disliked":["https://cheapquotes.example"], "primary_action":"call", "wow":"a postcode answers on the spot", "avoid":["no purple","no stock people photos","no sliders"] } }, "go": { "given":true, "how":"asked", "quote":"go ahead" } },
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
  local script="${SCRIPT:-export const meta={name:\"x\",description:\"y\"}}"
  out=$(jq -cn --arg cwd "$cwd" --arg s "$script" '{tool_name:"Workflow",cwd:$cwd,tool_input:{script:$s}}' \
    | env "$@" node "$HOOK" 2>/dev/null)
  if printf '%s' "$out" | grep -q '"deny"'; then echo "DENY"; else echo "ALLOW"; fi
}

O1="$TMP/orch-build"; mkdir -p "$O1"; echo "$MARKER" > "$O1/.palate-skill-state.json"
want "Workflow on an active build site -> deny" DENY "$(runw "$O1")"
want "Workflow + PALATE_ALLOW_WORKFLOW=1 -> allow" ALLOW "$(runw "$O1" PALATE_ALLOW_WORKFLOW=1)"
want "Workflow + PALATE_GATE_OFF=1 -> allow" ALLOW "$(runw "$O1" PALATE_GATE_OFF=1)"

O2="$TMP/orch-nonbuild"; mkdir -p "$O2"   # no marker: not a Palate build
want "Workflow with no build-site marker -> allow" ALLOW "$(runw "$O2")"

# CREATIVE vs MECHANICAL, tested against the REAL workflow names from the build that failed.
# A blanket deny would have been wrong: the agent cannot set PALATE_ALLOW_WORKFLOW itself (the
# env var belongs to the Claude Code process), so under an orchestration-first mode it would be
# unable to comply with either instruction. Gathering in parallel is fine and stays allowed.
wf() { SCRIPT="$2" runw "$1"; }
for name in pelvy-explore pelvy-ladder-judging pelvy-signup-redesign pelvy-life-pass pelvy-content-layer; do
  want "real workflow \"$name\" (design work) -> deny" DENY \
    "$(wf "$O1" "export const meta={name:\"$name\",description:\"build the variants\"}")"
done
want "a workflow that writes .astro -> deny" DENY \
  "$(wf "$O1" 'agent("write src/pages/v3.astro")')"
want "an UNLABELLED workflow -> deny (fails closed)" DENY \
  "$(wf "$O1" 'export const meta={name:"do-a-thing",description:"do a thing"}')"

want "pelvy-harvest (gathering) -> allow" ALLOW \
  "$(wf "$O1" 'export const meta={name:"pelvy-harvest",description:"crawl the live site and harvest content"}')"
want "measuring every image -> allow" ALLOW \
  "$(wf "$O1" 'export const meta={name:"assets",description:"measure every image dimension via range requests"}')"
want "competitor research -> allow" ALLOW \
  "$(wf "$O1" 'export const meta={name:"research",description:"research competitors and summarise"}')"
want "an accessibility audit -> allow" ALLOW \
  "$(wf "$O1" 'export const meta={name:"a11y",description:"run an accessibility audit across routes"}')"
# The dangerous direction: gathering words must not launder a design workflow through.
want "\"harvest\" plus variant writing -> deny (creative wins)" DENY \
  "$(wf "$O1" 'export const meta={name:"harvest",description:"harvest refs then build each variant hero"}')"

# The guard must not have broken the ordinary write path it shares a hook with.
O3="$TMP/orch-write"; mkdir -p "$O3"
want "a plain source write with no marker still passes" ALLOW "$(run "$O3" Write "$O3/src/pages/index.astro")"

# ===================================================================================
# THE SURVEY WALL IS SCOPED TO WHAT IS COMPOSED FROM THE LIBRARY (42-47).
# A live client build hit the wall writing src/brand/tokens.css. Brand tokens are
# EXTRACTED from the client's own brand, not designed from references, so demanding a
# library survey before them inverts the order of the work. The survey is about what you
# COMPOSE, and composition happens in src/pages and src/components.
# ===================================================================================
S25="$TMP/survey-scope"; mkdir -p "$S25"; echo "$MARKER" > "$S25/.palate-skill-state.json"
write_valid_manifest "$S25"; add_calls "$S25" "$SHALLOW"   # MCP answered, survey far too thin

for f in src/brand/tokens.css src/brand/fonts.css src/styles/globals.css src/lib/content.ts; do
  want "scaffold file $f -> allow (not composed from the library)" ALLOW \
    "$(run "$S25" Write "$S25/$f")"
done
want "src/pages/index.astro -> still DENY (this IS composed)" DENY \
  "$(run "$S25" Write "$S25/src/pages/index.astro")"
want "src/components/Hero.astro -> still DENY" DENY \
  "$(run "$S25" Write "$S25/src/components/Hero.astro")"

# === THE BOARD PATHS ARE PAGE AND SECTION SOURCE, exactly like /v1 was =====================
# Explore writes `src/pages/boards/bN.astro` and `src/components/sections/BNHero.astro` first
# now, and they are the FIRST design writes of a build. If either fell outside the wall's idea
# of page-or-section source, the whole Explore stage would slip past both the DIVERGE wall and
# the survey wall: a build could write five boards having diverged nothing and surveyed nothing,
# which is the exact failure both walls exist to stop, arriving through a new directory.
BB="$TMP/boards-nodiverge"; mkdir -p "$BB"; echo "$MARKER" > "$BB/.palate-skill-state.json"
want "board page before DIVERGE -> deny" DENY \
  "$(run "$BB" Write "$BB/src/pages/boards/b1.astro")"
want "board section before DIVERGE -> deny" DENY \
  "$(run "$BB" Write "$BB/src/components/sections/B1Hero.astro")"

BB2="$TMP/boards-diverged"; mkdir -p "$BB2"; echo "$MARKER" > "$BB2/.palate-skill-state.json"
write_valid_manifest "$BB2"
want "board page after a valid DIVERGE -> allow" ALLOW \
  "$(run "$BB2" Write "$BB2/src/pages/boards/b1.astro")"
want "board section after a valid DIVERGE -> allow" ALLOW \
  "$(run "$BB2" Write "$BB2/src/components/sections/B1Hero.astro")"

# AND THE SURVEY WALL REACHES THEM, which the DIVERGE cases above cannot show: a NEW file is
# denied before DIVERGE whether or not the wall thinks it is page-or-section source, so those
# two assertions pass on a wall that has stopped recognising the board paths entirely. This is
# the one that fails when it does, and it is the one that matters: a build could otherwise
# write five boards on three Palate calls, which is the fault the survey wall was written for.
BB3="$TMP/boards-survey"; mkdir -p "$BB3"; echo "$MARKER" > "$BB3/.palate-skill-state.json"
write_valid_manifest "$BB3"; add_calls "$BB3" "$SHALLOW"
want "board page with a thin survey -> deny (this IS composed from the library)" DENY \
  "$(run "$BB3" Write "$BB3/src/pages/boards/b1.astro")"
want "board section with a thin survey -> deny" DENY \
  "$(run "$BB3" Write "$BB3/src/components/sections/B1Hero.astro")"

echo "---"

# === THE PLAN CHECKPOINT WALL ==============================================================
# A live build skipped checkpoint 1 whole (one sentence to the user in 28 minutes). A valid
# diverge no longer suffices: the manifest must record what was shown and a go, or a
# recorded exemption. Three Explore decisions are valid, and two of them skip variations.
strip_cp() { # <dir> -> remove plan_checkpoint from a valid fixture
  node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));delete m.plan_checkpoint;fs.writeFileSync(f,JSON.stringify(m));' "$1/build-manifest.json"
}
set_cp() { # <dir> <json-for-plan_checkpoint>
  node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));m.plan_checkpoint=JSON.parse(process.argv[2]);fs.writeFileSync(f,JSON.stringify(m));' "$1/build-manifest.json" "$2"
}
mk_cp() { local d="$TMP/$1"; mkdir -p "$d"; echo "$MARKER" > "$d/.palate-skill-state.json"; write_valid_manifest "$d"; echo "$d"; }

C1="$(mk_cp cp1)"; strip_cp "$C1"
want "valid diverge but NO plan checkpoint -> deny" DENY "$(run "$C1" Write "$C1/src/pages/index.astro")"
want "  ...and the deny names the checkpoint" "yes" \
  "$(printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"%s"}}' "$C1" "$C1/src/pages/index.astro" | node "$HOOK" 2>/dev/null | grep -q "PLAN CHECKPOINT REQUIRED" && echo yes || echo no)"
want "no checkpoint + PALATE_GATE_CHECKPOINT=0 -> allow" ALLOW "$(run "$C1" Write "$C1/src/pages/index.astro" PALATE_GATE_CHECKPOINT=0)"
want "no checkpoint + PALATE_GATE_OFF=1 -> allow" ALLOW "$(run "$C1" Write "$C1/src/pages/index.astro" PALATE_GATE_OFF=1)"

C2="$(mk_cp cp2)"; set_cp "$C2" '{"exempt":"tiny-work","reason":"one copy fix on an existing page"}'
want "recorded tiny-work exemption -> allow" ALLOW "$(run "$C2" Write "$C2/src/pages/index.astro")"
C3="$(mk_cp cp3)"; set_cp "$C3" '{"exempt":"tiny-work"}'
want "exemption with no reason -> deny" DENY "$(run "$C3" Write "$C3/src/pages/index.astro")"
C4="$(mk_cp cp4)"; set_cp "$C4" '{"exempt":"because-i-said-so","reason":"x"}'
want "an unknown exemption -> deny" DENY "$(run "$C4" Write "$C4/src/pages/index.astro")"

C5="$(mk_cp cp5)"; set_cp "$C5" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"supplied-example","source":"client-mockup/index.html"}},"go":{"given":true,"how":"asked","quote":"yes, rebuild that as is"}}'
want "supplied-example (no variations wanted) -> allow" ALLOW "$(run "$C5" Write "$C5/src/pages/index.astro")"
C6="$(mk_cp cp6)"; set_cp "$C6" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"named-direction","source":"https://northwind.example"}},"go":{"given":true,"how":"brief","quote":"build it like the Northwind site"}}'
want "named-direction pre-authorised by the brief -> allow" ALLOW "$(run "$C6" Write "$C6/src/pages/index.astro")"
C7="$(mk_cp cp7)"; set_cp "$C7" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"supplied-example"}},"go":{"given":true,"how":"asked","quote":"ok"}}'
want "supplied-example with nothing supplied -> deny" DENY "$(run "$C7" Write "$C7/src/pages/index.astro")"
C8="$(mk_cp cp8)"; set_cp "$C8" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"ladder","count":2}},"go":{"given":true,"how":"asked","quote":"ok"}}'
want "ladder of 2 (no BETWEEN to point at) -> deny" DENY "$(run "$C8" Write "$C8/src/pages/index.astro")"
C9="$(mk_cp cp9)"; set_cp "$C9" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"ladder","count":5}},"go":{"given":false,"how":"asked","quote":"hold on"}}'
want "plan shown, go NOT given -> deny" DENY "$(run "$C9" Write "$C9/src/pages/index.astro")"
C10="$(mk_cp cp10)"; set_cp "$C10" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"ladder","count":5}},"go":{"given":true,"how":"asked","quote":""}}'
want "go with no quoted words -> deny" DENY "$(run "$C10" Write "$C10/src/pages/index.astro")"
C11="$(mk_cp cp11)"; set_cp "$C11" '{"shown":{"stage":"preview","cms":false,"explore":{"mode":"ladder","count":5}},"go":{"given":true,"how":"asked","quote":"go"}}'
want "host never asked -> deny" DENY "$(run "$C11" Write "$C11/src/pages/index.astro")"
C12="$(mk_cp cp12)"; set_cp "$C12" '{"shown":{"host":"vercel","stage":"preview","explore":{"mode":"ladder","count":5}},"go":{"given":true,"how":"asked","quote":"go"}}'
want "CMS question never asked -> deny" DENY "$(run "$C12" Write "$C12/src/pages/index.astro")"
C13="$(mk_cp cp13)"; strip_cp "$C13"
want "no checkpoint, NON page/section source over an existing file -> allow (iteration)" ALLOW \
  "$( mkdir -p "$C13/src/lib"; echo x > "$C13/src/lib/util.ts"; run "$C13" Write "$C13/src/lib/util.ts")"

# === ARTBOARDS ARE DESIGN SOURCE ===========================================================
# Canvas-first Explore writes .palate/explore/seed/B1.dc.html as the FIRST design artefact of a
# build. If that path fell outside the wall, five boards could be drawn having diverged nothing,
# asked nothing and surveyed nothing: the exact failure every wall exists to stop.
AB="$TMP/art-nodiverge"; mkdir -p "$AB"; echo "$MARKER" > "$AB/.palate-skill-state.json"
want "artboard before DIVERGE -> deny" DENY "$(run "$AB" Write "$AB/.palate/explore/seed/B1.dc.html")"
AB2="$TMP/art-diverged"; mkdir -p "$AB2"; echo "$MARKER" > "$AB2/.palate-skill-state.json"; write_valid_manifest "$AB2"
want "artboard after DIVERGE + checkpoint -> allow" ALLOW "$(run "$AB2" Write "$AB2/.palate/explore/seed/B1.dc.html")"
AB3="$TMP/art-survey"; mkdir -p "$AB3"; echo "$MARKER" > "$AB3/.palate-skill-state.json"; write_valid_manifest "$AB3"; add_calls "$AB3" "$SHALLOW"
want "artboard with a thin survey -> deny (drawn FROM the library)" DENY "$(run "$AB3" Write "$AB3/.palate/explore/seed/B1.dc.html")"
AB4="$TMP/art-notes"; mkdir -p "$AB4"; echo "$MARKER" > "$AB4/.palate-skill-state.json"
want "the seed README is not design source -> allow" ALLOW "$(run "$AB4" Write "$AB4/.palate/explore/seed/README.md")"
want "canvas.json is not design source -> allow" ALLOW "$(run "$AB4" Write "$AB4/.palate/explore/seed/canvas.json")"

C14="$(mk_cp cp14)"; set_cp "$C14" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"ladder","count":5}},"go":{"given":true,"how":"brief","quote":"Run a full Explore so I can pick a direction"}}'
want "a ladder Explore pre-authorised by the brief alone -> deny (the host and CMS are always asked)" DENY "$(run "$C14" Write "$C14/src/pages/index.astro")"
C15="$(mk_cp cp15)"; set_cp "$C15" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"supplied-example","source":"mock.html"}},"go":{"given":true,"how":"brief","quote":"rebuild this mock as is"}}'
want "a supplied example pre-authorised by the brief -> allow" ALLOW "$(run "$C15" Write "$C15/src/pages/index.astro")"

# === THE INTAKE ============================================================================
# On the real v3 run the calibration question was answered AFTER the boards existed, and the
# checkpoint was satisfied by the brief: nothing about the direction came from the person. A
# ladder Explore now has to record the six answers BEFORE the deep survey runs, because they
# are what steers it (the intensity facet, the admired sites, the donors ruled out, the
# conversion spine). The other two Explore modes are untouched: neither draws a ladder.
INTAKE_OK='{"calibration":{"position":2,"why":"the second one, the first is too quiet for us"},"admired":["https://northwind.example","https://harbourglass.example"],"disliked":["https://cheapquotes.example"],"primary_action":"call","wow":"a postcode answers on the spot","avoid":["no purple","no stock people photos","no sliders"]}'
cp_ladder() { # <intake json> -> a plan_checkpoint carrying it
  printf '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"ladder","count":5},"intake":%s},"go":{"given":true,"how":"asked","quote":"go"}}' "$1"
}
drop_key() { # <intake json> <key> -> the same intake without that key
  node -e 'const o=JSON.parse(process.argv[1]);delete o[process.argv[2]];console.log(JSON.stringify(o))' "$1" "$2"
}
set_key() { # <intake json> <key> <json value> -> the same intake with that key replaced
  node -e 'const o=JSON.parse(process.argv[1]);o[process.argv[2]]=JSON.parse(process.argv[3]);console.log(JSON.stringify(o))' "$1" "$2" "$3"
}

I1="$(mk_cp in1)"; set_cp "$I1" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"ladder","count":5}},"go":{"given":true,"how":"asked","quote":"go"}}'
want "a ladder asked for but nothing asked OF the person -> deny" DENY "$(run "$I1" Write "$I1/src/pages/index.astro")"
want "  ...and the deny names the intake" "yes" \
  "$(printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"%s"}}' "$I1" "$I1/src/pages/index.astro" | node "$HOOK" 2>/dev/null | grep -q "intake" && echo yes || echo no)"

I2="$(mk_cp in2)"; set_cp "$I2" "$(cp_ladder "$INTAKE_OK")"
want "a ladder with the six answers recorded -> allow" ALLOW "$(run "$I2" Write "$I2/src/pages/index.astro")"

n=0
for k in calibration admired disliked primary_action wow avoid; do
  n=$((n+1)); d="$(mk_cp "in-miss$n")"; set_cp "$d" "$(cp_ladder "$(drop_key "$INTAKE_OK" "$k")")"
  want "intake missing $k -> deny" DENY "$(run "$d" Write "$d/src/pages/index.astro")"
done

I3="$(mk_cp in3)"; set_cp "$I3" "$(cp_ladder "$(set_key "$INTAKE_OK" avoid '["no purple","no sliders"]')")"
want "an avoid list of 2 (too thin to steer a donor choice) -> deny" DENY "$(run "$I3" Write "$I3/src/pages/index.astro")"
I4="$(mk_cp in4)"; set_cp "$I4" "$(cp_ladder "$(set_key "$INTAKE_OK" avoid '["a","b","c","d","e","f"]')")"
want "an avoid list of 6 (past the 3 to 5 the doctrine asks for) -> deny" DENY "$(run "$I4" Write "$I4/src/pages/index.astro")"
I5="$(mk_cp in5)"; set_cp "$I5" "$(cp_ladder "$(set_key "$INTAKE_OK" calibration '{"position":5,"why":"off the end of the row"}')")"
want "a calibration position off the row -> deny" DENY "$(run "$I5" Write "$I5/src/pages/index.astro")"
I6="$(mk_cp in6)"; set_cp "$I6" "$(cp_ladder "$(set_key "$INTAKE_OK" calibration '{"position":2}')")"
want "a calibration answer with no why -> deny" DENY "$(run "$I6" Write "$I6/src/pages/index.astro")"
I7="$(mk_cp in7)"; set_cp "$I7" "$(cp_ladder "$(set_key "$INTAKE_OK" admired '[]')")"
want "an empty admired list -> deny" DENY "$(run "$I7" Write "$I7/src/pages/index.astro")"
I8="$(mk_cp in8)"; set_cp "$I8" "$(cp_ladder "$(set_key "$INTAKE_OK" primary_action '"   "')")"
want "a blank primary action -> deny" DENY "$(run "$I8" Write "$I8/src/pages/index.astro")"

I12="$(mk_cp in12)"; set_cp "$I12" "$(cp_ladder "$(set_key "$INTAKE_OK" admired '"northwind"')")"
want "admired given as one string rather than a list -> deny" DENY "$(run "$I12" Write "$I12/src/pages/index.astro")"
I13="$(mk_cp in13)"; set_cp "$I13" "$(cp_ladder "$(set_key "$INTAKE_OK" avoid '[1,2,3]')")"
want "an avoid list of things that are not words -> deny" DENY "$(run "$I13" Write "$I13/src/pages/index.astro")"

# THE BOARDS ARE THE THING THE INTAKE EXISTS TO STEER, so the wall has to hold the artboard
# path too: a ladder drawn before the six answers is the exact run that prompted this.
I14="$TMP/art-no-intake"; mkdir -p "$I14"; echo "$MARKER" > "$I14/.palate-skill-state.json"; write_valid_manifest "$I14"
node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));delete m.plan_checkpoint.shown.intake;fs.writeFileSync(f,JSON.stringify(m));' "$I14/build-manifest.json"
want "an artboard drawn before the intake was asked -> deny" DENY "$(run "$I14" Write "$I14/.palate/explore/seed/B1.dc.html")"

I15="$(mk_cp in15)"; set_cp "$I15" "$(cp_ladder "$(set_key "$INTAKE_OK" calibration '{"position":0,"why":"before the first one"}')")"
want "a calibration position of 0 (the row starts at 1) -> deny" DENY "$(run "$I15" Write "$I15/src/pages/index.astro")"
I16="$(mk_cp in16)"; set_cp "$I16" "$(cp_ladder "$(set_key "$INTAKE_OK" calibration '{"position":"2","why":"typed, not counted"}')")"
want "a calibration position written as a string -> deny" DENY "$(run "$I16" Write "$I16/src/pages/index.astro")"
I17="$(mk_cp in17)"; set_cp "$I17" "$(cp_ladder "$(set_key "$INTAKE_OK" admired '[""]')")"
want "an admired list holding one empty answer -> deny" DENY "$(run "$I17" Write "$I17/src/pages/index.astro")"
I18="$(mk_cp in18)"; set_cp "$I18" "$(cp_ladder "$(set_key "$INTAKE_OK" admired "$(node -e 'console.log(JSON.stringify(Array.from({length:21},(_,i)=>"site"+i)))')")")"
want "an admired list of 21 (past the cap the deny message states) -> deny" DENY "$(run "$I18" Write "$I18/src/pages/index.astro")"

I9="$(mk_cp in9)"; set_cp "$I9" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"supplied-example","source":"mock.html"}},"go":{"given":true,"how":"asked","quote":"rebuild that"}}'
want "a supplied example needs no intake (no ladder is drawn) -> allow" ALLOW "$(run "$I9" Write "$I9/src/pages/index.astro")"
I10="$(mk_cp in10)"; set_cp "$I10" '{"shown":{"host":"vercel","stage":"preview","cms":false,"explore":{"mode":"named-direction","source":"https://northwind.example"}},"go":{"given":true,"how":"brief","quote":"build it like Northwind"}}'
want "a named direction needs no intake -> allow" ALLOW "$(run "$I10" Write "$I10/src/pages/index.astro")"
I11="$(mk_cp in11)"; set_cp "$I11" '{"exempt":"tiny-work","reason":"one copy fix"}'
want "a recorded exemption needs no intake -> allow" ALLOW "$(run "$I11" Write "$I11/src/pages/index.astro")"

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
