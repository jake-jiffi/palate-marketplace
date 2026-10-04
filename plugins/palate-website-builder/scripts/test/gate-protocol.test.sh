#!/usr/bin/env bash
# ONE PREDICATE READS EVERY GATE, AND THIS IS WHERE IT IS PINNED.
#
# gate-done.sh used to carry a bespoke parser per sub-gate: five spellings of a skip, three
# cleanings of a reason, and two opposite rules for an exit code the gate does not define.
# Three of the defects that file has shipped lived in that duplication, and one of them cost a
# whole release (an advisory line preceded gate-seo's verdict, the caller read the wrong one,
# and a real failure surfaced as an empty string).
#
# The predicate is now shared, so it is worth testing on its own rather than only through an
# eleven-gate integration. Every branch of gate_classify is driven here from a literal exit code
# and a literal transcript, which is what makes a mutation to the library land in seconds.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

# PROJ is what the reason cleaner strips, and the caller sets it. Pointed at a long absolute
# path here on purpose: the strip is the difference between a readable reason and 110
# characters of somebody's home directory mid-sentence.
PROJ="/private/tmp/some/very/long/absolute/path/to/a/clients/site"
# shellcheck source=../lib/gate-protocol.sh
. "$DIR/../lib/gate-protocol.sh"

want() { # <desc> <expected-verdict> <expected-reason-substring-or-empty>
  local desc="$1" wantv="$2" wantr="$3"
  if [ "$GATE_VERDICT" != "$wantv" ]; then
    bad "$desc (verdict '$GATE_VERDICT', want '$wantv'; reason '$GATE_REASON')"; return
  fi
  if [ -n "$wantr" ] && ! printf '%s' "$GATE_REASON" | grep -qF "$wantr"; then
    bad "$desc (reason '$GATE_REASON' does not carry '$wantr')"; return
  fi
  ok "$desc"
}

# ------------------------------------------------------------------ the plain contract
gate_classify seo 0 "gate-seo: clean (3 expected URL(s)); everything checked."
want "exit 0 with no skip marker is a pass" pass ""

gate_classify seo 1 "gate-seo: 2 finding(s) over 3 expected URL(s)."
want "exit 1 is a failure, whatever it printed" fail ""

gate_classify shipready 2 "gate-shipready: skipped (nothing to inspect: no readable source under src). NOT a pass."
want "exit 2 with the canonical shape is a skip carrying its reason" skip "nothing to inspect"

# ------------------------------- the gate's OWN verdict, not the advisory above it
# gate-seo prints a build-format advisory before it checks anything, so on an exit-2 path the
# FIRST line can be that advisory with the verdict two lines below it. A site that had simply
# never been built was summarised as a config problem and the operator was sent to change
# their host. The LAST line with the gate's own prefix is the verdict, by construction.
gate_classify seo 2 "gate-seo: astro.config declares build.format file and @astrojs/vercel overrides it

gate-seo: no build output in dist. The sitemap is a BUILD artefact. NOT a pass."
want "the LAST prefixed line is the verdict, not the advisory above it" skip "no build output"
if printf '%s' "$GATE_REASON" | grep -qF "build.format"; then
  bad "and the advisory is not mistaken for it (got: $GATE_REASON)"
else
  ok "and the advisory is not mistaken for it"
fi

# ------------------------------- the header is not the finding
gate_classify seo 2 "gate-seo: 1 thing(s) could NOT be checked. These are unknown, not clean.

  [answer-engine surfaces] no llms.txt was served, so the answer-engine surface is UNKNOWN."
want "a cannot-check header yields the named unknown, not the header" skip "answer-engine surfaces"

