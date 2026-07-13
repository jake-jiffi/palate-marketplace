#!/usr/bin/env bash
# scripts/test/self-review-fired.test.sh - the KEYSTONE self-review proof (eval 12).
#
# Proves the visual loop + verifier catch a VISIBLE defect and the done-gate BLOCKS,
# while a clean build is ALLOWED. This is the test that makes self-review non-optional
# and not self-graded: "done" is computed from artefacts (screenshots, console errors,
# the verifier's verdict), never from an LLM boolean.
#
# Two arms:
#   ARM A (deterministic, always runs): drive the full done-gate chain over fixture
#     project dirs. A defective build (verify-report.json verdict:fail, console error
#     on the render) -> gate-done.sh exit 2 (BLOCK). A clean build (verdict:pass, zero
#     errors, screenshot on disk) -> gate-done.sh exit 0 (ALLOW). Also exercises
#     manifest-merge.mjs folding the computed verdict into build-manifest.json.
#   ARM B (live screenshot, runs only when Playwright + Chromium are available): serve
#     the defective fixture, run screenshot-build.mjs, assert it records >=1 console
#     error in errors.json + manifest.console_errors; serve the clean fixture, assert 0.
#
# Pure bash + jq + Node. Fixtures: scripts/test/fixtures/self-review/{defective,clean}.html.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL="$DIR/../.."
DONE_GATE="$DIR/../gate-done.sh"
MERGE="$DIR/../manifest-merge.mjs"
SHOOTER="$DIR/../reference-capture/screenshot-build.mjs"
DEEP="$DIR/fixtures/manifest-deep.json"          # passes the depth floor (>=1 mcp_call)
FIX="$DIR/fixtures/self-review"
pass=0; fail=0

ok()   { echo "ok   - $1"; pass=$((pass+1)); }
bad()  { echo "FAIL - $1"; fail=$((fail+1)); }

