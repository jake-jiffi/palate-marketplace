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

# The project dir is the directory holding the manifest, so artefacts resolve next to it.
PROJ="$(cd "$(dirname "$MANIFEST")" 2>/dev/null && pwd || echo .)"
REPORT="$PROJ/verify-report.json"
SHOTS_DIR="$PROJ/.palate-shots"
SHOTS_MANIFEST="$SHOTS_DIR/manifest.json"
SHOTS_ERRORS="$SHOTS_DIR/errors.json"

fail() { echo "Done gate FAILED: $1" >&2; exit 2; }
skip() { echo "Done gate skipped: $1"; exit 0; }

# --- FAIL-OPEN LADDER (mirrors gate-mcp-depth.sh:32-35, plus one render rung) ---
# Never block closed when there is nothing to gate.
command -v jq >/dev/null 2>&1 || skip "jq is not installed; not gating done."
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
  skip "no Palate MCP calls recorded (MCP not connected, or surveyed in a subagent); cannot gate done."
fi

# NEW rung beyond the depth gate: a render must be possible for visual/verifier to
# mean anything. If neither a built dist/ nor a verify-report.json exists, the gate
# could not have run, so it SKIPS rather than blocks (render impossible != failure).
[ -d "$PROJ/dist" ] || [ -f "$REPORT" ] \
  || skip "no renderable preview (no dist/ and no verify-report.json); cannot judge visual/verifier."

# --- KEEP THE FLOOR: the MCP-depth gate runs first and must pass ---------------
# Capture its stderr so a depth failure surfaces the real reason through this gate.
if ! depth_err="$(bash "$DEPTH_GATE" "$MANIFEST" 2>&1 1>/dev/null)"; then
  fail "MCP-depth gate did not pass. ${depth_err}"
fi

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

# EVIDENCE not assertion: a screenshot must exist ON DISK. A report claiming visual
# pass with no captured PNG is rejected (the verifier may not pass without real pixels).
shot_count=$(find "$SHOTS_DIR" -maxdepth 2 -type f -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
[ "${shot_count:-0}" -ge 1 ] || fail "Visual loop has no screenshot evidence: no PNG under $SHOTS_DIR. The verifier must capture and read real pixels (scripts/reference-capture/screenshot-build.mjs) before visual can pass."

# Console errors are an automatic visual fail. Prefer the screenshot driver's own
# count (the live truth off the running page) over the report's recorded number.
console_errors="$verr_report"
if [ -f "$SHOTS_MANIFEST" ]; then
  sc=$(jq -r '(.console_errors // 0)' "$SHOTS_MANIFEST" 2>/dev/null || echo 0)
  console_errors="${sc:-$verr_report}"
fi
[ "${console_errors:-0}" -eq 0 ] || fail "Visual loop has $console_errors console error(s) on the rendered page (see $SHOTS_ERRORS). A thrown build cannot pass; fix the runtime error and re-render."

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
    MIN_VARIANTS="${PALATE_MIN_VARIANTS:-2}"
    case "$MIN_VARIANTS" in ''|*[!0-9]*) MIN_VARIANTS=2 ;; esac   # numeric-only, so a garbage env can't wrongly block
    nvar=$(jq -r '((.variants // []) | length)' "$MANIFEST" 2>/dev/null || echo 0)
    [ "${nvar:-0}" -ge "$MIN_VARIANTS" ] || fail "Bold bar: Explore collapsed to concept-level - a high-intensity brief built only ${nvar:-0} variant(s) (need >= $MIN_VARIANTS). Build the distinct routes, or record commission.explore_skip=true with the named-direction reason. $escalate"
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
novelty_note="novelty=off(PALATE_GATE_NOVELTY=0)"
if [ "$REQUIRE_NOVELTY" = "1" ] && [ -f "$NOVELTY_GATE" ]; then
  if novelty_err="$(node "$NOVELTY_GATE" --manifest "$MANIFEST" 2>&1 1>/dev/null)"; then
    # gate-novelty prints "passed:" on a real pass and "skipped:" when nothing to
    # compare; both exit 0. Reflect which one happened in the summary.
    novelty_note="novelty=pass-or-skip"
  else
    fail "Novelty gate did not pass. ${novelty_err}"
  fi
elif [ ! -f "$NOVELTY_GATE" ]; then
  novelty_note="novelty=skipped(gate-novelty.mjs not present)"
fi

bold_note="bold-bar=n/a(calm)"
if [ "${intensity:-calm}" = "high" ]; then bold_note="bold-bar=enforced"; fi
echo "Done gate passed: visual=pass (0 console errors, $shot_count shot(s)), verifier=pass, $novelty_note, intensity=${intensity:-calm}, $bold_note."
exit 0