# ------------------------------- a gate that READ the site is not a gate that did not run
gate_classify seo 2 "gate-seo: partial (3 route(s) checked, 1 unknown); everything checked was clean (3 expected URL(s), 3 advertised). NOT a full pass."
want "a partial verdict is its own answer, counted as a gate that ran" partial "3 route(s) checked, 1 unknown"
# THE COUNTS SURVIVE WHOLE. Splitting on the first close paren cut "3 route(s" out of the one
# line a person reads, because the counts themselves say "route(s)".
if [ "$GATE_REASON" = "3 route(s) checked, 1 unknown" ]; then
  ok "and the counts are not truncated at the paren inside route(s)"
else
  bad "and the counts are not truncated at the paren inside route(s) (got: $GATE_REASON)"
fi

# ------------------------------- exit 2 that is a BLOCK, on the gates that overload it
gate_classify explore 2 "gate-explore: skipped (no boards registered)"
want "gate-explore's marked exit 2 is a skip" skip "no boards registered"
gate_classify explore 2 "gate-explore: 3 finding(s). The ladder has gaps: positions 1, 3, 6."
want "gate-explore's UNMARKED exit 2 is a block, because it uses 2 for both" fail ""

gate_classify uniqueness 2 "uniqueness gate: skipped (fewer than 2 rendered boards or variants under $PROJ: found 0). NOT a pass."
want "uniqueness spells its skip differently and is read anyway" skip "fewer than 2 rendered"

# THE ABSOLUTE PROJECT PATH IS STRIPPED, on every gate rather than on three of them. A real
# summary line carried 110 characters of somebody's home directory mid-sentence, from the two
# branches that did not strip. The reason here is deliberately SHORT: a long one is capped, the
# cap would eat the path anyway, and an assertion that only passes because of the cap is an
# assertion that proves nothing about the strip.
gate_classify facts 2 "gate-facts: skipped (no built output under $PROJ/dist)"
want "a short reason keeps its words" skip "no built output under"
if printf '%s' "$GATE_REASON" | grep -qF "/private/tmp/some/very/long"; then
  bad "and the absolute project path is stripped out of the reason (got: $GATE_REASON)"
else
  ok "and the absolute project path is stripped out of the reason"
fi
gate_classify uniqueness 2 "uniqueness gate FAILED: v1 and v2 are near-duplicates."
want "uniqueness's unmarked exit 2 is a block" fail ""

gate_classify fidelity 2 "gate-fidelity: skipped (no archived board renders to compare)"
want "fidelity's marked exit 2 is a skip" skip "no archived board renders"

# ------------------------------- the two documented exit-0 skips
gate_classify novelty 0 "novelty gate skipped: no diverge block (the concept spine did not run)."
want "gate-novelty skips with exit 0 on stdout and is still a skip" skip "no diverge block"
gate_classify novelty 0 "novelty gate passed: 3 variants, no recurring display face."
want "and its pass is a pass" pass ""

gate_classify customer-auth 0 "gate-customer-auth: no customer-account surface in this build, nothing to check."
want "gate-customer-auth skips with exit 0 and a substring" skip "no customer-account surface"
gate_classify customer-auth 0 "gate-customer-auth: clean over 16 check(s)."
want "and its clean run is a pass" pass ""

# ------------------------------- headless reports its OWN reason, not the caller's guess
# "not a commerce build" was hardcoded over all three of that gate's exit-2 paths, so a REAL
# storefront with a corrupt catalogue was filed as a brochure site and sixty checks were
# silently marked not applicable.
gate_classify headless 2 "gate-headless: skipped (no .palate/catalogue.json, so this is not a headless Shopify storefront). Nothing checked."
want "headless says which of its exit-2 reasons it was: not a storefront" skip "not a headless Shopify storefront"
gate_classify headless 2 "gate-headless: skipped (.palate/catalogue.json is not readable JSON, so the survey is UNKNOWN, not clean). This IS a commerce build and none of it was checked."
want "and the corrupt-catalogue case is not reported as a brochure site" skip "not readable JSON"
if printf '%s' "$GATE_REASON" | grep -qF "not a commerce build"; then
  bad "and nothing hardcodes 'not a commerce build' over it (got: $GATE_REASON)"
