#!/usr/bin/env bash
# The SELF-HEAL LOOP around the BUILD HYGIENE score, driven end to end against a real browser
# and a real page.
#
# hygiene-loop.test.mjs covers the arithmetic. This covers the thing that actually has to work:
# a deliberately generic page is served, the gate blocks it, the message tells an agent what
# to fix and what to re-run, the page is then repaired IN PLACE at the same URL, and the next
# run has to report the gain. Five states, in the order a real build hits them:
#
#   1. FIRST     - blocked, ranked gaps, the exact re-run command, no invented baseline
#   2. UNCHANGED - the same page re-measured must NOT read as progress
#   3. STALLED   - a third flat run stops the loop and names what is frozen
#   4. IMPROVING - the repaired page reports the gain, and the denominator caveat with it
#   5. REGRESSED - putting the fault back reports a regression and says to revert
#
# Plus the two silent-skip paths (a corrupt history, no --out), which must SPEAK, and the
# hand-off to hooks/palate-stop.mjs, which must surface the grade message even when it is
# buried behind other failures.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
VR="$DIR/../reference-capture/verify-rendered.mjs"
STOP="$DIR/../../hooks/palate-stop.mjs"
FIX="$DIR/fixtures/hygiene-loop"
PORT="${HYGIENE_LOOP_PORT:-8791}"
TMP="$(mktemp -d)"; SRV="$TMP/srv"; OUT="$TMP/out"
mkdir -p "$SRV" "$OUT"
pass=0; fail=0

check() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then echo "ok   - $desc"; pass=$((pass + 1));
  else echo "FAIL - $desc (got '$got', want '$want')"; fail=$((fail + 1)); fi
}
has() { # has <desc> <file> <pattern>
  grep -qE "$3" "$2" && check "$1" yes yes || check "$1" no yes
}
hasnt() {
  grep -qE "$3" "$2" && check "$1" yes no || check "$1" no no
}

# A python3 that is only a licence prompt serves nothing, and a fixture server that never
# bound is how this test would measure whatever else happens to hold the port. Resolve a
# working interpreter and prove the fixture is being served before measuring anything.
PY=""
for c in python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 python; do
  command -v "$c" >/dev/null 2>&1 || continue
  "$c" -c 'import http.server' >/dev/null 2>&1 && { PY="$c"; break; }
done
[ -n "$PY" ] || { echo "hygiene-loop.test: no working python3 with http.server; the fixture cannot be served. NOT a pass." >&2; exit 2; }

cp "$FIX/generic/index.html" "$SRV/index.html"
# A PER-RUN MARKER, because "is something serving?" is the wrong question. Both fixtures say
# Northgate, and a leftover server from an earlier run of THIS test serves a Northgate page from
# a different docroot, so the old guard passed while every `cp` went to a directory nobody was
# serving. That reads as a code failure (trends vanish, the page never changes) and is not one.
# Same class as the 1400ms hero capture: the check was satisfied by something plausible instead
# of by the actual thing. The marker is unique to this run, so only OUR server can answer it.
MARKER="hygiene-loop-$$-$RANDOM"
# An EMPTY marker would make the check below `[ "" = "" ]`, which a failed curl also satisfies -
# the guard would then pass on exactly the condition it exists to catch. Assert it is non-empty
# and that the file really landed, so the comparison can only ever be against a real value.
[ -n "$MARKER" ] || { echo "hygiene-loop.test: could not mint a run marker. NOT a pass." >&2; exit 2; }
printf '%s' "$MARKER" > "$SRV/.run-marker"
[ "$(cat "$SRV/.run-marker" 2>/dev/null)" = "$MARKER" ] \
  || { echo "hygiene-loop.test: the run marker did not write to $SRV. NOT a pass." >&2; exit 2; }
# `exec` so the subshell BECOMES python: without it $! is the subshell's pid, the trap kills
# the wrapper, and the server is left holding the port for the next run of this test.
(cd "$SRV" && exec "$PY" -m http.server "$PORT" >/dev/null 2>&1) &
SRV_PID=$!
trap 'kill $SRV_PID 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(curl -fsS "http://localhost:$PORT/.run-marker" 2>/dev/null)" = "$MARKER" ] && break
  sleep 0.5
