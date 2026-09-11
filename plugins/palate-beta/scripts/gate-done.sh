#!/usr/bin/env bash
# scripts/gate-done.sh - the "done" gate. Makes "done" machine-checkable from
# EVIDENCE, not narration.
#
# A build is only DONE when the real artefacts prove it: the visual loop ran and
# passed (screenshots exist on disk, zero console errors, every rubric axis cleared
# the bar), the fresh-context palate-verifier ran and returned verdict:pass, and (when
# applicable) the novelty gate passed. It reads the ARTEFACTS directly
# (verify-report.json, .palate-shots/*) - never a manifest boolean an LLM could have
# set. That is the whole point: anti-reward-hacking.
#
# Exit 0 = pass OR skip, 2 = block (with a specific reason on stderr). Like
# gate-mcp-depth.sh this script only DECIDES; whether a block is ENFORCED is up to the
# caller. The Stop hook nudges by default and only hard-blocks under
# PALATE_GATE_STRICT=1; PALATE_GATE_OFF=1 disables it entirely.
#
# KEEP THE FLOOR: it runs gate-mcp-depth.sh first, unchanged, and fails if depth fails.
#
# KEEP FAIL-OPEN (the non-negotiable invariant): it can only BLOCK when it could
# actually run - i.e. when the MCP is connected (>=1 mcp_call, same ladder as the
# depth gate) AND a renderable preview exists (dist/ built OR verify-report.json
# present). Absent either, it SKIPS (exit 0). A public-plugin user whose token is not
# set, who is editing an existing app, or whose preview cannot render is NEVER trapped.
set -euo pipefail

MANIFEST="${1:-build-manifest.json}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPTH_GATE="$HERE/gate-mcp-depth.sh"
NOVELTY_GATE="$HERE/gate-novelty.mjs"   # Move 1 (may not exist yet; treated fail-open)

# THE PROJECT DIR IS NOT ALWAYS THE MANIFEST'S DIR, and assuming it was turned this whole gate
# off on a real client build. A repo can hold the manifest at its root while the Astro site (and
# therefore dist/, .palate-shots/ and verify-report.json) lives one level down; the manifest
# already RECORDS where the project is, in `.project`, written by the hook from the build cwd.
# Reading the path off the filesystem instead meant every artefact check resolved to a directory
# that contained none of them, the render rung found no preview, and the gate skipped clean while
# eight fully-built variants sat one directory away. Prefer the recorded path, fall back to the
# manifest's own directory when it is absent, unreadable or not a directory.
PROJ="$(cd "$(dirname "$MANIFEST")" 2>/dev/null && pwd || echo .)"
if command -v jq >/dev/null 2>&1 && [ -f "$MANIFEST" ]; then
  recorded="$(jq -r '(.project // empty)' "$MANIFEST" 2>/dev/null || true)"
  if [ -n "$recorded" ] && [ -d "$recorded" ]; then
    PROJ="$(cd "$recorded" && pwd)"
  fi
fi
REPORT="$PROJ/verify-report.json"
SHOTS_DIR="$PROJ/.palate-shots"
SHOTS_MANIFEST="$SHOTS_DIR/manifest.json"
SHOTS_ERRORS="$SHOTS_DIR/errors.json"

# THE SUMMARY LINE COUNTS ITS SKIPS BEFORE IT SAYS PASSED.
#
# "Done gate passed: ... shipready=skipped(...), seo=skipped(...), explore=pass, ..." was one
# sentence beginning with the word "passed" and carrying, several clauses later, the news that
# most of the suite had not run. Nobody reads to the end of that line, and the whole point of
# this file is that a gate which was blocked must not read like a gate that passed. So the count
# comes first, the skips are named with their reasons, and "Passed:" only appears after it.
GATES_RAN=0
GATES_SKIPPED=0
SKIP_REASONS=""
gate_ran() { GATES_RAN=$((GATES_RAN + 1)); }
gate_skipped() { # <name> <reason>
  GATES_SKIPPED=$((GATES_SKIPPED + 1))
  SKIP_REASONS="${SKIP_REASONS:+$SKIP_REASONS; }$1: $2"
}

fail() { echo "Done gate FAILED: $1" >&2; exit 2; }
# STDERR, like fail() and ungrounded(). Every caller spawns this with
# stdio: ["ignore","ignore","pipe"], so a skip written to STDOUT is DISCARDED: no jq, no
# manifest, or no renderable preview then turns the whole gate suite off and the transcript
# is indistinguishable from a clean pass. A gate that was blocked is not a gate that passed.
skip() { echo "Done gate skipped: $1" >&2; exit 0; }

# ONE PREDICATE, NOT EIGHT PARSERS. Every sub-gate below used to have its own hand-written
# reader for "did that skip, pass or fail", matching five different spellings of a skip, three
# cleanings of a reason and two opposite rules for an exit code the gate does not define. Three
# of the defects this file has shipped lived in that duplication. scripts/lib/gate-protocol.sh
# is where the dialects are written down now, once, with the reason each exists.
GATE_PROTOCOL="$HERE/lib/gate-protocol.sh"
[ -f "$GATE_PROTOCOL" ] \
  || skip "scripts/lib/gate-protocol.sh is missing, so nothing here can read its own sub-gates. Reinstall the plugin."
# shellcheck source=lib/gate-protocol.sh
. "$GATE_PROTOCOL"

# The verdict gate_classify reached, turned into a summary note and a count.
#
# A PARTIAL COUNTS AS RAN. A gate that read three routes, found them clean and could not judge
# a fourth did not skip, and filing it as one is the mirror image of the defect this whole file
# exists to close: it reads as "SEO was never checked" on the commonest state of any Palate site
# that has not published a post yet.
GATE_NOTE=""
gate_record() { # <name> <pass-note> <fail-message>
  case "$GATE_VERDICT" in
    pass)    GATE_NOTE="$1=$2"; gate_ran ;;
    partial) GATE_NOTE="$1=partial (${GATE_REASON})"; gate_ran ;;
    skip)    GATE_NOTE="$1=skipped"; gate_skipped "$1" "$GATE_REASON" ;;
    *)       fail "$3" ;;
  esac
}

