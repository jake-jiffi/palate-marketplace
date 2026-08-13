#!/usr/bin/env bash
# Tests that the cross-build memory READERS survive the shape the writer actually produces.
#
# Measured on the real machine log on 2026-08-13: 1,735 entries, 1,278 of them (73.7%)
# attribute-less shells, 2 with any `faces`, and ZERO with `struct`/`style`. Against that
# log the anti-repeat check in scripts/gate-novelty.mjs was structurally unreachable and
# still printed "build-level clean", which reads as "compared and found different" rather
# than "never compared". These tests pin both halves of the fix: the recency window is the
# last N COMPARABLE entries rather than the last N rows, and a sub-check that cannot run
# says so on stderr instead of passing quietly.
#
# Exit codes follow the gate's contract: 0 = pass or fail-open skip, 2 = block.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-novelty.mjs"
pass=0; fail=0
ok()   { echo "ok   - $1"; pass=$((pass+1)); }
bad()  { echo "FAIL - $1"; fail=$((fail+1)); }
want() { local d="$1" got="$2" exp="$3"; if [ "$got" -eq "$exp" ]; then ok "$d"; else bad "$d (exit $got, want $exp)"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FH="$TMP/home"; mkdir -p "$FH/.config/palate"
LOG="$FH/.config/palate/builds.log.json"

# --- 1. The face tell fires THROUGH the empty tail --------------------------
# Three builds that recorded faces, then ten attribute-less shells: the exact shape of the
# real log. Slicing the last 5 ROWS lands entirely in the shells and matches nothing.
node -e '
const fs = require("fs");
const e = [];
for (let i = 0; i < 3; i++) e.push({ ts:"f"+i, business:"brief-"+i, donors:["aesop"], faces:["space grotesk"] });
for (let i = 0; i < 10; i++) e.push({ ts:"s"+i, business:null, signature_move:null, donors:[], faces:[] });
fs.writeFileSync(process.argv[1], JSON.stringify(e, null, 2));
' "$LOG"
printf '<html><style>h1{font-family:"Space Grotesk",sans-serif}</style><body><h1>a</h1></body></html>' > "$TMP/r1.html"
printf '<html><style>h2{font-family:"Space Grotesk",sans-serif}</style><body><h2>b</h2></body></html>' > "$TMP/r2.html"
HOME="$FH" node "$GATE" --variants "$TMP/r1.html" "$TMP/r2.html" >/dev/null 2>&1
want "recurring face still caught when the log tail is attribute-less shells" $? 2

# --- 2. Not enough face records -> says so on stderr, still exits 0 ---------
node -e '
const fs = require("fs");
const e = [{ ts:"f0", business:"only-one", donors:["aesop"], faces:["canela"] }];
for (let i = 0; i < 20; i++) e.push({ ts:"s"+i, business:null, signature_move:null, donors:[], faces:[] });
fs.writeFileSync(process.argv[1], JSON.stringify(e, null, 2));
' "$LOG"
ERR="$TMP/err.txt"
HOME="$FH" node "$GATE" --variants "$TMP/r1.html" "$TMP/r2.html" >/dev/null 2>"$ERR"
ec=$?
if [ "$ec" -eq 0 ] && grep -q "face-recurrence check NOT RUN" "$ERR" && grep -q "PASS BY ABSENCE OF DATA" "$ERR"; then
  ok "too few face records -> reported on stderr as not-run, not as clean"
else
  bad "too few face records -> reported on stderr as not-run (exit $ec, stderr: $(tr '\n' ' ' < "$ERR"))"
fi

# --- 3. No logged build carries a skin -> the repeat check reports NOT RUN --
# This is the live state of every real machine: hooks/build-log-entry.mjs records no
# struct/style, so the repeat check has never once compared anything.
HOME="$FH" node "$GATE" --variants "$TMP/r1.html" "$TMP/r2.html" >/dev/null 2>"$ERR"
ec=$?
if [ "$ec" -eq 0 ] && grep -q "build-repeat check NOT RUN" "$ERR" && grep -q "build-log-entry.mjs" "$ERR"; then
  ok "no skin in the log -> repeat check reports NOT RUN and names the writer"
else
  bad "no skin in the log -> repeat check reports NOT RUN (exit $ec, stderr: $(tr '\n' ' ' < "$ERR"))"
fi

# --- 4. Once the writer DOES record a skin, the repeat check blocks ---------
# Forward-compatibility proof: the sub-check is dormant for want of data, not broken. The
# two variants below produce struct {section., h1., h2.} and style {#112233,
# ff:canela,serif}; the history entry carries the same skin and donors. The class token is
# empty in the signature because structSig's optional class group is lazy and matches
# nothing - a real quirk of the shared signature, reproduced here rather than assumed away.
printf '<html><style>h1{color:#112233;font-family:Canela,serif}</style><body><section class="hero"><h1>a</h1></section></body></html>' > "$TMP/s1.html"
printf '<html><style>h2{color:#112233;font-family:Canela,serif}</style><body><section class="hero"><h2>b</h2></section></body></html>' > "$TMP/s2.html"
cat > "$LOG" <<'JSON'
[ { "ts": "2026-08-01T00:00:00.000Z",
    "business": { "name": "Prior Client", "url": "https://example.com" },
    "donors": ["aesop", "linear"],
    "faces": [],
    "struct": ["section.", "h1.", "h2."],
    "style": ["#112233", "ff:canela,serif"] } ]
JSON
cat > "$TMP/build-manifest.json" <<'JSON'
{ "schema": 3,
  "diverge": { "ran": true, "n": 3, "concepts": [
    { "id": "c1", "conventionality": 0.15 },
    { "id": "c2", "conventionality": 0.5 },
    { "id": "c3", "conventionality": 0.9 } ] },
  "converge": { "ran": true, "advanced": ["c1", "c2"] },
  "variants": [
    { "id": "v1", "html_path": "s1.html", "donor_slugs": ["aesop", "linear"] },
    { "id": "v2", "html_path": "s2.html", "donor_slugs": ["aesop", "linear"] } ] }
JSON
HOME="$FH" node "$GATE" --manifest "$TMP/build-manifest.json" >/dev/null 2>"$ERR"
want "a logged skin makes the repeat check fire (the path works, it is starved)" $? 2
if grep -q "Prior Client" "$ERR"; then
  ok "an object-shaped business renders its name, not [object Object]"
else
  bad "an object-shaped business renders its name (stderr: $(tr '\n' ' ' < "$ERR"))"
fi

# --- 5. A DIFFERENT skin against the same history -> pass -------------------
printf '<html><style>article{color:#aa3311;font-family:Soehne,sans-serif;border-radius:2px}</style><body><article class="feed"><ul class="list"><li>x</li></ul></article></body></html>' > "$TMP/d1.html"
printf '<html><style>aside{color:#22bb55;font-family:Tiempos,serif;border-radius:19px}</style><body><aside class="rail"><ol class="steps"><li>y</li></ol></aside></body></html>' > "$TMP/d2.html"
cat > "$TMP/m2.json" <<'JSON'
{ "schema": 3,
  "diverge": { "ran": true, "n": 3, "concepts": [
    { "id": "c1", "conventionality": 0.15 },
    { "id": "c2", "conventionality": 0.5 } ] },
  "converge": { "ran": true, "advanced": ["c1"] },
  "variants": [
    { "id": "v1", "html_path": "d1.html", "donor_slugs": ["gantri"] },
    { "id": "v2", "html_path": "d2.html", "donor_slugs": ["notion"] } ] }
JSON
HOME="$FH" node "$GATE" --manifest "$TMP/m2.json" >/dev/null 2>&1
want "a different skin against the same logged build -> pass" $? 0

# --- 6. The conventionality predicate is the MINIMUM, not the mean ----------
# A ladder of eight all self-tagged 0.55 averages 0.55 and used to clear a 0.6 mean bar
# while containing nothing bold at all.
cat > "$TMP/flat.json" <<'JSON'
{ "schema": 3,
  "diverge": { "ran": true, "n": 8, "concepts": [
    {"id":"c1","conventionality":0.55},{"id":"c2","conventionality":0.55},
    {"id":"c3","conventionality":0.55},{"id":"c4","conventionality":0.55},
    {"id":"c5","conventionality":0.55},{"id":"c6","conventionality":0.55},
    {"id":"c7","conventionality":0.55},{"id":"c8","conventionality":0.25} ] },
  "converge": { "ran": true, "advanced": ["c1","c2","c3","c4","c5","c6","c7"] } }
JSON
HOME="$FH" node "$GATE" --manifest "$TMP/flat.json" >/dev/null 2>&1
want "a ladder with nothing bold in it blocks even though its mean is acceptable" $? 2

# A real ambition ladder: rung 1 deliberately restrained, top rung genuinely bold. Its mean
# is 0.72, so the old mean predicate blocked exactly the shape the doctrine asks for.
cat > "$TMP/ladder.json" <<'JSON'
{ "schema": 3,
  "diverge": { "ran": true, "n": 8, "concepts": [
    {"id":"c1","conventionality":0.95},{"id":"c2","conventionality":0.90},
    {"id":"c3","conventionality":0.85},{"id":"c4","conventionality":0.80},
    {"id":"c5","conventionality":0.75},{"id":"c6","conventionality":0.70},
    {"id":"c7","conventionality":0.65},{"id":"c8","conventionality":0.15} ] },
  "converge": { "ran": true, "advanced": ["c1","c2","c3","c4","c5","c6","c7","c8"] } }
JSON
HOME="$FH" node "$GATE" --manifest "$TMP/ladder.json" >/dev/null 2>&1
want "a whole ambition ladder with a bold top rung passes (mean 0.72, min 0.15)" $? 0

# --- 7. When DIVERGE itself never sampled a tail, blame DIVERGE -------------
cat > "$TMP/nodiv-tail.json" <<'JSON'
{ "schema": 3,
  "diverge": { "ran": true, "n": 4, "concepts": [
    {"id":"c1","conventionality":0.7},{"id":"c2","conventionality":0.8},
    {"id":"c3","conventionality":0.6},{"id":"c4","conventionality":0.9} ] },
  "converge": { "ran": true, "advanced": ["c1","c3"] } }
JSON
HOME="$FH" node "$GATE" --manifest "$TMP/nodiv-tail.json" >/dev/null 2>"$ERR"
ec=$?
if [ "$ec" -eq 2 ] && grep -q "DIVERGE never sampled the low-typicality tail" "$ERR"; then
  ok "no tail anywhere -> the failure names DIVERGE, not CONVERGE"
else
  bad "no tail anywhere -> the failure names DIVERGE (exit $ec, stderr: $(tr '\n' ' ' < "$ERR"))"
fi

# --- 8. A retired env is called out, never silently ignored ------------------
PALATE_MAX_CONVENTIONALITY=0.9 HOME="$FH" node "$GATE" --manifest "$TMP/ladder.json" >/dev/null 2>"$ERR"
ec=$?
if [ "$ec" -eq 0 ] && grep -q "no longer gates anything" "$ERR"; then
  ok "PALATE_MAX_CONVENTIONALITY is reported as retired, not silently ignored"
else
  bad "PALATE_MAX_CONVENTIONALITY reported as retired (exit $ec, stderr: $(tr '\n' ' ' < "$ERR"))"
fi

echo ""; echo "memory-log-shape: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
