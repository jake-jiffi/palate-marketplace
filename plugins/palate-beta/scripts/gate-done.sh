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

fail() { echo "Done gate FAILED: $1" >&2; exit 2; }
# STDERR, like fail() and ungrounded(). Every caller spawns this with
# stdio: ["ignore","ignore","pipe"], so a skip written to STDOUT is DISCARDED: no jq, no
# manifest, or no renderable preview then turns the whole gate suite off and the transcript
# is indistinguishable from a clean pass. A gate that was blocked is not a gate that passed.
skip() { echo "Done gate skipped: $1" >&2; exit 0; }

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

# SHIP-READY: the seam between "built" and "deliverable". A build can be visually
# perfect and still carry eight rejected concept homepages into the client's sitemap, a
# literal {{HUMBLYTICS_SITE_ID}} in a third-party script tag, and photographs nobody ever
# measured. All three shipped on a real build that passed every other gate here, because
# nothing owned that seam.
SHIPREADY_GATE="$HERE/gate-shipready.mjs"
shipready_note="shipready=skipped(gate-shipready.mjs not present)"
if [ -f "$SHIPREADY_GATE" ]; then
  # The `if` form, never a bare assignment: a non-zero command substitution in an assignment
  # is fatal wherever errexit is in force, which killed this block before the case below was
  # ever reached and turned every "cannot check" into a silent exit with no message at all.
  if shipready_err="$(node "$SHIPREADY_GATE" "$PROJ" 2>&1)"; then shipready_rc=0; else shipready_rc=$?; fi
  case "$shipready_rc" in
    0) shipready_note="shipready=pass" ;;
    # 2 is CANNOT CHECK (no src/pages, so not an Astro project shape), not a clean bill. It
    # skips like every other sub-gate here, but it SAYS so, because a skip that reads as a
    # pass is the failure mode this whole file exists to prevent.
    2) shipready_note="shipready=skipped(not an Astro project shape)" ;;
    *) fail "Not ready to hand over. ${shipready_err}" ;;
  esac
fi

# SEO: the crawl surface. A build can be visually perfect, ship-ready and still be
# undiscoverable: rejected Explore variants indexed, dynamic routes absent from the sitemap,
# a preview inviting indexing of the client's content at a non-canonical domain. It lived only
# in /sweep, which is a monthly pass somebody has to run, so nothing checked it at done-time.
SEO_GATE="$HERE/gate-seo.mjs"
seo_note="seo=skipped(gate-seo.mjs not present)"
if [ -f "$SEO_GATE" ]; then
  if seo_err="$(node "$SEO_GATE" "$PROJ" 2>&1)"; then seo_rc=0; else seo_rc=$?; fi
  case "$seo_rc" in
    0) seo_note="seo=pass" ;;
    # 2 is CANNOT CHECK. It skips like the other sub-gates, and it SAYS so, because a skip that
    # reads as a pass is the failure this file exists to prevent.
    #
    # IT NOW SAYS WHY IN GATE-SEO'S OWN WORDS. This hardcoded "nothing built to crawl" for ALL
    # SEVEN of that gate's exit-2 paths, so a missing sitemap, a --base nothing answered, an
    # unbuildable content index and a blocked crawl every one reported as an unbuilt site. Each
    # of those already prints a specific reason ending "NOT a pass" and this threw it away, which
    # is the exists-but-never-fires class: the gate ran, refused, and was filed as not applicable.
    # Pure bash below on purpose: a pipe into an early-exiting grep or head SIGPIPEs the producer
    # and fails the assignment under pipefail, which this repo has already paid for once.
    2) seo_reason="${seo_err%%$'\n'*}"
       seo_reason="${seo_reason#gate-seo: }"
       # Strip the absolute project path. gate-seo leads its message with the path it looked in,
       # which on a real machine is long enough to push the MEANING past the truncation, so the
       # note would read "no /Users/.../src/pages. Not an Astro pro…" and lose the actual reason.
       seo_reason="${seo_reason//$PROJ\//}"
       seo_reason="${seo_reason//$PROJ/.}"
       if [ "${#seo_reason}" -gt 100 ]; then seo_reason="${seo_reason:0:99}…"; fi
       seo_note="seo=skipped(${seo_reason})"
       [ -z "$seo_reason" ] && seo_note="seo=skipped(gate-seo exited 2 without a reason)" ;;
    *) fail "SEO gate did not pass. ${seo_err}" ;;
  esac
fi

# HEADLESS: is this Shopify storefront actually constructed correctly?
#
# Silent on every non-commerce build: without .palate/catalogue.json it exits 2 having checked
# nothing, so a brochure site is never judged against a commerce contract. --no-cli because the
# done gate must not shell out to npx on every build; the CLI checks belong to the setup step.
HEADLESS_GATE="$HERE/gate-headless.mjs"
headless_note="headless=skipped(not a commerce build)"
if [ -f "$HEADLESS_GATE" ]; then
  if hl_err="$(node "$HEADLESS_GATE" "$PROJ" --no-cli 2>&1)"; then hl_rc=0; else hl_rc=$?; fi
  case "$hl_rc" in
    0) headless_note="headless=pass" ;;
    2) headless_note="headless=skipped(not a commerce build)" ;;
    *) fail "Headless storefront is not correctly constructed. ${hl_err}" ;;
  esac
fi

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
uniq_note="uniqueness=skipped(no rendered variants)"
if [ -f "$UNIQ_GATE" ]; then
  # shellcheck disable=SC2207
  uniq_files=($(ls "$SHOTS_DIR"/v*/rendered.html 2>/dev/null || true))
  if [ "${#uniq_files[@]}" -ge 2 ]; then
    if uniq_err="$(node "$UNIQ_GATE" "${uniq_files[@]}" 2>&1)"; then
      uniq_note="uniqueness=pass(${#uniq_files[@]} variants)"
    else
      fail "Variants are not distinct enough to show. ${uniq_err}"
    fi
  fi
fi

# EXPLORE PRESENTATION: the range has to READ as a range. A set of /vN routes with no page
# explaining them, or rungs with no stated intent, is a pile of links: the client opens two,
# picks the nearest thing to what they already had in mind, and everything the ladder cost was
# spent for nothing. NOTE the exit codes here are the OPPOSITE way round to the two gates above:
# gate-explore.mjs skips with 0 and BLOCKS with 2, because it can always tell whether it applies
# (no registered variants means no opinion), so there is no cannot-check state to signal.
EXPLORE_GATE="$HERE/gate-explore.mjs"
explore_note="explore=skipped(gate-explore.mjs not present)"
if [ -f "$EXPLORE_GATE" ]; then
  if explore_err="$(node "$EXPLORE_GATE" "$PROJ" 2>&1)"; then explore_rc=0; else explore_rc=$?; fi
  case "$explore_rc" in
    0) explore_note="explore=pass" ;;
    *) fail "Explore is not presentable. ${explore_err}" ;;
  esac
fi

bold_note="bold-bar=n/a(calm)"
if [ "${intensity:-calm}" = "high" ]; then bold_note="bold-bar=enforced"; fi
echo "Done gate passed: visual=pass (0 console errors, $shot_count shot(s)), verifier=pass, $novelty_note, $shipready_note, $seo_note, $headless_note, $explore_note, $uniq_note, intensity=${intensity:-calm}, $bold_note."
exit 0