# --- FAIL-OPEN LADDER (mirrors gate-mcp-depth.sh:32-35, plus one render rung) ---
# Never block closed when there is nothing to gate.
JQ_FIX="jq is not installed, so every gate below is OFF. Install it and re-run: brew install jq (macOS), apt install jq (Debian/Ubuntu), winget install jqlang.jq (Windows)."
command -v jq >/dev/null 2>&1 || skip "$JQ_FIX"
[ -f "$MANIFEST" ] || skip "no $MANIFEST (no tracked build, or the Palate MCP is not in use)."

mcpcalls=$(jq '((.mcp_calls // []) | length)' "$MANIFEST" 2>/dev/null || echo 0)
if [ "${mcpcalls:-0}" -lt 1 ]; then
  # Fail-open is preserved (we still SKIP, never block here). But if source files
  # were written with ZERO Palate MCP calls, the most likely cause is the MCP is
  # not connected or was renamed (e.g. after a plugin upgrade), so the skill built
  # without the taste layer. Speak the connect/restart reminder UNCONDITIONALLY
  # (not only under strict) so the silent fail-open is no longer silent.
  fileswritten=$(jq '((.files_written // []) | length)' "$MANIFEST" 2>/dev/null || echo 0)
  if [ "${fileswritten:-0}" -ge 1 ]; then
    echo "Done gate: source files were written but ZERO Palate MCP calls were recorded." >&2
    echo "  The build ran WITHOUT the Palate taste layer - the MCP is likely not connected or was renamed (e.g. after a plugin upgrade)." >&2
    echo "  Reconnect: claude mcp add --scope user --transport http palate https://mcp.palatemcp.com/api/mcp" >&2
    echo "  Then restart Claude Code (or run /mcp and reconnect) so the mcp__palate__* tools load." >&2
  fi
  # A SKIP THAT LOOKS LIKE A SHRUG IS THE PROBLEM. On a real client build this line was the only
  # thing printed while EIGHT fully-built variants, a dist/ and a passing verify-report sat on
  # disk: the visual loop, the ship-ready checks, uniqueness and the bold bar were all silently
  # off because one manifest field was empty. Fail-open is kept (this still exits 0 and blocks
  # nothing), but when the evidence says a real build happened, say what went unchecked.
  if [ "${fileswritten:-0}" -ge 1 ] || [ -d "$PROJ/dist" ] || [ -f "$REPORT" ]; then
    echo "Done gate: a real build is present here, and NONE of it was gated." >&2
    echo "  Unchecked: the visual loop + rubric, console errors, ship-ready (unresolved {{TOKENS}}, Explore left live, photos never measured), variant uniqueness, and the bold bar." >&2
    echo "  Cause: build-manifest.json records zero Palate MCP calls, which is the ladder every gate hangs off." >&2
    echo "  If the survey DID run, its calls never reached this manifest (a subagent, a different project dir, or a manifest replaced after the calls were recorded). Check manifest.project resolves to the site: $PROJ" >&2
  fi
  skip "no Palate MCP calls recorded (MCP not connected, or surveyed in a subagent); cannot gate done."
fi

# NEW rung beyond the depth gate: a render must be possible for visual/verifier to
# mean anything. If neither a built dist/ nor a verify-report.json exists, the gate
# could not have run, so it SKIPS rather than blocks (render impossible != failure).
[ -d "$PROJ/dist" ] || [ -f "$REPORT" ] \
  || skip "no renderable preview (no dist/ and no verify-report.json); cannot judge visual/verifier."

# --- KEEP THE FLOOR: the MCP-depth gate runs first and must pass ---------------
# Capture its stderr so a depth failure surfaces the real reason through this gate.
# EXIT-CODE AWARE, not `if !`: the depth gate has THREE states (0 pass, 2 block,
# 3 UNGROUNDED). Treating any non-zero as a failure would turn the non-blocking third
# state into a hard block here, which is the exact inversion it exists to prevent. In
# practice the ladder above already skips a zero-call build before this line, so 3 is
# unreachable today; handling it keeps the two ladders in agreement if either trigger
# ever widens, and surfaces the label instead of dropping it.
set +e
depth_err="$(bash "$DEPTH_GATE" "$MANIFEST" 2>&1 1>/dev/null)"
depth_ec=$?
set -e
case "$depth_ec" in
  0) ;;
  3) echo "Done gate: ${depth_err}" >&2 ;;
  *) fail "MCP-depth gate did not pass. ${depth_err}" ;;
esac

# --- DIVERGE wall (build-site-scoped): a BUILD SITE that skipped DIVERGE is CAUGHT,
# not silently fail-open. This mirrors the PreToolUse write-gate at done-time. It is
# scoped to an ACTIVE BUILD SITE by the .palate-skill-state.json marker (written only
# by the BUILD SITE flow), so a non-build session, a BUILD BRAND session or an ordinary
# edit is NEVER trapped (no marker => the block is skipped, the existing fail-open holds).
# gate-novelty.mjs --require-diverge is the done-time mirror of the write-gate predicate.
if [ -f "$PROJ/.palate-skill-state.json" ] && [ -f "$NOVELTY_GATE" ]; then
  if ! diverge_err="$(node "$NOVELTY_GATE" --require-diverge --manifest "$MANIFEST" 2>&1 1>/dev/null)"; then
    fail "DIVERGE gate did not pass. ${diverge_err}"
  fi
fi

# --- EVIDENCE 1: the VISUAL LOOP ran AND passed (read the artefacts) -----------
# Read verify-report.json (computed by the verifier from real pixels), NOT a manifest
# boolean. The render itself is double-checked against the on-disk screenshots and the
# screenshot driver's own console-error count.
[ -f "$REPORT" ] || fail "Visual loop did not run: no verify-report.json. Spawn palate-verifier (fresh context) to run the visual loop and write the report before calling the build done."