command -v jq >/dev/null 2>&1 || { echo "SKIP - jq not installed; cannot run the self-review proof"; exit 0; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A minimal valid PNG so the on-disk-evidence check in gate-done.sh finds a real file.
make_shots() { # <proj-dir> <console_errors>
  local proj="$1" cerr="$2"
  mkdir -p "$proj/.palate-shots/desktop"
  printf '\x89PNG\r\n\x1a\n' > "$proj/.palate-shots/desktop-full.png"
  printf '\x89PNG\r\n\x1a\n' > "$proj/.palate-shots/mobile-full.png"
  echo "{\"status\":\"captured\",\"console_errors\":$cerr,\"shots\":{\"desktop_full\":\"desktop-full.png\",\"mobile_full\":\"mobile-full.png\"}}" > "$proj/.palate-shots/manifest.json"
  if [ "$cerr" -gt 0 ]; then
    echo '[{"viewport":"desktop","text":"Error: deliberate runtime error"}]' > "$proj/.palate-shots/errors.json"
  else
    echo '[]' > "$proj/.palate-shots/errors.json"
  fi
}

# ============================================================================
# ARM A: the done-gate chain BLOCKS the defective build, ALLOWS the clean one.
# ============================================================================

# --- DEFECTIVE: the verifier caught the visual defects -> verdict fail -> BLOCK -
BLK="$TMP/defective"; mkdir -p "$BLK"
cp "$DEEP" "$BLK/build-manifest.json"
make_shots "$BLK" 1   # 1 console error from the thrown client script
cat > "$BLK/verify-report.json" <<'JSON'
{ "verdict": "fail",
  "gates": { "depth":"pass", "uniqueness":"pass", "anti_slop":"pass", "provenance":"pass", "visual":"fail", "real_astro":"pass" },
  "visual": { "ran": true, "pass": false, "console_errors": 1,
    "iterations": [ { "i": 1,
      "axes": { "philosophy": 3, "hierarchy": 2, "execution": 2, "specificity": 3, "restraint": 3, "variety": 2 },
      "defects": [ { "type": "overflow", "location": "hero mobile" },
                   { "type": "missing imagery", "location": "hero desktop" },
                   { "type": "contrast", "location": "hero body-copy desktop" } ],
      "score": 15,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png", "mobile_full": ".palate-shots/mobile-full.png" } } ] },
  "shots_dir": ".palate-shots" }
JSON

# manifest-merge folds the COMPUTED verdict in (never invents a pass).
( cd "$BLK" && PALATE_GATE_NOVELTY=0 node "$MERGE" >/dev/null 2>&1 )
merged_visual=$(jq -r '(.visual.pass)' "$BLK/build-manifest.json" 2>/dev/null)
[ "$merged_visual" = "false" ] && ok "manifest-merge folds the defective build as visual:false" \
  || bad "manifest-merge should fold visual:false on a defect (got '$merged_visual')"

PALATE_GATE_NOVELTY=0 bash "$DONE_GATE" "$BLK/build-manifest.json" >/dev/null 2>&1
ec=$?
[ "$ec" -eq 2 ] && ok "defective build -> gate-done BLOCKS (exit 2)" \
  || bad "defective build should BLOCK (exit $ec, want 2)"

# --- CLEAN: the verifier passed -> verdict pass -> ALLOW ----------------------
ALW="$TMP/clean"; mkdir -p "$ALW"
cp "$DEEP" "$ALW/build-manifest.json"
make_shots "$ALW" 0   # zero console errors
cat > "$ALW/verify-report.json" <<'JSON'
{ "verdict": "pass",
  "gates": { "depth":"pass", "uniqueness":"pass", "anti_slop":"pass", "provenance":"pass", "visual":"pass", "real_astro":"pass" },
  "visual": { "ran": true, "pass": true, "console_errors": 0,
    "iterations": [ { "i": 1,
      "axes": { "philosophy": 5, "hierarchy": 4, "execution": 4, "specificity": 4, "restraint": 4, "variety": 4 },
      "defects": [],
      "score": 25,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png", "mobile_full": ".palate-shots/mobile-full.png" } } ] },
  "shots_dir": ".palate-shots" }
JSON

( cd "$ALW" && PALATE_GATE_NOVELTY=0 node "$MERGE" >/dev/null 2>&1 )
merged_visual=$(jq -r '(.visual.pass)' "$ALW/build-manifest.json" 2>/dev/null)
[ "$merged_visual" = "true" ] && ok "manifest-merge folds the clean build as visual:true" \
  || bad "manifest-merge should fold visual:true on a clean build (got '$merged_visual')"

PALATE_GATE_NOVELTY=0 bash "$DONE_GATE" "$ALW/build-manifest.json" >/dev/null 2>&1
ec=$?
[ "$ec" -eq 0 ] && ok "clean build -> gate-done ALLOWS (exit 0)" \
  || bad "clean build should ALLOW (exit $ec, want 0)"

# --- Defect-recovery: take the BLOCKED build, fix it (clean report + 0 errors) -
# and re-run -> it now flips to ALLOW. Proves the loop is recoverable, not a dead end.
( cd "$BLK"
  make_shots "$BLK" 0   # the thrown script removed -> zero console errors now
  cat > "$BLK/verify-report.json" <<'JSON'
{ "verdict": "pass",
  "visual": { "ran": true, "pass": true, "console_errors": 0,
    "iterations": [ { "i": 2,
      "axes": { "philosophy": 5, "hierarchy": 4, "execution": 4, "specificity": 4, "restraint": 4, "variety": 4 },
      "defects": [], "score": 25,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png", "mobile_full": ".palate-shots/mobile-full.png" } } ] },
  "shots_dir": ".palate-shots" }
JSON
  PALATE_GATE_NOVELTY=0 node "$MERGE" >/dev/null 2>&1 )
PALATE_GATE_NOVELTY=0 bash "$DONE_GATE" "$BLK/build-manifest.json" >/dev/null 2>&1
ec=$?
[ "$ec" -eq 0 ] && ok "re-render after fix -> gate-done now ALLOWS (exit 0)" \
  || bad "fixed build should ALLOW on re-run (exit $ec, want 0)"

# ============================================================================
# ARM B: the live screenshot driver records the defect's console error.
# Runs only when Playwright + Chromium are available; otherwise SKIPS (the
# deterministic ARM A is the contract; ARM B is the real-pixel confirmation).
# ============================================================================
have_browser=0
if node -e "require('$SKILL/scripts/reference-capture/node_modules/playwright')" >/dev/null 2>&1; then
  have_browser=1
fi

if [ "$have_browser" -eq 1 ] && command -v python3 >/dev/null 2>&1; then
  serve_dir="$FIX"
  # Serve the fixtures dir on an ephemeral port bound to loopback (so the driver can
  # reach it at 127.0.0.1). -u keeps the "Serving HTTP ... port NNNN" line unbuffered.
  ( cd "$serve_dir" && python3 -u -m http.server --bind 127.0.0.1 0 >"$TMP/serve.log" 2>&1 ) &
  serve_pid=$!
  # Wait for the port to appear in the server log ("... port 59867 (http://...) ...").
  port=""
  for _ in $(seq 1 40); do
    port=$(sed -n 's/.*[[:space:]]port[[:space:]]\([0-9][0-9]*\)[[:space:]].*/\1/p' "$TMP/serve.log" 2>/dev/null | head -1)
    [ -n "$port" ] && break
    sleep 0.1
  done
  if [ -n "$port" ]; then
    # Defective fixture: expect >=1 console error.
    PALATE_CAPTURE_NO_SANDBOX="${PALATE_CAPTURE_NO_SANDBOX:-1}" \
      node "$SHOOTER" --url "http://127.0.0.1:$port/defective.html" --out "$TMP/shots-def" --label def --sections >/dev/null 2>&1
    cerr=$(jq -r '(.console_errors // 0)' "$TMP/shots-def/manifest.json" 2>/dev/null || echo 0)
    if [ "${cerr:-0}" -ge 1 ]; then ok "live: defective fixture records >=1 console error ($cerr)"; else bad "live: defective fixture should record a console error (got $cerr)"; fi
    # And a real retina PNG on disk.
    if [ -s "$TMP/shots-def/desktop-full.png" ]; then ok "live: defective fixture captured a desktop PNG"; else bad "live: defective fixture should capture a PNG"; fi

    # Clean fixture: expect 0 console errors.
    PALATE_CAPTURE_NO_SANDBOX="${PALATE_CAPTURE_NO_SANDBOX:-1}" \
      node "$SHOOTER" --url "http://127.0.0.1:$port/clean.html" --out "$TMP/shots-clean" --label clean --sections >/dev/null 2>&1
    cerr=$(jq -r '(.console_errors // 0)' "$TMP/shots-clean/manifest.json" 2>/dev/null || echo 0)
    if [ "${cerr:-0}" -eq 0 ]; then ok "live: clean fixture records 0 console errors"; else bad "live: clean fixture should be error-free (got $cerr)"; fi
  else
    echo "skip - live screenshot arm: could not start a local server"
  fi
  kill "$serve_pid" >/dev/null 2>&1
  wait "$serve_pid" 2>/dev/null
else
  echo "skip - live screenshot arm: Playwright/Chromium or python3 not available (ARM A is the contract)"
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
