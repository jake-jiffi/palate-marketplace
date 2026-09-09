#!/usr/bin/env bash
# The Stop hook REPORTS what the gates said, on a build that passed.
#
# THE FAULT THIS PINS. Both gate calls ran with stdio ["ignore","ignore","pipe"], so on exit 0
# every word the gates printed was discarded: the done gate's summary line (which names each
# sub-gate and whether it ran) went to stdout and was thrown away, and a sub-gate that SKIPPED
# said so into the same void. A build where the ship-ready, SEO, uniqueness and Explore checks
# all skipped is then indistinguishable, in the transcript, from a build where every one of them
# ran and passed. That is the whole failure class this repo keeps paying for: a gate that was
# blocked reads exactly like a gate that passed.
#
# AND STDERR IS NOT WHERE THE OPERATOR LOOKS. The Claude Code hooks reference is explicit:
# "Stderr from a hook that exits 0 goes to the debug log only, never the transcript, and Claude
# never sees it." The documented channel is `systemMessage` in a JSON object on stdout, which
# for a Stop hook with `continue` unset is "shown to the user in the transcript instead". So the
# summary must travel there, and the stderr copy stays for `--debug`.
#
# So: on a PASSING build the hook must forward the done gate's summary and any skip line, on
# both channels.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$DIR/../../hooks/palate-stop.mjs"
pass=0; fail=0

want() { # <desc> <haystack> <needle>
  if printf '%s' "$2" | grep -qF "$3"; then echo "ok   - $1"; pass=$((pass+1));
  else echo "FAIL - $1 (no '$3' in output)"; fail=$((fail+1)); fi
}

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# A build the done gate PASSES: deep manifest (clears the depth floor), a screenshot on disk,
# a shots manifest with no console errors, and a verifier report with verdict pass.
T="$TMP/site"; mkdir -p "$T/.palate-shots"
cp "$DIR/fixtures/manifest-deep.json" "$T/build-manifest.json"
printf '\x89PNG\r\n\x1a\n' > "$T/.palate-shots/desktop-full.png"
printf '{"status":"captured","console_errors":0,"shots":{"desktop_full":"desktop-full.png"}}' \
  > "$T/.palate-shots/manifest.json"
cat > "$T/verify-report.json" <<'JSON'
{ "verdict": "pass",
  "visual": { "ran": true, "pass": true, "console_errors": 0,
    "iterations": [ { "i": 1, "axes": { "philosophy": 5, "hierarchy": 4, "execution": 4, "specificity": 4, "restraint": 4, "variety": 4 }, "score": 25,
      "shots": { "desktop_full": ".palate-shots/desktop-full.png" } } ] },
  "shots_dir": ".palate-shots" }
JSON

# HOME is redirected so the suite does not append to the real cross-build log.
run_hook() { # -> stdout on fd 1, stderr captured into $err_file
  (cd "$T" && printf '{"hook_event_name":"Stop","cwd":"%s"}' "$T" \
    | env HOME="$TMP/home" node "$HOOK" 2>"$TMP/stderr")
}
mkdir -p "$TMP/home"
sout="$(run_hook)"
serr="$(cat "$TMP/stderr")"

want "the done gate's summary reaches the debug log on a pass" "$serr" "Done gate"
want "and the sub-gates that skipped are named there"          "$serr" "explore=skipped"

# STDOUT MUST BE ONE VALID JSON OBJECT AND NOTHING ELSE. A parse failure here is not cosmetic:
# the hook protocol reads this stream, so trailing text would break the hook itself.
msg="$(printf '%s' "$sout" | node -e '
let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try { const o = JSON.parse(raw); console.log(typeof o.systemMessage === "string" ? o.systemMessage : ""); }
  catch { console.log("__NOT_JSON__"); }
});' 2>/dev/null)"

if [ "$msg" = "__NOT_JSON__" ]; then
  echo "FAIL - stdout is one valid JSON object (got: $sout)"; fail=$((fail+1))
else
  echo "ok   - stdout is one valid JSON object"; pass=$((pass+1))
fi
want "the summary reaches the USER through systemMessage" "$msg" "Done gate"
want "and the skips travel with it"                       "$msg" "explore=skipped"

# The tail is an INDENTED continuation of the summary, and it has to travel with it.
want "the indented Passed tail travels too" "$msg" "Passed: visual=pass"