# verify-report.json must be valid JSON.
jq -e . "$REPORT" >/dev/null 2>&1 || fail "verify-report.json is not valid JSON; the verifier did not complete a clean run."

vran=$(jq -r '(.visual.ran // false)' "$REPORT")
vpass=$(jq -r '(.visual.pass // false)' "$REPORT")
verr_report=$(jq -r '(.visual.console_errors // 0)' "$REPORT")

[ "$vran" = "true" ] || fail "Visual loop did not run (.visual.ran is not true in verify-report.json)."

# A FAILED CAPTURE IS NOT EVIDENCE, and this has to be read BEFORE the PNGs are counted. The
# files on disk outlive the run that wrote them, so a capture that threw (or a browser that
# never launched) leaves the PREVIOUS run's screenshots sitting exactly where the count looks.
# Counting them answered "did a capture ever happen here", never "did THIS one succeed". The
# driver records its own verdict; an ABSENT status is not judged, because an older shots
# manifest predates the field and absence is not evidence of failure.
if [ -f "$SHOTS_MANIFEST" ]; then
  shots_status=$(jq -r '(.status // "")' "$SHOTS_MANIFEST" 2>/dev/null || echo "")
  case "$shots_status" in
    ""|captured|ok) ;;
    *)
      shots_why=$(jq -r '(.error // ((.notes // []) | join("; ")) // "")' "$SHOTS_MANIFEST" 2>/dev/null || echo "")
      fail "shots manifest reports failed capture (status \"$shots_status\"${shots_why:+: $shots_why}). Any PNG beside it is from an earlier run and is NOT evidence for this one. Fix the cause and re-run scripts/reference-capture/screenshot-build.mjs before the visual loop can pass."
      ;;
  esac
fi

# EVIDENCE not assertion: a screenshot must exist ON DISK. A report claiming visual
# pass with no captured PNG is rejected (the verifier may not pass without real pixels).
shot_count=$(find "$SHOTS_DIR" -maxdepth 2 -type f -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
[ "${shot_count:-0}" -ge 1 ] || fail "Visual loop has no screenshot evidence: no PNG under $SHOTS_DIR. The verifier must capture and read real pixels (scripts/reference-capture/screenshot-build.mjs) before visual can pass."

# Console errors are an automatic visual fail. Prefer the screenshot driver's own
# count (the live truth off the running page) over the report's recorded number.
# PRESENT, not defaulted. `(.console_errors // 0)` read an ABSENT field as a clean render, so
# a shots manifest written by anything other than the capture driver silently overrode a
# report that had recorded errors. verify-rendered.mjs now writes its per-route record into
# this same file and creates it when the capture has not run yet, which makes that reachable.
console_errors="$verr_report"
if [ -f "$SHOTS_MANIFEST" ]; then
  sc=$(jq -r 'if has("console_errors") and (.console_errors != null) then .console_errors else "" end' "$SHOTS_MANIFEST" 2>/dev/null || echo "")
  console_errors="${sc:-$verr_report}"
fi
[ "${console_errors:-0}" -eq 0 ] || fail "Visual loop has $console_errors console error(s) on the rendered page (see $SHOTS_ERRORS). A thrown build cannot pass; fix the runtime error and re-render."

# --- HOW MUCH OF THE SITE THE LAST SWEEP ACTUALLY COVERED ----------------------
# A pass from a run that rendered one route of twelve used to be indistinguishable from a
# pass from one that rendered all twelve, because nothing wrote the coverage down. It is
# NOT a failure: the incremental skip is the whole point of the fix loop, and blocking on a
# partial sweep would delete the optimisation. It is a LEGIBILITY problem, so the summary
# line says which it was instead of implying the larger one.
#
# The shots manifest is the authority (verify-rendered.mjs writes it, and screenshot-build.mjs
# carries it forward rather than clobbering it); verify-report.json is the fallback, and it is
# second because the verifier AGENT writes that file and this gate reads artefacts, not
# narration. Absent from both, the answer is "unrecorded", which is the honest one for a run
# that predates the field.
sweep_note="last sweep unrecorded"
sweep_json=""
if [ -f "$SHOTS_MANIFEST" ]; then
  sweep_json=$(jq -c 'if (.sweep | type) == "object" then .sweep else empty end' "$SHOTS_MANIFEST" 2>/dev/null || echo "")
fi
if [ -z "$sweep_json" ] && [ -f "$REPORT" ]; then
  sweep_json=$(jq -c 'if (.sweep | type) == "object" then .sweep else empty end' "$REPORT" 2>/dev/null || echo "")
fi
if [ -n "$sweep_json" ]; then
  sw_full=$(printf '%s' "$sweep_json" | jq -r '(.full // false)' 2>/dev/null || echo false)
  sw_sel=$(printf '%s' "$sweep_json" | jq -r '(.selected // 0)' 2>/dev/null || echo 0)
  sw_rend=$(printf '%s' "$sweep_json" | jq -r '(.rendered // 0)' 2>/dev/null || echo 0)
  sw_skip=$(printf '%s' "$sweep_json" | jq -r '(.skipped // 0)' 2>/dev/null || echo 0)
  sw_narrow=$(printf '%s' "$sweep_json" | jq -r '(.narrowed // "")' 2>/dev/null || echo "")
  [ "$sw_narrow" = "null" ] && sw_narrow=""
  sw_cap=$(printf '%s' "$sweep_json" | jq -r '(.over_cap // 0)' 2>/dev/null || echo 0)
  if [ "$sw_full" = "true" ]; then
    sweep_note="last sweep full, ${sw_rend} route(s)"
  else
    sweep_note="last sweep PARTIAL, ${sw_rend} of ${sw_sel} route(s) rendered"
    [ "${sw_skip:-0}" -gt 0 ] && sweep_note="$sweep_note, ${sw_skip} unchanged and skipped"
    [ -n "$sw_narrow" ] && sweep_note="$sweep_note, narrowed by --${sw_narrow}"
    [ "${sw_cap:-0}" -gt 0 ] && sweep_note="$sweep_note, ${sw_cap} over --max-routes"
  fi
fi

# --- EVIDENCE 1b: the COMPOSITION FLOOR (references/composition-and-attention.md) ---
# A stranded focal (the page's most important element in the dead bottom-left fallow),
# or a section whose visual weight is piled away from its focal, is a High composition
# finding. The squint metric scores every per-section clip the driver captured; a High
# blocks done, so an obviously unbalanced hero cannot pass under "no Critical or High".
# It is a FLOOR against BROKEN composition, never a centring rule (a bold, off-centre
# hero where the eye resolves to the action passes). Fail-open: only runs when
# per-section clips + focals exist (older shots without sections simply skip it).
COMPOSITION="$HERE/reference-capture/measure-composition.mjs"
if [ -f "$SHOTS_MANIFEST" ] && [ -f "$COMPOSITION" ] \
   && [ "$(jq -r '((.sections // []) | length)' "$SHOTS_MANIFEST" 2>/dev/null || echo 0)" -ge 1 ]; then
  if ! comp_err="$(node "$COMPOSITION" --manifest "$SHOTS_MANIFEST" 2>&1 1>/dev/null)"; then
    fail "Composition floor did not pass. ${comp_err} The most important element of the section must sit where attention lands, not stranded in the dead bottom-left fallow (references/composition-and-attention.md). Re-place the focal, re-render, re-verify."
  fi
fi

[ "$vpass" = "true" ] || fail "Visual loop did not pass: verify-report.json .visual.pass is not true. An axis fell below the bar or a defect was found - revise the named section, re-render, and re-verify (cap 2-3 iterations then escalate)."

# --- EVIDENCE 2: the VERIFIER ran AND passed -----------------------------------
verdict=$(jq -r '(.verdict // "fail")' "$REPORT")
[ "$verdict" = "pass" ] || fail "Verifier verdict is '$verdict' (not pass). Fix the named gate findings in verify-report.json and re-run the fresh-context palate-verifier."

# --- EVIDENCE 4 (THE BOLD BAR): v1.5 ambition gates, HIGH-INTENSITY-scoped + fail-open ---
# A high-intensity commission (manifest.commission.intensity == "high") binds the bold bar: the
# build must WIN a blinded pairwise vs a flagship library exemplar, CLEAR the ambition dock-list
# (or have every remaining bar-losing gap human-accepted), and have BUILT Explore routes. These
# bind ONLY for high-intensity builds - a calm build keeps the lighter floor and is NEVER held to
# them. Each sub-gate is independently fail-open: ABSENT evidence SKIPS with a reminder, it never
# traps; only an EXPLICIT loss / non-clearance / collapse blocks. Disable with PALATE_GATE_BOLD=0.
intensity=$(jq -r '(.commission.intensity // "calm")' "$MANIFEST" 2>/dev/null || echo calm)
iter_count=$(jq -r '((.visual.iterations // []) | length)' "$REPORT" 2>/dev/null || echo 0)
ITER_CAP="${PALATE_ITER_CAP:-3}"
case "$ITER_CAP" in ''|*[!0-9]*) ITER_CAP=3 ;; esac   # numeric-only, so a garbage env never errors the [ ] test
# Item 7 escalation: at/over the cap with the bar unmet, pull the human in instead of looping.
if [ "${iter_count:-0}" -ge "$ITER_CAP" ]; then
  escalate="iteration $iter_count >= cap $ITER_CAP with the bar UNMET: ESCALATE to the human now with verify-report.json (the pairwise result + the dock_list) and .palate-shots/ attached; do NOT loop again."
