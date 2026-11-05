#!/usr/bin/env bash
# STRICT MODE COUNTS UP, so its block is bounded.
#
# THE FAULT THIS PINS. The latch exists, in the hook's own words, so that strict mode is not "an
# unbounded block loop". It was one. The positive-evidence branch cleared the latch whenever the
# evidence list was empty, and a GATE failure is empty-evidence by definition, so every strict
# Stop cleared the previous latch and gateFailure wrote a fresh one at 1. Seven Stops on the same
# failed capture all blocked and the stored latch read {"unchanged":1,"total":1} after each.
#
# The clear now drops only a latch whose stored reasons were EVIDENCE reasons.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$DIR/../../hooks/palate-stop.mjs"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home"

# A build the DONE GATE fails while the evidence detector finds nothing: a failed capture beside
# a stale PNG. gate-done refuses it; positiveFailures reads no console errors and no verdict:fail.
P="$TMP/site"; mkdir -p "$P/.palate-shots"
cp "$DIR/fixtures/manifest-deep.json" "$P/build-manifest.json"
printf '\x89PNG\r\n\x1a\n' > "$P/.palate-shots/desktop-full.png"
printf '{"status":"failed","error":"browser launch failed","console_errors":0}' > "$P/.palate-shots/manifest.json"
printf '{"verdict":"pass","visual":{"ran":true,"pass":true,"console_errors":0,"iterations":[]}}' > "$P/verify-report.json"

stop() {
  (cd "$P" && printf '{"hook_event_name":"Stop","cwd":"%s"}' "$P" \
    | env HOME="$TMP/home" PALATE_GATE_STRICT=1 node "$HOOK" 2>/dev/null)
}

blocks=0; released=0
for i in 1 2 3 4 5 6 7; do
  out="$(stop)"
  if printf '%s' "$out" | grep -qF '"decision":"block"'; then
    blocks=$((blocks + 1))
  elif printf '%s' "$out" | grep -qF 'RELEASING'; then
    released=$i
    break
  fi
done

if [ "$released" -gt 0 ]; then
  echo "ok   - strict mode reaches the release path (stop $released of 7)"; pass=$((pass+1))
else
  echo "FAIL - strict mode reaches the release path (7 blocks, latch never counted up)"; fail=$((fail+1))
fi

# The counter is the mechanism, so read it rather than trusting the outcome.
unchanged="$(node -e '
try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).stop_gate?.unchanged ?? 0); }
catch { console.log(0); }' "$P/build-manifest.json" 2>/dev/null)"
if [ "${unchanged:-0}" -gt 1 ] || [ "$released" -gt 0 ]; then
  echo "ok   - the latch counts up across strict Stops"; pass=$((pass+1))
else
  echo "FAIL - the latch counts up across strict Stops (stuck at $unchanged)"; fail=$((fail+1))
fi

# AND THE GATE LATCH IS DROPPED ONCE THE GATE PASSES.
#
# Nothing dropped it. `total` never resets, so after one release cycle the site sat at
# {"kind":"gate","total":7} against MAX_TOTAL_BLOCKS 6, and the NEXT failure of that build,
# a different one, was released on its first Stop instead of blocked. Strict mode stopped
# blocking that manifest for good: the previous defect made it block forever, this one made it
# block three times and then never again.
printf '{"status":"captured","console_errors":0,"shots":{"desktop_full":"desktop-full.png"}}' > "$P/.palate-shots/manifest.json"
stop >/dev/null 2>&1   # a clean strict Stop
gate_latch="$(node -e '
try { const g = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).stop_gate;
      console.log(g ? `${g.kind}:${g.total}` : "gone"); }
catch { console.log("unreadable"); }' "$P/build-manifest.json" 2>/dev/null)"
if [ "$gate_latch" = "gone" ]; then
  echo "ok   - a passing Stop drops the spent gate latch"; pass=$((pass+1))
else
  echo "FAIL - a passing Stop drops the spent gate latch (latch is $gate_latch)"; fail=$((fail+1))
fi

# A DIFFERENT failure on the same build must get the full three blocks again.
rm -f "$P/.palate-shots/desktop-full.png"   # no screenshot evidence: a new reason, same build
blocks2=0; released2=0
for i in 1 2 3 4 5 6 7; do
  out="$(stop)"
  if printf '%s' "$out" | grep -qF '"decision":"block"'; then
    blocks2=$((blocks2 + 1))
  elif printf '%s' "$out" | grep -qF 'RELEASING'; then
    released2=$i
    break
  fi
done
if [ "$blocks2" -eq 3 ] && [ "$released2" -eq 4 ]; then
  echo "ok   - a new failure after a release cycle blocks three times before releasing"; pass=$((pass+1))
else
  echo "FAIL - a new failure after a release cycle blocks three times before releasing (blocked $blocks2, released at $released2)"; fail=$((fail+1))
fi

# AND THE EVIDENCE LATCH STILL CLEARS. That is what the branch was for: once the console errors
# are fixed, the next Stop must start from zero rather than inherit a spent counter.
E="$TMP/evidence"; mkdir -p "$E/.palate-shots"
cp "$DIR/fixtures/manifest-deep.json" "$E/build-manifest.json"
printf '\x89PNG\r\n\x1a\n' > "$E/.palate-shots/desktop-full.png"
printf '{"status":"captured","console_errors":2,"shots":{"desktop_full":"desktop-full.png"}}' > "$E/.palate-shots/manifest.json"
printf '{"verdict":"pass","visual":{"ran":true,"pass":true,"console_errors":2,"iterations":[]}}' > "$E/verify-report.json"
(cd "$E" && printf '{"hook_event_name":"Stop","cwd":"%s"}' "$E" | env HOME="$TMP/home" node "$HOOK" >/dev/null 2>&1)
# Now fix the evidence and Stop again: the latch must be gone.
printf '{"status":"captured","console_errors":0,"shots":{"desktop_full":"desktop-full.png"}}' > "$E/.palate-shots/manifest.json"
printf '{"verdict":"pass","visual":{"ran":true,"pass":true,"console_errors":0,"iterations":[]}}' > "$E/verify-report.json"
(cd "$E" && printf '{"hook_event_name":"Stop","cwd":"%s"}' "$E" | env HOME="$TMP/home" node "$HOOK" >/dev/null 2>&1)
latched="$(node -e '
try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).stop_gate ? "present" : "gone"); }
catch { console.log("unreadable"); }' "$E/build-manifest.json" 2>/dev/null)"
if [ "$latched" = "gone" ]; then
  echo "ok   - an evidence latch still clears once the evidence does"; pass=$((pass+1))
else
  echo "FAIL - an evidence latch still clears once the evidence does (latch is $latched)"; fail=$((fail+1))
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
