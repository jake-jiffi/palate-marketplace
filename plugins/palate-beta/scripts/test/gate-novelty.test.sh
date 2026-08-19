#!/usr/bin/env bash
# Tests the novelty gate (scripts/gate-novelty.mjs): the CONVERGE concept pre-check
# (block a safe-only converge, pass a low-typicality advance, skip when DIVERGE is
# absent) and the build-level / type-face-recurrence check (skip <2 variants, block a
# display face that recurs across recent builds). All the "nothing to compare" cases
# SKIP (exit 0) - that is the fail-open invariant, never a trap.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-novelty.mjs"
pass=0; fail=0

check() { # desc  expected_exit  [args...]
  local desc="$1" want="$2"; shift 2
  node "$GATE" "$@" >/dev/null 2>&1
  local ec=$?
  if [ "$ec" -eq "$want" ]; then echo "ok   - $desc"; pass=$((pass+1));
  else echo "FAIL - $desc (exit $ec, want $want)"; fail=$((fail+1)); fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- CONCEPT pre-check: safe-only converge -> BLOCK (exit 2) -----------------
SAFE="$TMP/safe.json"
cat > "$SAFE" <<'JSON'
{ "schema": 3,
  "diverge": { "ran": true, "n": 6, "concepts": [
    { "id": "c1", "conventionality": 0.9 },
    { "id": "c2", "conventionality": 0.8 },
    { "id": "c3", "conventionality": 0.2 } ] },
  "converge": { "ran": true, "advanced": ["c1", "c2"] } }
JSON
check "safe-only converge -> block" 2 --manifest "$SAFE"

# --- CONCEPT pre-check: advanced the low-typicality tail -> PASS (exit 0) ----
BOLD="$TMP/bold.json"
cat > "$BOLD" <<'JSON'
{ "schema": 3,
  "diverge": { "ran": true, "n": 6, "concepts": [
    { "id": "c1", "conventionality": 0.9 },
    { "id": "c2", "conventionality": 0.2 },
    { "id": "c3", "conventionality": 0.15 } ] },
  "converge": { "ran": true, "advanced": ["c2", "c3"] } }
JSON
check "low-typicality advance -> pass" 0 --manifest "$BOLD"

# --- CONCEPT pre-check: no diverge block -> SKIP (fail-open, exit 0) ---------
NODIV="$TMP/nodiv.json"
echo '{ "schema": 3, "diverge": null, "converge": null }' > "$NODIV"
check "no diverge -> skip (fail-open)" 0 --manifest "$NODIV"

# --- CONCEPT pre-check: no manifest -> SKIP (fail-open, exit 0) --------------
check "no manifest -> skip (fail-open)" 0 --manifest "$TMP/no-such.json"

# --- BUILD-level: <2 variants -> SKIP (fail-open, exit 0) --------------------
printf '<html><body><h1>only one</h1></body></html>' > "$TMP/v1.html"
check "single variant -> skip (fail-open)" 0 --variants "$TMP/v1.html"

# --- BUILD-level: 2 distinct variants, no history -> PASS (exit 0) -----------
printf '<html><style>h1{font-family:"Fraunces",serif}</style><body><h1>a</h1></body></html>' > "$TMP/a.html"
printf '<html><style>h2{font-family:"Schibsted Grotesk",sans-serif}</style><body><h2>b</h2></body></html>' > "$TMP/b.html"
check "two variants, no history -> pass" 0 --variants "$TMP/a.html" "$TMP/b.html"

# --- BUILD-level: TYPE-FACE RECURRENCE across recent builds -> BLOCK (exit 2) -
# Seed a throwaway builds.log.json (HOME-relative) where one face appears in 3 recent
# builds, then run a build that uses that same face. Use a temp HOME so the real log
# is untouched.
FAKEHOME="$TMP/home"; mkdir -p "$FAKEHOME/.config/palate"
cat > "$FAKEHOME/.config/palate/builds.log.json" <<'JSON'
[ { "ts": "1", "business": "x1", "donors": ["a"], "faces": ["space grotesk"] },
  { "ts": "2", "business": "x2", "donors": ["b"], "faces": ["space grotesk"] },
  { "ts": "3", "business": "x3", "donors": ["c"], "faces": ["space grotesk"] } ]
JSON
printf '<html><style>h1{font-family:"Space Grotesk",sans-serif}</style><body><h1>a</h1></body></html>' > "$TMP/r1.html"
printf '<html><style>h2{font-family:"Space Grotesk",sans-serif}</style><body><h2>b</h2></body></html>' > "$TMP/r2.html"
HOME="$FAKEHOME" node "$GATE" --variants "$TMP/r1.html" "$TMP/r2.html" >/dev/null 2>&1
ec=$?
if [ "$ec" -eq 2 ]; then echo "ok   - recurring display face -> block"; pass=$((pass+1));
else echo "FAIL - recurring display face -> block (exit $ec, want 2)"; fail=$((fail+1)); fi

# --- BUILD-level: a DIFFERENT face vs the same history -> PASS (exit 0) -------
printf '<html><style>h1{font-family:"Fraunces",serif}</style><body><h1>a</h1></body></html>' > "$TMP/f1.html"
printf '<html><style>h2{font-family:"Canela",serif}</style><body><h2>b</h2></body></html>' > "$TMP/f2.html"
HOME="$FAKEHOME" node "$GATE" --variants "$TMP/f1.html" "$TMP/f2.html" >/dev/null 2>&1
ec=$?
if [ "$ec" -eq 0 ]; then echo "ok   - fresh face vs same history -> pass"; pass=$((pass+1));
else echo "FAIL - fresh face vs same history -> pass (exit $ec, want 0)"; fail=$((fail+1)); fi

# --- --require-diverge MODE-AWARE mirror (the done-time copy of the PreToolUse wall) ---
# The gate reads the brand mode from .palate-skill-state.json beside the manifest. These
# assert the same mode-aware bar as scripts/test/pretooluse-diverge.test.sh, but via the
# gate's exit code (0 = pass, 2 = block).
RD="$TMP/rd"; mkdir -p "$RD"

# A brand-CREATION-valid manifest (>=8 concepts, spread, tail, colour+type varied >=3 each).
write_rd_creation_manifest() { # <path>
  cat > "$1" <<'JSON'
{ "schema":3,
  "diverge": { "ran":true, "n":8, "mode":"brand-creation",
    "axes_varied":["colour","type","mood","layout","motion"],
    "concepts": [
    {"id":"c1","lens":"worst-moment","analogical_seed":"tide chart","conventionality":0.1,"colourway":"ink + bone + signal-red","type":"grotesk display + serif body"},
    {"id":"c2","lens":"founder","analogical_seed":"signage","conventionality":0.25,"colourway":"forest + cream","type":"slab display + grotesk body"},
    {"id":"c3","lens":"object","analogical_seed":"architecture","conventionality":0.4,"colourway":"cobalt + chalk + amber","type":"humanist serif + mono caption"},
    {"id":"c4","lens":"after","analogical_seed":"film","conventionality":0.5,"colourway":"ink + bone + signal-red","type":"grotesk display + serif body"},
    {"id":"c5","lens":"refuses","analogical_seed":"map","conventionality":0.6,"colourway":"forest + cream","type":"slab display + grotesk body"},
    {"id":"c6","lens":"worst-moment","analogical_seed":"relay baton","conventionality":0.7,"colourway":"cobalt + chalk + amber","type":"humanist serif + mono caption"},
    {"id":"c7","lens":"founder","analogical_seed":"instrument","conventionality":0.8,"colourway":"ink + bone + signal-red","type":"grotesk display + serif body"},
    {"id":"c8","lens":"object","analogical_seed":"games","conventionality":0.55,"colourway":"forest + cream","type":"slab display + grotesk body"} ] },
  "converge": { "ran":true, "advanced":["c1","c2"] } }
JSON
}

# A brand-PROVIDED-valid manifest (locked colour/type, >=6 distinct layout/motion skins).
write_rd_provided_manifest() { # <path>
  cat > "$1" <<'JSON'
{ "schema":3,
  "diverge": { "ran":true, "n":8, "mode":"brand-provided",
    "axes_varied":["layout","motion","density"],
    "locked": { "colour": true, "type": true, "palette_source": "@palate/brand@2.1.0", "faces": ["soehne","tiempos"] },
    "concepts": [
    {"id":"c1","lens":"a","analogical_seed":"p","conventionality":0.1,"layout":"split","motion":"rise"},
    {"id":"c2","lens":"b","analogical_seed":"q","conventionality":0.2,"layout":"stack","motion":"fade"},
    {"id":"c3","lens":"c","analogical_seed":"r","conventionality":0.3,"layout":"grid","motion":"slide"},
    {"id":"c4","lens":"d","analogical_seed":"s","conventionality":0.4,"layout":"rail","motion":"pin"},
    {"id":"c5","lens":"e","analogical_seed":"t","conventionality":0.5,"layout":"canvas","motion":"draw"},
    {"id":"c6","lens":"f","analogical_seed":"u","conventionality":0.6,"layout":"index","motion":"tilt"},
    {"id":"c7","lens":"g","analogical_seed":"v","conventionality":0.7,"layout":"poster","motion":"wipe"},
    {"id":"c8","lens":"h","analogical_seed":"w","conventionality":0.8,"layout":"feed","motion":"snap"} ] },
  "converge": { "ran":true, "advanced":["c1"] } }
JSON
}

# brand-creation marker + creation-valid manifest -> PASS (exit 0)
echo '{"schemaVersion":"1.2","stage":"preview","brandMode":"brand-creation"}' > "$RD/.palate-skill-state.json"
write_rd_creation_manifest "$RD/build-manifest.json"
check "require-diverge: brand-creation valid -> pass" 0 --require-diverge --manifest "$RD/build-manifest.json"

# brand-creation marker + the creation manifest stripped of colour/type variation -> BLOCK (exit 2)
RD2="$TMP/rd2"; mkdir -p "$RD2"
echo '{"schemaVersion":"1.2","stage":"preview","brandMode":"brand-creation"}' > "$RD2/.palate-skill-state.json"
write_rd_provided_manifest "$RD2/build-manifest.json"   # provided-shaped manifest under a creation marker
check "require-diverge: creation marker, no colour/type variation -> block" 2 --require-diverge --manifest "$RD2/build-manifest.json"

# brand-provided marker + provided-valid manifest -> PASS (exit 0)
RD3="$TMP/rd3"; mkdir -p "$RD3"
echo '{"schemaVersion":"1.2","stage":"preview","brandMode":"brand-provided"}' > "$RD3/.palate-skill-state.json"
write_rd_provided_manifest "$RD3/build-manifest.json"
check "require-diverge: brand-provided valid -> pass" 0 --require-diverge --manifest "$RD3/build-manifest.json"

# brand-provided marker + a manifest that varies colour (brand drift) -> BLOCK (exit 2)
RD4="$TMP/rd4"; mkdir -p "$RD4"
echo '{"schemaVersion":"1.2","stage":"preview","brandMode":"brand-provided"}' > "$RD4/.palate-skill-state.json"
write_rd_creation_manifest "$RD4/build-manifest.json"   # creation-shaped (colour in axes_varied, mode mismatch) under a provided marker
check "require-diverge: provided marker, brand drift / mode mismatch -> block" 2 --require-diverge --manifest "$RD4/build-manifest.json"

# legacy marker with NO brandMode + creation-valid manifest -> PASS (back-compat default)
RD5="$TMP/rd5"; mkdir -p "$RD5"
echo '{"schemaVersion":"1.1","stage":"preview"}' > "$RD5/.palate-skill-state.json"
write_rd_creation_manifest "$RD5/build-manifest.json"
check "require-diverge: legacy marker (no brandMode) + valid creation -> pass" 0 --require-diverge --manifest "$RD5/build-manifest.json"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