else
  escalate="revise the named gap, re-render, and re-verify (cap $ITER_CAP, then escalate)."
fi

# INTENSITY IS A CLOSED ENUM AND AN OFF-ENUM VALUE FAILS TOWARD TIMID, SILENTLY.
# A real build recorded intensity "confident": not "high", not "calm", so `= "high"` was false,
# the bold bar never bound, the pairwise ambition test never ran, and the build quietly got the
# calm floor. Nothing said a word. The agent writes this field in prose, so a plausible synonym
# (confident, considered, assured) is the likely case rather than the rare one. Say it out loud
# and treat it as HIGH: the failure mode of a wrongly-bold build is a loud gate, and the failure
# mode of a wrongly-calm one is a timid site nobody can explain.
case "${intensity:-}" in
  high|calm|"") ;;
  *)
    echo "Done gate: commission.intensity is \"$intensity\", which is not \"high\" or \"calm\". The bold bar reads this field exactly, so an off-enum value would silently take the calm path. Treating it as HIGH. Record \"high\" or \"calm\" in the commission." >&2
    intensity="high"
    ;;
esac

if [ "${PALATE_GATE_BOLD:-1}" = "1" ] && [ "$intensity" = "high" ]; then
  # (a) blinded pairwise vs a flagship library exemplar (the real ambition test)
  pw_ran=$(jq -r '(.pairwise.ran // false)' "$REPORT" 2>/dev/null || echo false)
  if [ "$pw_ran" = "true" ]; then
    pw_won=$(jq -r '(.pairwise.won // false)' "$REPORT" 2>/dev/null || echo false)
    pw_against=$(jq -r '(.pairwise.against // "?")' "$REPORT" 2>/dev/null || echo "?")
    [ "$pw_won" = "true" ] || fail "Bold bar: the build LOST the blinded pairwise vs the flagship exemplar '$pw_against' - it is not the one a designer would deliver to a client. $escalate"
  else
    echo "Done gate: high-intensity build but no pairwise comparison ran (.pairwise.ran != true). The bold ambition bar is UNPROVEN - run the blinded pairwise in palate-verifier step 6. (Fail-open: not blocking on its absence.)" >&2
  fi

  # (b) the ambition dock-list: cleared, or every remaining bar-losing gap is human-accepted
  amb_clears=$(jq -r 'if .ambition == null then "absent" elif (.ambition.clears == true) then "true" else "false" end' "$REPORT" 2>/dev/null || echo absent)
  if [ "$amb_clears" = "false" ]; then
    unaccepted=$(jq -r '[(.ambition.dock_list // [])[] | select((.human_accepted // false) != true)] | length' "$REPORT" 2>/dev/null || echo 0)
    [ "${unaccepted:-0}" -eq 0 ] || fail "Bold bar: the ambition bar is NOT cleared and $unaccepted dock-list gap(s) are not human-accepted - a judge would still dock this. $escalate"
  elif [ "$amb_clears" = "absent" ]; then
    echo "Done gate: high-intensity build but no ambition block in verify-report.json. The bold ambition bar is UNPROVEN. (Fail-open: not blocking on its absence.)" >&2
  fi

  # (c) built Explore (the surprise engine): a bold brief must not collapse to one concept
  explore_skip=$(jq -r '(.commission.explore_skip // false)' "$MANIFEST" 2>/dev/null || echo false)
  if [ "${PALATE_GATE_EXPLORE:-1}" = "1" ] && [ "$explore_skip" != "true" ]; then
    # PALATE_MIN_BOARDS, default 3. Explore builds BOARDS now, not eight complete pages, so the
    # floor moved with the unit of work: three rungs is the fewest a client can point BETWEEN.
    # PALATE_MIN_VARIANTS is still honoured for a site mid-flight on the old shape.
    MIN_BOARDS="${PALATE_MIN_BOARDS:-${PALATE_MIN_VARIANTS:-3}}"
    case "$MIN_BOARDS" in ''|*[!0-9]*) MIN_BOARDS=3 ;; esac   # numeric-only, so a garbage env can't wrongly block
    nvar=$(jq -r '(((.explore.boards // []) | length) as $b | ((.variants // []) | length) as $v | if $b > $v then $b else $v end)' "$MANIFEST" 2>/dev/null || echo 0)
    [ "${nvar:-0}" -ge "$MIN_BOARDS" ] || fail "Bold bar: Explore collapsed to concept-level - a high-intensity brief built only ${nvar:-0} board(s) (need >= $MIN_BOARDS). Build the distinct rungs, or record commission.explore_skip=true with the named-direction reason. $escalate"
  fi
