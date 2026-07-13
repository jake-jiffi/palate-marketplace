#!/usr/bin/env bash
# Tests the "done" gate (scripts/gate-done.sh): the three FAIL-OPEN skip cases, the
# BLOCK on failed evidence, and the PASS on real evidence. The gate reads artefacts
# (verify-report.json + .palate-shots/*) relative to the manifest's directory, so each
# case builds a throwaway project dir under a tmp root.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-done.sh"
DEEP="$DIR/fixtures/manifest-deep.json"   # a manifest that PASSES the depth floor
pass=0; fail=0

check() { # desc  expected_exit  manifest_path  [extra env assignments...]
  local desc="$1" want="$2" manifest="$3"; shift 3
  env "$@" bash "$GATE" "$manifest" >/dev/null 2>&1
  local ec=$?
  if [ "$ec" -eq "$want" ]; then echo "ok   - $desc"; pass=$((pass+1));
  else echo "FAIL - $desc (exit $ec, want $want)"; fail=$((fail+1)); fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- FAIL-OPEN 1: no manifest -> skip (exit 0) -------------------------------
check "no manifest -> skip" 0 "$TMP/no-such.json"

# --- FAIL-OPEN 2: manifest with zero MCP calls -> skip (MCP not connected) ----
NOMCP="$TMP/nomcp"; mkdir -p "$NOMCP"
echo '{"schema":3,"mcp_calls":[],"files_written":["src/pages/index.astro"]}' > "$NOMCP/build-manifest.json"
check "MCP not connected -> skip" 0 "$NOMCP/build-manifest.json"

# --- FAIL-OPEN 3: MCP calls but no dist/ and no verify-report.json -> skip ----
NOREND="$TMP/norender"; mkdir -p "$NOREND"
cp "$DEEP" "$NOREND/build-manifest.json"   # has >=1 mcp_call, passes depth
check "no renderable preview -> skip" 0 "$NOREND/build-manifest.json"

# Shared helper: drop a screenshot artefact (a non-empty PNG + manifest + errors).
make_shots() { # <proj-dir> <console_errors>
  local proj="$1" cerr="$2"
  mkdir -p "$proj/.palate-shots/desktop"
  # A minimal valid 1x1 PNG so the on-disk-evidence check finds a real file.
  printf '\x89PNG\r\n\x1a\n' > "$proj/.palate-shots/desktop-full.png"
  printf '\x89PNG\r\n\x1a\n' > "$proj/.palate-shots/mobile-full.png"
  echo "{\"status\":\"captured\",\"console_errors\":$cerr,\"shots\":{\"desktop_full\":\"desktop-full.png\"}}" > "$proj/.palate-shots/manifest.json"
  echo '[]' > "$proj/.palate-shots/errors.json"
}

# --- BLOCK: verifier verdict fail -> exit 2 ----------------------------------
BLOCK="$TMP/block"; mkdir -p "$BLOCK"
cp "$DEEP" "$BLOCK/build-manifest.json"
make_shots "$BLOCK" 0
cat > "$BLOCK/verify-report.json" <<'JSON'
{ "verdict": "fail",
  "visual": { "ran": true, "pass": false, "console_errors": 0,
    "iterations": [ { "i": 1, "axes": { "philosophy": 2 }, "defects": [ { "type": "overflow", "location": "hero mobile" } ], "score": 18,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png" } } ] },
  "shots_dir": ".palate-shots" }
JSON
check "verifier verdict fail -> block" 2 "$BLOCK/build-manifest.json"

# --- BLOCK: console error on the render -> exit 2 (thrown build = visual fail) -
CERR="$TMP/cerr"; mkdir -p "$CERR"
cp "$DEEP" "$CERR/build-manifest.json"
make_shots "$CERR" 2   # 2 console errors recorded by the screenshot driver
cat > "$CERR/verify-report.json" <<'JSON'
{ "verdict": "pass",
  "visual": { "ran": true, "pass": true, "console_errors": 0,
    "iterations": [ { "i": 1, "axes": { "philosophy": 5 }, "score": 28,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png" } } ] },
  "shots_dir": ".palate-shots" }
JSON
check "console errors on render -> block" 2 "$CERR/build-manifest.json"

# --- BLOCK: visual pass but NO screenshot on disk -> exit 2 (evidence, not assertion) -
NOPNG="$TMP/nopng"; mkdir -p "$NOPNG/.palate-shots"
cp "$DEEP" "$NOPNG/build-manifest.json"
echo '{"status":"captured","console_errors":0}' > "$NOPNG/.palate-shots/manifest.json"
cat > "$NOPNG/verify-report.json" <<'JSON'
{ "verdict": "pass", "visual": { "ran": true, "pass": true, "console_errors": 0, "iterations": [] }, "shots_dir": ".palate-shots" }
JSON
check "visual pass with no PNG on disk -> block" 2 "$NOPNG/build-manifest.json"

# --- PASS: real evidence, verdict pass, screenshots on disk, zero errors -> exit 0 -
PASS="$TMP/pass"; mkdir -p "$PASS"
cp "$DEEP" "$PASS/build-manifest.json"
make_shots "$PASS" 0
cat > "$PASS/verify-report.json" <<'JSON'
{ "verdict": "pass",
  "visual": { "ran": true, "pass": true, "console_errors": 0,
    "iterations": [ { "i": 1, "axes": { "philosophy": 5, "hierarchy": 4, "execution": 4, "specificity": 4, "restraint": 4, "variety": 4 }, "score": 25,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png", "mobile_full": ".palate-shots/mobile-full.png" } } ] },
  "shots_dir": ".palate-shots" }
JSON
check "real pass evidence -> pass" 0 "$PASS/build-manifest.json"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
