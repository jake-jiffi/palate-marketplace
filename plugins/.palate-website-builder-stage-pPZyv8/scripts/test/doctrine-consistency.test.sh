#!/usr/bin/env bash
# Doctrine consistency: the cross-file contradiction guard.
#
# THE FAILURE THIS EXISTS FOR. On 18 June a plumbing commit rewrote SKILL.md so every Explore
# variant "carr[ied] one of the 1-2 ADVANCED concepts (not a fresh spine)" while
# explore-stage.md kept saying "generate 8-10 genuinely different versions". Two shipped files
# stated opposite instructions for two months; SKILL.md is the always-loaded one, so the funnel
# won silently at build time, every preview regressed to one concept's mean, and the owner
# repeatedly asked why builds were timid. Nobody decided any of that.
#
# A test cannot prove two prose files agree in general. What it CAN do is pin the load-bearing
# invariants that every file stating them must state the SAME WAY, so an edit that flips one
# file and not the others fails the suite instead of shipping a contradiction. This mirrors
# core-doctrine-keyfacts.test.sh (summary-matches-source); this file owns PEER files agreeing
# with each other.
#
# WHEN DOCTRINE CHANGES A LOAD-BEARING RULE, ADD ITS INVARIANT HERE. This file is the mechanism
# that was missing; leaving it stale recreates the gap it closes.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$DIR"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

# The surfaces doctrine ships on. skill-lite/ is generated, but a stale generation IS a shipped
# contradiction (four tools would carry the old rule), so it is checked too.
DOCTRINE_FILES=(SKILL.md references/core-doctrine.md references/story-engine.md references/explore-stage.md)
LITE_FILES=(skill-lite/AGENTS.md skill-lite/cursor/palate.mdc skill-lite/gemini/GEMINI.md skill-lite/copilot/copilot-instructions.md)

# --- 1. THE FUNNEL STAYS DEAD --------------------------------------------------------------
# No shipped file may INSTRUCT narrowing Explore to 1-2 carried concepts. Historical mentions
# ("It used to advance the best 1-2...") are allowed: they are the record of the regression,
# and deleting history is not the goal. An instruction line has no such marker.
FUNNEL='advance the best 1-2|the advanced 1-2|1-2 ADVANCED|carry the best 1-2|elaborates? the 1-2'
HISTORY='[Uu]sed to|[Ww]as the regression|the funnel|FUNNEL'
hits=0
for f in "${DOCTRINE_FILES[@]}" "${LITE_FILES[@]}" commands/*.md; do
  [ -f "$f" ] || continue
  while IFS= read -r line; do
    echo "$line" | grep -qE "$HISTORY" && continue
    echo "  funnel instruction in $f: $(echo "$line" | cut -c1-90)"
    hits=$((hits+1))
  done < <(grep -hE "$FUNNEL" "$f" 2>/dev/null || true)
done
[ "$hits" -eq 0 ] && ok "no shipped file instructs the 1-2 funnel (historical mentions allowed)" \
  || bad "$hits line(s) resurrect the funnel instruction"

# --- 2. EVERY FILE THAT DESCRIBES CONVERGE CARRIES THE LADDER ------------------------------
# CONVERGE without the ambition ladder is the funnel by omission: a reader of that one file
# rebuilds the old behaviour in good faith.
for f in "${DOCTRINE_FILES[@]}" "${LITE_FILES[@]}"; do
  grep -q "CONVERGE" "$f" || continue
  grep -qi "ambition ladder" "$f" \
    && ok "$f: CONVERGE is described with the ladder" \
    || bad "$f describes CONVERGE without the ambition ladder (the funnel by omission)"
done

# --- 3. RUNG 1 IS RESTRAINED AND EXCELLENT, EVERYWHERE THE LADDER IS -----------------------
# A ladder whose bottom rung is allowed to be weak rebuilds the timidity problem at 1/Nth
# scale, which is why the rule ships beside every statement of the ladder.
for f in "${DOCTRINE_FILES[@]}" "${LITE_FILES[@]}"; do
  grep -qi "ambition ladder" "$f" || continue
  grep -qiE "restrained and excellent|never (the )?weak" "$f" \
    && ok "$f: rung 1 carries the restrained-and-excellent rule" \
    || bad "$f states the ladder without the rung-1 rule"
done

# --- 4. PER-VARIANT GATING IS STATED ON BOTH SURFACES --------------------------------------
# The gates moved from Compose-only to per-variant because clients see variants FIRST. The two
# files a builder actually reads for Explore must both say it, or one of them quietly reverts
# the change for whoever grounds on it.
grep -q "FAILING VARIANT IS NOT REGISTERED" SKILL.md \
  && ok "SKILL.md: a failing variant is not registered" \
  || bad "SKILL.md lost the per-variant gate (a failing variant must not be registered)"
grep -q "NO VARIANT IS REGISTERED UNTIL IT PASSES" references/explore-stage.md \
  && ok "explore-stage.md: no variant registered until it passes" \
  || bad "explore-stage.md lost the per-variant gate statement"

# --- 5. ONE CONCEPT PER RUNG, ONE DONOR EACH -----------------------------------------------
# "Its own concept" / one donor per rung is what makes the preview a range instead of eight
# dressings of one idea. Pinned where variants are specified.
grep -qiE "ITS OWN concept|one concept per rung" SKILL.md \
  && ok "SKILL.md: each variant carries its own concept" \
  || bad "SKILL.md no longer says each variant carries its own concept"
grep -qiE "no donor slug (is )?used twice|one distinct donor" SKILL.md references/story-engine.md \
  && ok "the no-donor-reused rule is stated" \
  || bad "the no-donor-reused rule vanished from the ladder doctrine"

# --- 6. CALM IS NOT MOTIONLESS, AND THE RESTRAINT CLAUSE IS RUNG-SCOPED --------------------
# A real build (a pelvic-health clinic) wrote a SITE-WIDE restraint clause at commission time,
# which is BEFORE Explore, so it capped all 8 rungs: the boldest carried 2 keyframes. Two
# statements have to survive together or the collapse comes back. First: calm governs the
# CHARACTER of motion, not its existence. Second: the clause is written for RUNG 1, and the top
# rung keeps its permission on any brand.
grep -qi "CALM IS NOT MOTIONLESS" references/build-commission.md \
  && ok "build-commission.md: calm is not motionless" \
  || bad "build-commission.md lost the calm-is-not-motionless rule (a calm brief will ship inert again)"
grep -qiE "RUNG-SCOPED|BINDS THE BOTTOM OF THE LADDER" references/build-commission.md \
  && ok "build-commission.md: the restraint clause is rung-scoped" \
  || bad "the restraint clause is site-wide again, so it caps every rung including the top one"
grep -qi "CALM BRAND STILL SPANS THE LADDER" references/explore-stage.md \
  && ok "explore-stage.md: a calm brand still spans the ladder" \
  || bad "explore-stage.md no longer says a calm brand spans the full ladder"
grep -qi "governs the CHARACTER of motion" SKILL.md \
  && ok "SKILL.md: calm governs the character of motion, not its existence" \
  || bad "SKILL.md reads 'a calm brand demands calm' with no character/existence split (reads as motionless)"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