fi

# --- EVIDENCE 3 (NOVELTY): Move 1 is wired - gate-novelty.mjs now exists ---------
# The DIVERGE/CONVERGE spine + scripts/gate-novelty.mjs (Move 1) are live, so novelty
# is required by DEFAULT (PALATE_GATE_NOVELTY defaults to 1). gate-novelty.mjs is
# itself fully FAIL-OPEN: its CONVERGE pre-check skips (exit 0) when DIVERGE did not
# run, and its build-level / type-face-recurrence check skips (exit 0) with <2 rendered
# variants or no build history. So it can only BLOCK on a real novelty failure (a
# safe-only converge, a near-repeat build, or a recurring display face) and never traps
# a build that has nothing to compare. Set PALATE_GATE_NOVELTY=0 to disable it entirely.
REQUIRE_NOVELTY="${PALATE_GATE_NOVELTY:-1}"
if [ "$REQUIRE_NOVELTY" = "1" ] && [ -f "$NOVELTY_GATE" ]; then
  # BOTH STREAMS. gate-novelty prints "novelty gate skipped: ..." and "novelty gate passed: ..."
  # to STDOUT and exits 0 for each, so reading stderr alone could not tell them apart and this
  # counted a skip as a gate that ran. On the suite's own deep fixture it skips ("no diverge
  # block"), which is one of the nine, on the very line this epic rebuilt to stop that.
  if novelty_out="$(node "$NOVELTY_GATE" --manifest "$MANIFEST" 2>&1)"; then novelty_rc=0; else novelty_rc=$?; fi
  gate_classify novelty "$novelty_rc" "$novelty_out"
  gate_record novelty pass "Novelty gate did not pass. ${novelty_out}"
  novelty_note="$GATE_NOTE"
elif [ ! -f "$NOVELTY_GATE" ]; then
  novelty_note="novelty=skipped"
  gate_skipped novelty "gate-novelty.mjs not present"
else
  novelty_note="novelty=skipped"
  gate_skipped novelty "switched off with PALATE_GATE_NOVELTY=0"
fi

# SHIP-READY: the seam between "built" and "deliverable". A build can be visually
# perfect and still carry eight rejected concept homepages into the client's sitemap, a
# literal {{HUMBLYTICS_SITE_ID}} in a third-party script tag, and photographs nobody ever
# measured. All three shipped on a real build that passed every other gate here, because
# nothing owned that seam.
SHIPREADY_GATE="$HERE/gate-shipready.mjs"
shipready_note="shipready=skipped"
shipready_skip="gate-shipready.mjs not present"
if [ -f "$SHIPREADY_GATE" ]; then
  # The `if` form, never a bare assignment: a non-zero command substitution in an assignment
  # is fatal wherever errexit is in force, which killed this block before the case below was
  # ever reached and turned every "cannot check" into a silent exit with no message at all.
  if shipready_err="$(node "$SHIPREADY_GATE" "$PROJ" 2>&1)"; then shipready_rc=0; else shipready_rc=$?; fi
  # A REFUSAL IS NOT A SKIP, and it is the one thing the shared predicate cannot know. The gate
  # was pointed at the Palate plugin rather than a site, so the answer is WRONG rather than
  # absent, and nothing downstream should read on.
  case "${shipready_err%%$'\n'*}" in
    "gate-shipready: refused:"*|"refused:"*) fail "Not ready to hand over. ${shipready_err}" ;;
  esac
  gate_classify shipready "$shipready_rc" "$shipready_err"
  gate_record shipready pass "Not ready to hand over. ${shipready_err}"
  shipready_note="$GATE_NOTE"
else
  gate_skipped shipready "$shipready_skip"
fi