done
[ "$(curl -fsS "http://localhost:$PORT/.run-marker" 2>/dev/null)" = "$MARKER" ] || {
  echo "hygiene-loop.test: port $PORT is serving something that is NOT this run's fixture dir" >&2
  echo "  (a leftover server from an earlier run, or another process). Kill it, or set HYGIENE_LOOP_PORT. NOT a pass." >&2
  exit 2; }

# THE MARKER IS RE-ASSERTED BEFORE EVERY RUN, not just at setup.
#
# Twice now this suite has reported a cluster of content failures - "the regression is not
# reported", "the corrupt history is not spoken" - that were nothing of the kind: the fixture
# server had stopped serving partway through, so every later run measured nothing and every
# later assertion failed on absent output. The code was correct both times, and both times it
# cost a debugging cycle to prove it.
#
# A dead instrument must not be able to report content failures. Checking the marker before each
# run converts that into one accurate sentence naming the step it died at, and voids the suite
# (exit 2) rather than failing it, because a suite that could not measure has not failed - it has
# not run. Same rule the gate itself applies to a missing axe-core.
run() {
  [ "$(curl -fsS "http://localhost:$PORT/.run-marker" 2>/dev/null)" = "$MARKER" ] || {
    echo "hygiene-loop.test: the fixture server stopped serving this run's docroot before step '$1'." >&2
    echo "  Every assertion after this point would fail on absent output and none of them would mean anything." >&2
    echo "  The suite is VOID, not failed. Re-run it." >&2
    exit 2; }
  node "$VR" --url "http://localhost:$PORT" --routes / --out "$OUT" --no-vitals >/dev/null 2>"$TMP/$1.err"
}
HIST="$OUT/hygiene-history.json"

# --- 1. FIRST: blocked, with everything an agent needs to act -------------------
run r1
has "1. blocked below the bar"                     "$TMP/r1.err" "BLOCKED"
has "1. names the score for what it IS"            "$TMP/r1.err" "build hygiene [0-9]+/100 is below the 80 floor"
hasnt "1. never calls it a projected grade"        "$TMP/r1.err" "projected grade"
has "1. states it is not the public grade"         "$TMP/r1.err" "It is NOT the public grade"
has "1. says the disagreement is measured"         "$TMP/r1.err" "measured to disagree with it substantially"
has "1. points at the shareable grader"            "$TMP/r1.err" "palatemcp.com/grade"
has "1. no invented baseline on the first run"     "$TMP/r1.err" "FIRST MEASUREMENT"
has "1. ranked gaps carry points and a fix"        "$TMP/r1.err" "^  - .*\(worth [0-9.]+ pts of the hygiene score\).*FIX: "
has "1. says to fix and RE-RUN"                    "$TMP/r1.err" "RE-RUN THIS EXACT COMMAND"
has "1. gives the exact command"                   "$TMP/r1.err" "verify-rendered\.mjs --url http://localhost:$PORT --routes / --out .* --no-vitals"
has "1. says the design half is not included"      "$TMP/r1.err" "not included in THIS number"
n=$(node -e "console.log(require('$HIST').entries.length)")
check "1. one history entry persisted" "$n" "1"