# --- A NOTE'S INDENTED LINES ARE PART OF THE NOTE ---------------------------------------
# On a build with zero MCP calls the gate prints two headlines and seven indented lines saying
# what went unchecked, why, and the command that reconnects the MCP. The filter matched
# headlines only, so the operator learned that none of it was gated and nothing about what to
# do next: the useful half was dropped one line after the alarming half.
U="$TMP/ungrounded"; mkdir -p "$U"
printf '{"schema":3,"mcp_calls":[],"files_written":["src/pages/index.astro"]}' > "$U/build-manifest.json"
printf '{"verdict":"pass","visual":{"ran":true,"pass":true,"console_errors":0,"iterations":[]}}' > "$U/verify-report.json"
uout="$(cd "$U" && printf '{"hook_event_name":"Stop","cwd":"%s"}' "$U" \
  | env HOME="$TMP/home" node "$HOOK" 2>/dev/null)"
umsg="$(printf '%s' "$uout" | node -e '
let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try { console.log(JSON.parse(raw).systemMessage || ""); } catch { console.log("__NOT_JSON__"); }
});' 2>/dev/null)"
want "the ungrounded headline reaches the user" "$umsg" "ZERO Palate MCP calls"
want "and so does what went unchecked"          "$umsg" "Unchecked:"
want "and the command that fixes it"            "$umsg" "claude mcp add"

# --- THE NO-JQ SKIP SAYS HOW TO FIX IT, AND BOTH GATES ARE HEARD -------------------------
# Without jq every gate is off. The operator saw one line with no remedy, and the depth gate's
# own skip was dropped entirely because the filter wanted "skipped(" and that line says
# "skipped:".
NOJQ="$TMP/nojq-bin"; mkdir -p "$NOJQ"
for c in node bash find wc tr sed grep cat ls dirname basename mktemp rm printf awk; do
  src="$(command -v "$c" 2>/dev/null)" && ln -sf "$src" "$NOJQ/$c" 2>/dev/null
done
jout="$(cd "$T" && printf '{"hook_event_name":"Stop","cwd":"%s"}' "$T" \
  | env PATH="$NOJQ" HOME="$TMP/home" "$(command -v node)" "$HOOK" 2>/dev/null)"
jmsg="$(printf '%s' "$jout" | node -e '
let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try { console.log(JSON.parse(raw).systemMessage || ""); } catch { console.log("__NOT_JSON__"); }
});' 2>/dev/null)"
want "the no-jq skip says how to fix it"        "$jmsg" "brew install jq"
want "and the depth gate's own skip is heard"   "$jmsg" "MCP-depth gate skipped:"

# --- THE RELEASE NOTICE IS THE ONE THE OPERATOR MOST NEEDS -------------------------------
# It is the moment the hook stops standing in the way of a build with failures still on disk,
# and it reached the debug log alone. PALATE_STOP_MAX_BLOCKS=1 drives the latch past its bound
# in two Stops rather than four.
R="$TMP/release"; mkdir -p "$R/.palate-shots"
cp "$DIR/fixtures/manifest-deep.json" "$R/build-manifest.json"
printf '\x89PNG\r\n\x1a\n' > "$R/.palate-shots/desktop-full.png"
printf '{"status":"captured","console_errors":2,"shots":{"desktop_full":"desktop-full.png"}}' > "$R/.palate-shots/manifest.json"
printf '{"verdict":"pass","visual":{"ran":true,"pass":true,"console_errors":2,"iterations":[]}}' > "$R/verify-report.json"
rmsg=""
for _ in 1 2 3; do
  rout="$(cd "$R" && printf '{"hook_event_name":"Stop","cwd":"%s"}' "$R" \
    | env HOME="$TMP/home" PALATE_STOP_MAX_BLOCKS=1 PALATE_STOP_MAX_TOTAL=1 node "$HOOK" 2>/dev/null)"
  rmsg="$(printf '%s' "$rout" | node -e '
let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try { console.log(JSON.parse(raw).systemMessage || ""); } catch { console.log(""); }
});' 2>/dev/null)"
  printf '%s' "$rmsg" | grep -qF "RELEASING" && break
done
want "the release notice reaches the user" "$rmsg" "RELEASING"

# --- SO DOES THE MISSING-SHELL NOTE ------------------------------------------------------
# On Windows without WSL every gate here is a shell script that cannot run, and the note saying
# so is the entire experience. It went to the debug log.
NOBASH="$TMP/nobash-bin"; mkdir -p "$NOBASH"
ln -sf "$(command -v node)" "$NOBASH/node" 2>/dev/null
bout="$(cd "$T" && printf '{"hook_event_name":"Stop","cwd":"%s"}' "$T" \
  | env PATH="$NOBASH" HOME="$TMP/home" "$(command -v node)" "$HOOK" 2>/dev/null)"
bmsg="$(printf '%s' "$bout" | node -e '
let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try { console.log(JSON.parse(raw).systemMessage || ""); } catch { console.log(""); }
});' 2>/dev/null)"
want "the missing-shell note reaches the user" "$bmsg" "Palate gates were SKIPPED, not passed"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