# THE WEBSITE KIT. Four gates, because a forty-five piece section library fails in four ways
# and every one of them is silent. gate-kit-tokens keeps a shared markup library from homogenising every site
# built with it (a piece owns structure and states, the brand owns the surface). gate-kit-complete
# keeps the manifest and the components from drifting, so Compose can never pick a section that
# cannot render, and a declared state can never go unimplemented. gate-client-imagery catches the
# build that harvests a client's photographs and then uses none of them, measured at 149 harvested
# and zero used on a real build with nothing reporting a fault. gate-kit-fixtures reads the BUILT
# state pages and checks that every sentence a state fixture supplies actually reached one: a
# fixture is a plain object, so a wrong key name renders nothing, silently, and reads as a broken
# component. One did, and only this check could have found it.
# THE NOTES ARE CAPTURED, NOT DISCARDED. Every sub-gate contributes a `name=...` entry to the
# Passed line, and gate-done.test.sh asserts the headline count equals the number of names in it,
# because a count that stops describing the line beneath it is how a gate goes quiet. Adding
# three gates without adding their notes broke exactly that assertion, which is the test working.
kit_tokens_note="kit-tokens=skipped"
kit_complete_note="kit-complete=skipped"
kit_fixtures_note="kit-fixtures=skipped"
imagery_note="client-imagery=skipped"
for kit_gate in kit-tokens kit-complete kit-fixtures client-imagery; do
  KIT_GATE="$HERE/gate-${kit_gate}.mjs"
  if [ -f "$KIT_GATE" ]; then
    if kit_err="$(node "$KIT_GATE" "$PROJ" 2>&1)"; then kit_rc=0; else kit_rc=$?; fi
    gate_classify "$kit_gate" "$kit_rc" "$kit_err"
    gate_record "$kit_gate" pass "${kit_err}"
  else
    gate_skipped "$kit_gate" "gate-${kit_gate}.mjs not present"
    GATE_NOTE="${kit_gate}=skipped"
  fi
  case "$kit_gate" in
    kit-tokens)     kit_tokens_note="$GATE_NOTE" ;;
    kit-complete)   kit_complete_note="$GATE_NOTE" ;;
    kit-fixtures)   kit_fixtures_note="$GATE_NOTE" ;;
    client-imagery) imagery_note="$GATE_NOTE" ;;
  esac
done

# SEO: the crawl surface. A build can be visually perfect, ship-ready and still be
# undiscoverable: rejected Explore variants indexed, dynamic routes absent from the sitemap,
# a preview inviting indexing of the client's content at a non-canonical domain. It lived only
# in /sweep, which is a monthly pass somebody has to run, so nothing checked it at done-time.
SEO_GATE="$HERE/gate-seo.mjs"
seo_note="seo=skipped"
if [ -f "$SEO_GATE" ]; then
  if seo_err="$(node "$SEO_GATE" "$PROJ" 2>&1)"; then seo_rc=0; else seo_rc=$?; fi
  # Exit 2 is CANNOT CHECK and it is never a pass, but it is not always a skip either: with
  # routes read and clean and one dynamic route unjudgeable, gate-seo prints a `partial (...)`
  # verdict and gate_classify counts it as a gate that RAN. The shared predicate also owns the
  # two traps this branch used to carry inline: an advisory line precedes the verdict by
  # construction, so the LAST `gate-seo: ` line is the verdict; and a cannot-check report opens
  # with a header and names the actual unknown two lines below it.
  gate_classify seo "$seo_rc" "$seo_err"
  gate_record seo pass "SEO gate did not pass. ${seo_err}"
  seo_note="$GATE_NOTE"
else
  gate_skipped seo "gate-seo.mjs not present"
fi

# HEADLESS: is this Shopify storefront actually constructed correctly?
#
# Silent on every non-commerce build: without .palate/catalogue.json it exits 2 having checked
# nothing, so a brochure site is never judged against a commerce contract. --no-cli because the
# done gate must not shell out to npx on every build; the CLI checks belong to the setup step.
HEADLESS_GATE="$HERE/gate-headless.mjs"
headless_note="headless=skipped"
if [ -f "$HEADLESS_GATE" ]; then
  # THE REASON IS THE GATE'S, NOT THIS SHELL'S. "not a commerce build" was hardcoded over all
  # three of that gate's exit-2 paths, so a REAL storefront whose .palate/catalogue.json is
  # corrupt was filed as a brochure site and sixty-odd commerce checks were silently marked not
  # applicable. The gate says which of the three it was; this reads it.
  if hl_err="$(node "$HEADLESS_GATE" "$PROJ" --no-cli 2>&1)"; then hl_rc=0; else hl_rc=$?; fi
  gate_classify headless "$hl_rc" "$hl_err"
  gate_record headless pass "Headless storefront is not correctly constructed. ${hl_err}"
  headless_note="$GATE_NOTE"
else
  gate_skipped headless "gate-headless.mjs not present"
fi

# CUSTOMER ACCOUNTS: a customer-account flow ships tokens, so it fails toward account takeover
# rather than toward an ugly page. Silent (exit 0, scope "none") on any build with no account
# surface, so it never speaks on a brochure site or on a storefront that sensibly linked out to
# Shopify's hosted pages instead.
CA_GATE="$HERE/gate-customer-auth.mjs"
ca_note="customer-auth=skipped"
if [ -f "$CA_GATE" ]; then
  if ca_err="$(node "$CA_GATE" "$PROJ" 2>&1)"; then ca_rc=0; else ca_rc=$?; fi
  gate_classify customer-auth "$ca_rc" "$ca_err"
  gate_record customer-auth pass "Customer-account flow is unsafe. ${ca_err}"
  ca_note="$GATE_NOTE"
else
  gate_skipped customer-auth "gate-customer-auth.mjs not present"
fi