else
  ok "and nothing hardcodes 'not a commerce build' over it"
fi

# ------------------------------- AN UNEXPECTED EXIT IS A SKIP, NOT A VERDICT
# A syntax error in gate-uniqueness.mjs used to print "Boards are not distinct enough to show"
# over a Node stack trace, and under PALATE_GATE_STRICT it blocked the stop. Nothing about the
# boards had been measured. hooks/palate-stop.mjs already states the rule: a gate that could
# not run is not a gate that failed.
# THE EXIT CODE CANNOT TELL THEM APART, WHICH IS WHY THE PREDICATE IS NOT THE EXIT CODE. Node
# exits 1 on an unhandled exception, and 1 is also the documented "I found something" exit of
# gate-seo, gate-shipready and gate-fidelity. A gate that reached a verdict says so in its own
# voice on its own line; a stack trace does not.
gate_classify uniqueness 1 "file:///x/gate-uniqueness.mjs:2
#!/usr/bin/env node
^

SyntaxError: Invalid or unexpected token"
want "a gate that crashed at exit 1 is a SKIP, not a verdict about the client's site" skip "without reaching a verdict"
if printf '%s' "$GATE_REASON" | grep -qF "nothing was measured"; then
  ok "and the reason says nothing was measured"
else
  bad "and the reason says nothing was measured (got: $GATE_REASON)"
fi

# AND THE REAL FAILURE AT THE SAME EXIT CODE STILL BLOCKS. Without this the fix above is just
# "stop blocking", which would be a fail-open regression rather than a repair.
gate_classify uniqueness 1 "uniqueness gate FAILED: v1 and v2 are near-duplicates."
want "a gate that DID reach a verdict at exit 1 still blocks" fail ""
gate_classify shipready 1 "gate-shipready: 3 finding(s) (inspected 109 file(s)). This build is NOT ready to hand over."
want "and so does the canonical spelling of it" fail ""
gate_classify explore 2 "Explore gate FAILED: the range will not read as a range."
want "and the capitalised spelling is recognised too" fail ""

# A STACK TRACE NAMES THE FAILING SCRIPT, so an unanchored match would read the PATH in the
# traceback as the gate having spoken. That is the "keyed on location rather than behaviour"
# mistake this programme has now made four times.
gate_classify shipready 1 "node:internal/modules/esm/resolve:274
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/x/hooks/project-dir.mjs' imported from /x/scripts/gate-shipready.mjs"
want "the script's own path inside a traceback is not the gate speaking" skip "without reaching a verdict"

gate_classify uniqueness 7 "file:///x/gate-uniqueness.mjs:2
SyntaxError: Invalid or unexpected token"
want "an exit code the gate does not define is a SKIP" skip "exited 7"
gate_classify seo 127 ""
want "a gate that could not be executed at all is a skip too" skip "exited 127"

# ------------------------------- one cleaner, applied to every reason
long="gate-facts: skipped (the build output under $PROJ/dist holds no indexable page, so nothing could be compared across pages and no label could be read anywhere at all). NOT a pass."
gate_classify facts 2 "$long"
if [ "${#GATE_REASON}" -le 101 ]; then
  ok "a long reason is capped so one summary line stays readable"
else
  bad "a long reason is capped (got ${#GATE_REASON} chars: $GATE_REASON)"
fi
# THE CAP LANDS ON A WORD BOUNDARY. The previous one produced "...the index found no p…" in
# the line a person actually reads.
case "$GATE_REASON" in
  *' …') bad "the cap trimmed to a space and left it dangling (got: $GATE_REASON)" ;;
  *…)
    trimmed="${GATE_REASON%…}"
    if [ "${#trimmed}" -eq 99 ]; then
      bad "the cap cut mid-word at exactly 99 characters (got: $GATE_REASON)"
    else
      ok "and the cap lands on a word boundary rather than mid-word"
    fi ;;
  *) bad "a capped reason must end with an ellipsis (got: $GATE_REASON)" ;;
esac

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