# The stop hook samples the head of interaction.json. The grade entry carries the whole loop,
# so it must be first: behind five axe rows the agent never sees it.
first=$(node -e "console.log(require('$OUT/interaction.json').interaction_failures[0].rule)")
check "1. the hygiene entry leads interaction.json" "$first" "hygiene-below-floor"
msgok=$(node -e "const f=require('$OUT/interaction.json').interaction_failures;
  console.log(f.every(x=>typeof x.msg==='string'&&x.msg.length>20))")
check "1. every blocking entry still carries an actionable msg" "$msgok" "true"

# --- 2. UNCHANGED: re-measuring the same page is not progress ------------------
run r2
has "2. a flat re-run reads UNCHANGED"             "$TMP/r2.err" "UNCHANGED: [0-9]+ -> [0-9]+, a move of 0 \(iteration 2"
has "2. and says why a small move is noise"        "$TMP/r2.err" "noise, not progress"
hasnt "2. never reports it as improvement"         "$TMP/r2.err" "IMPROVING"
has "2. per-gap movement is reported"              "$TMP/r2.err" "\[unchanged since last run\]"

# --- 3. STALLED: the loop is bounded ------------------------------------------
run r3
has "3. a third flat run is a stall"               "$TMP/r3.err" "STALLED: 3 iterations"
has "3. tells the agent to stop iterating"         "$TMP/r3.err" "STOP ITERATING"
has "3. names the frozen checks with a number"     "$TMP/r3.err" "stuck at [0-9.]+ across all 3 runs"
has "3. says the checks are mechanical, not taste" "$TMP/r3.err" "MECHANICAL"
has "3. offers the escalation, not another pass"   "$TMP/r3.err" "hand it to the human"
has "3. and a recorded way out"                    "$TMP/r3.err" "PALATE_MIN_HYGIENE="
# A stall must not release the gate: "it stopped improving" is not "it is good enough".
stalled_block=$(node -e "const f=require('$OUT/interaction.json').interaction_failures;
  const g=f.find(x=>x.rule==='hygiene-below-floor'); console.log(!!g && g.stalled===true)")
check "3. a stalled build STILL blocks" "$stalled_block" "true"

# --- 4. IMPROVING: repair the page in place, at the same URL -------------------
cp "$FIX/better/index.html" "$SRV/index.html"
run r4
has "4. the repaired page reports the gain"        "$TMP/r4.err" "IMPROVING: [0-9]+ -> [0-9]+, UP [0-9]+ \(iteration 4"
has "4. and now clears the floor"                  "$TMP/r4.err" "CLEARS the 80 floor"
# Repairing the contrast violation removes text_contrast from the scored set. That must not
# make the run incomparable (the bug this loop was rewritten to avoid), but it must be said.
has "4. discloses the denominator change"          "$TMP/r4.err" "part of this move is the denominator"
hasnt "4. a successful fix is never incomparable"  "$TMP/r4.err" "NO COMPARISON"
up=$(node -e "const e=require('$HIST').entries; console.log(e[3].overall > e[2].overall + 2)")
check "4. the persisted score really rose" "$up" "true"
# THE FIXTURE THAT CLEARS THE FLOOR IS A TIDY TEMPLATE: three identical bordered card grids,
# stock marketing copy, no idea in it anywhere. It scores in the 90s because the two checks that
# detect templating (originality 30, signature move 15) cannot be computed locally. That is the
# instrument's real limit, so the pass message has to say so at the moment an agent would stop.
has "4. the pass says it is not a quality verdict" "$TMP/r4.err" "NOT A QUALITY VERDICT"
has "4. and names templating as unmeasured"        "$TMP/r4.err" "cannot see whether the page is a template"
has "4. and sends the remaining work to design"    "$TMP/r4.err" "the remaining work is DESIGN"
# Repairing the page REMOVED the accessibility dimension from the denominator, because axe checks
# only enter the roll-up when they fire. So the basis thins as the score rises: 52 -> 40 across
# these two fixtures. Worst possible pairing, and the pass message has to name it.
has "4. warns the clean basis is THINNER"          "$TMP/r4.err" "rests on LESS evidence, not more"
has "4. and quotes this run's real weight"         "$TMP/r4.err" "this run rests on 40 of the rubric.s 100 weight"
before=$(node -e "const e=require('$HIST').entries; console.log(e[2].measuredWeight)")
after=$(node -e "const e=require('$HIST').entries; console.log(e[3].measuredWeight)")
check "4. the basis really shrank when repaired ($before -> $after)" "$((before > after))" "1"
hasnt "4. the block path stays free of it"         "$TMP/r1.err" "NOT A QUALITY VERDICT"

# --- 5. REGRESSED: put the fault back -----------------------------------------
cp "$FIX/generic/index.html" "$SRV/index.html"
run r5
has "5. reports the regression"                    "$TMP/r5.err" "REGRESSED: [0-9]+ -> [0-9]+, DOWN [0-9]+ \(iteration 5"
has "5. and says to revert"                        "$TMP/r5.err" "revert it before trying something else"
hasnt "5. a real move after a gain is not a stall" "$TMP/r5.err" "STALLED"

# --- 6. FAIL LOUD: a lost trend must never read as a clean one -----------------
printf 'not json{' > "$HIST"
run r6
has "6. a corrupt history is spoken, not swallowed" "$TMP/r6.err" "The trend is LOST, not clean"
node "$VR" --url "http://localhost:$PORT" --routes / --no-vitals >/dev/null 2>"$TMP/r7.err"
has "7. no --out says the trend cannot be reported" "$TMP/r7.err" "no --out, so no hygiene history was kept"

# A typo'd bar used to disable the gate in silence: NaN fails both `> 0` and `<= 0`.
PALATE_MIN_HYGIENE=eighty node "$VR" --url "http://localhost:$PORT" --routes / --out "$OUT" --no-vitals >/dev/null 2>"$TMP/r8.err"
has "7b. a non-numeric floor is named, not obeyed"  "$TMP/r8.err" 'PALATE_MIN_HYGIENE="eighty" is not a number'
has "7b. and the gate still blocks"                 "$TMP/r8.err" "BLOCKED"
PALATE_MIN_HYGIENE=0 node "$VR" --url "http://localhost:$PORT" --routes / --out "$OUT" --no-vitals >/dev/null 2>"$TMP/r9.err"
has "7c. an OFF gate says so"                       "$TMP/r9.err" "the build-hygiene gate is OFF"
hasnt "7c. and never claims a pass"                 "$TMP/r9.err" "CLEARS the"
hasnt "7c. no spurious deprecation notice"          "$TMP/r9.err" "DEPRECATED"
# The pre-rename name is still HONOURED, loudly. Silently ignoring it would block at 80 someone
# who set PALATE_MIN_GRADE=0 expecting the gate off: the same silent-skip class, reintroduced.
PALATE_MIN_GRADE=0 node "$VR" --url "http://localhost:$PORT" --routes / --out "$OUT" --no-vitals >/dev/null 2>"$TMP/r10.err"
has "7d. the old env var is honoured"               "$TMP/r10.err" "the build-hygiene gate is OFF"
has "7d. and named as deprecated"                   "$TMP/r10.err" "PALATE_MIN_GRADE is DEPRECATED"

# --- 8. HAND-OFF: the stop hook must surface the grade message -----------------
# Buried behind five other failures, the one message that closes the loop still has to reach
# the agent. palate-stop samples three entries; it hoists this one explicitly.
P="$TMP/proj"; mkdir -p "$P/.palate-shots"
printf '{"files_written":["src/pages/index.astro"]}' > "$P/build-manifest.json"
printf '{"console_errors":0,"overflow":{"desktop":0},"sections":[]}' > "$P/.palate-shots/manifest.json"
printf '{"verdict":"pass","visual":{"pass":true,"console_errors":0}}' > "$P/verify-report.json"
node -e "
const fs=require('fs');
const noise=[1,2,3,4,5].map(i=>({route:'/',viewport:'desktop',rule:'color-contrast',check:'text_contrast',msg:'a11y color-contrast violation number '+i}));
const grade={route:'/',viewport:'all',rule:'hygiene-below-floor',check:'build_hygiene',score:21,stalled:false,msg:'build hygiene 21/100 is below the 80 floor. NOW: fix the gaps above, rebuild, then RE-RUN THIS EXACT COMMAND'};
fs.writeFileSync('$P/.palate-shots/interaction.json',JSON.stringify({interaction_failures:[...noise,grade]}));"
out=$(printf '{"cwd":"%s"}' "$P" | PALATE_GATE_OFF= node "$STOP" 2>/dev/null)
echo "$out" | grep -q '"decision":"block"' && d=block || d=allow
check "8. the stop hook blocks" "$d" "block"
echo "$out" | grep -q 'build hygiene 21/100' && r=yes || r=no
check "8. and surfaces the hygiene message from position 6" "$r" "yes"
echo "$out" | grep -q 'RE-RUN the command in that message' && r=yes || r=no
check "8. with the instruction to re-run" "$r" "yes"

echo "----"
echo "hygiene-loop.test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