# FACT CONSISTENCY: does the site contradict itself?
#
# An engineer's 3,400-page build said "42 reviews" in some places and "41 reviews" in others,
# and nothing noticed. The single-source rule this repo already has is about PROVENANCE (one
# record, every surface reads it) and is silent on CONSISTENCY, because a number typed into two
# hand-written pages was never in the record to begin with.
#
# ADVISORY, AND THAT IS THE WHOLE POINT: it NEVER calls fail(). Two numbers can legitimately
# differ (a second location, a per-branch figure) and blocking a build on a judgement a gate
# cannot make is how a useful check gets switched off. Every non-zero exit, expected or not, is
# folded in as a skip with its reason, so an unexpected crash costs the count and never a build.
FACTS_GATE="$HERE/gate-facts.mjs"
facts_note="facts=skipped"
facts_skip="gate-facts.mjs not present"
# A COUNT WITH NO ROUTE TO THE DETAIL IS A FINDING NOBODY CAN ACT ON, which is the shape this
# whole epic is closing. "facts=2 disagreement(s)" tells an operator something is wrong and not
# what, and only somebody who already knows this script exists can find out. So the summary
# carries the command, the way the MCP rung above carries `claude mcp add`. Empty unless there
# is something to look at, and it leads with a newline so it lands as its own INDENTED line:
# the Stop hook forwards a matched headline's indented continuation lines, so it travels with
# the summary rather than being dropped.
facts_detail=""
if [ -f "$FACTS_GATE" ]; then
  if facts_err="$(node "$FACTS_GATE" "$PROJ" 2>&1)"; then facts_rc=0; else facts_rc=$?; fi
  facts_first="${facts_err%%$'\n'*}"
  facts_first="${facts_first#gate-facts: }"
  # NOT gate_record: this gate is ADVISORY and never calls fail(), so it needs its own note
  # vocabulary (clean / N disagreement(s)) and its own detail line. It still uses the shared
  # predicate for the skip cases below, so the reason is read and cleaned exactly like the rest.
  case "$facts_rc" in
    0) case "$facts_first" in
         clean*) facts_note="facts=clean"; facts_skip="" ;;
         [0-9]*disagreement*)
           facts_note="facts=${facts_first%% *} disagreement(s)"; facts_skip=""
           facts_detail=$'\n'"  Facts: ${facts_first%% *} label(s) carry two values across pages. Advisory, nothing is blocked. See both values and a page carrying each: node \"$FACTS_GATE\" \"$PROJ\"" ;;
         # Exit 0 with a line this shell does not recognise is the gate having changed its
         # wording, not the site being clean. Say so rather than printing a bill of health.
         *) facts_skip="gate-facts printed an unrecognised result" ;;
       esac
       # A LABEL SET ASIDE AS A LIST IS NOT NOTHING, and "facts=clean" over one reads as a bill
       # of health. The gate suppresses a label carrying more than three values (a rating per
       # product card, a phone per branch) because reporting those is the false alarm that gets
       # a check switched off, and a genuine clash can hide underneath one. So the count travels
       # with the command that prints the values, on its own indented line like the one above.
       facts_aside=""
       [ -z "$facts_skip" ] && facts_aside="$(printf '%s' "$facts_first" | sed -n 's/.*[^0-9]\([0-9][0-9]*\) label(s) set aside.*/\1/p' | head -1)"
       if [ -n "${facts_aside:-}" ]; then
         facts_detail="$facts_detail"$'\n'"  Facts: ${facts_aside} label(s) set aside as a list rather than a claim (a rating per card, a phone per branch). See their values: node \"$FACTS_GATE\" \"$PROJ\" --all"
       fi ;;
    # Every non-zero exit, expected or not, is a skip with its reason: an unexpected crash
    # costs the count and never a build. That rule is now the shared predicate's default for
    # every gate, and this branch is where it was first written down.
    *) gate_classify facts "$facts_rc" "$facts_err"
       facts_skip="$GATE_REASON"
       [ -n "$facts_skip" ] || facts_skip="gate-facts exited $facts_rc" ;;
  esac
  [ -n "$facts_skip" ] && facts_skip="$(gate_reason_clean "$facts_skip")"
fi
if [ -n "$facts_skip" ]; then gate_skipped facts "$facts_skip"; else gate_ran; fi

# UNIQUENESS: the variants must be genuinely different, not ritually varied.
#
# THIS GATE HAD NO DETERMINISTIC CALLER, alone in the suite. The verifier agent was told to run
# it, which means it ran when a model remembered to, and every other gate here is called by a
# script. It could not have had one before: the scaffold is SSR from the first file, so `dist/`
# holds no HTML and there was nothing on disk to compare. Two real client builds confirmed it,
# zero .html files between them. screenshot-build.mjs now writes the rendered markup beside each
# variant's screenshots, so the comparison has something real to read.
#
# Fail-open exactly like the rest: fewer than two rendered variants means nothing to compare.
UNIQ_GATE="$HERE/gate-uniqueness.mjs"
uniq_note="uniqueness=skipped"
if [ -f "$UNIQ_GATE" ]; then
  # THE GATE FINDS ITS OWN RENDERS. This shell used to glob `.palate-shots/v*/rendered.html`
  # alone, so the direction boards (which land in `.palate/explore/shots/b*/`) were invisible to
  # it and every board build reported "fewer than 2 to compare" with five renders on disk.
  if uniq_err="$(node "$UNIQ_GATE" --project "$PROJ" 2>&1)"; then uniq_rc=0; else uniq_rc=$?; fi
  gate_classify uniqueness "$uniq_rc" "$uniq_err"
  uniq_n="$(printf '%s' "$uniq_err" | sed -n 's/.*passed: \([0-9]*\) variants.*/\1/p' | head -1)"
  gate_record uniqueness "pass(${uniq_n:-2} compared)" "Boards are not distinct enough to show. ${uniq_err}"
  uniq_note="$GATE_NOTE"
else
  gate_skipped uniqueness "gate-uniqueness.mjs not present"
fi

# EXPLORE PRESENTATION: the range has to READ as a range. A set of /vN routes with no page
# explaining them, or rungs with no stated intent, is a pile of links: the client opens two,
# picks the nearest thing to what they already had in mind, and everything the ladder cost was
# spent for nothing.
#
# A SKIP AND A BLOCK BOTH EXIT 2 HERE, and the FIRST STDERR LINE is what separates them, the
# same discriminator the SEO branch uses. gate-explore used to skip with 0, which put
# "explore=pass" in this line on every build that never ran Explore at all: a gate reporting a
# clean bill on a thing it had not looked at.
EXPLORE_GATE="$HERE/gate-explore.mjs"
explore_note="explore=skipped"
if [ -f "$EXPLORE_GATE" ]; then
  if explore_err="$(node "$EXPLORE_GATE" "$PROJ" 2>&1)"; then explore_rc=0; else explore_rc=$?; fi
  gate_classify explore "$explore_rc" "$explore_err"
  gate_record explore pass "Explore is not presentable. ${explore_err}"
  explore_note="$GATE_NOTE"
else
  gate_skipped explore "gate-explore.mjs not present"
fi

# FIDELITY: did the built home page carry the direction the client actually picked?
#
# This is the one promise Explore makes that nothing checked. The failure worth catching is not
# a wrong page, which somebody notices, but a PLAUSIBLE one: the same layout in a slightly
# different accent, the same accent at a different type scale, the picked section quietly
# dropped because it was awkward to compose. Invisible side by side, obvious when measured.
#
# IT WAITS FOR COMPOSE'S OWN RECORD, NEVER FOR THE FILE. The trigger was "picks exist and
# src/pages/index.astro exists", and the SCAFFOLD SHIPS src/pages/index.astro, so the second
# test was true from the moment the site was created. Between /pick and Compose, a Stop-hook run
# read the template's home page, found no data-palate-section on it, and failed with "the built
# home names no sections"; under PALATE_GATE_STRICT that blocks the stop at the one moment a
# false block costs the most. Compose writes explore.proof before any inner page is built
# (spec 3.6), so that stamp is the honest signal that there is a composed home to compare, and
# making the gate wait for it is what makes the stamp load-bearing rather than decorative.
#
# Same discriminator as the SEO and Explore branches: exit 2 with `gate-fidelity: skipped (` on
# the first stderr line is a skip, any other exit 2 or an exit 1 is a block.
FIDELITY_GATE="$HERE/gate-fidelity.mjs"
fidelity_note="fidelity=skipped"
fidelity_skip="gate-fidelity.mjs not present"
if [ -f "$FIDELITY_GATE" ] && [ "${PALATE_GATE_FIDELITY:-1}" = "1" ]; then
  # THE REASON FOLLOWS THE WORKFLOW ORDER: boards, then a pick, then Compose. A build with no
  # picks is reported as having no picks whether or not a home page exists, because "Compose
  # has not run" on a build nobody has picked from sends the reader to the wrong step.
  fidelity_skip="no picks recorded"
  npicks=$(jq -r '((.explore.picks // []) | length)' "$MANIFEST" 2>/dev/null || echo 0)
  proof=$(jq -r '(.explore.proof.verified_at // .explore.proof.url // empty)' "$MANIFEST" 2>/dev/null || echo "")
  if [ "${npicks:-0}" -lt 1 ]; then
    fidelity_skip="no picks recorded"
  elif [ "$(jq -r '[.explore.question_round.motion, .explore.question_round.mix, .explore.question_round.cms] | map(select(type=="string" and length>0)) | length' "$MANIFEST" 2>/dev/null || echo 0)" -lt 3 ]; then
    fail "The direction was picked but the question round was not recorded. Before Compose, ask the person how the picked rung should move, what to mix in from the other boards, and who edits the copy, then record it: scripts/palate-pick.mjs --answer motion=... --answer mix=... --answer cms=..."
  elif [ -z "$proof" ]; then
    fidelity_skip="Compose has not recorded the motion proof for src/pages/index.astro yet"
  else
    if fid_err="$(node "$FIDELITY_GATE" "$PROJ" 2>&1)"; then fid_rc=0; else fid_rc=$?; fi
    gate_classify fidelity "$fid_rc" "$fid_err"
    case "$GATE_VERDICT" in
      pass) fidelity_note="fidelity=pass"; fidelity_skip="" ;;
      skip) fidelity_note="fidelity=skipped"; fidelity_skip="$GATE_REASON" ;;
      *)    fail "The built home has drifted from the direction the client picked. ${fid_err}" ;;
    esac
  fi
else
  [ "${PALATE_GATE_FIDELITY:-1}" = "1" ] || fidelity_skip="PALATE_GATE_FIDELITY=0"
fi
if [ -n "$fidelity_skip" ]; then gate_skipped fidelity "$fidelity_skip"; else gate_ran; fi

bold_note="bold-bar=n/a(calm)"
if [ "${intensity:-calm}" = "high" ]; then bold_note="bold-bar=enforced"; fi

# The visual loop and the verifier are not optional: reaching this line means both ran and both
# passed (every other outcome above calls fail()), so they count as ran.
gate_ran   # visual
gate_ran   # verifier
GATES_TOTAL=$((GATES_RAN + GATES_SKIPPED))
skip_clause="."
[ "$GATES_SKIPPED" -gt 0 ] && skip_clause=" (${SKIP_REASONS})."
# TWO LINES, AND EACH REASON PRINTED ONCE. This was one sentence of up to 1,055 characters,
# fourteen lines at 80 columns, with every reason appearing twice: once in the count clause and
# again inside name=skipped(reason) in the tail. The count comes first and carries the reasons;
# the tail is a roll-call of names. The tail is INDENTED because the Stop hook forwards a
# matched headline's indented continuation lines, so the two travel together to the operator.
echo "Done gate: $GATES_RAN of $GATES_TOTAL sub-gates ran, $GATES_SKIPPED skipped${skip_clause}
  Passed: visual=pass (0 console errors, $shot_count shot(s), $sweep_note), verifier=pass, $novelty_note, $shipready_note, $seo_note, $headless_note, $ca_note, $facts_note, $explore_note, $fidelity_note, $uniq_note, $kit_tokens_note, $kit_complete_note, $kit_fixtures_note, $imagery_note, intensity=${intensity:-calm}, $bold_note.$facts_detail"
exit 0
