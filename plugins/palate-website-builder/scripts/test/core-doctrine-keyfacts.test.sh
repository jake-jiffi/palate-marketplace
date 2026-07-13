#!/usr/bin/env bash
# Key-fact cross-check (the "improve everywhere" backstop). The portable doctrine
# (references/core-doctrine.md) is a hand-distilled view of the full plugin doctrine. A diff
# guard cannot prove a SUMMARY matches its source, so this asserts the load-bearing CLOSED FACTS
# stay consistent: if SKILL.md / anti-patterns.md change one of these, the doctrine must too
# (and then `node scripts/gen-skill-lite.mjs` reships every tool). Mechanical, deterministic.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D="$DIR/references/core-doctrine.md"
S="$DIR/SKILL.md"
A="$DIR/references/anti-patterns.md"
fail() { echo "FAIL: $1"; exit 1; }

# 1. The build spine + the MCP namespace must be present in BOTH the doctrine and SKILL.md.
for f in DIVERGE CONVERGE COMMISSION EXPLORE "mcp__palate"; do
  grep -q "$f" "$D" || fail "doctrine is missing '$f' (the build spine / MCP namespace)"
  grep -q "$f" "$S" || fail "SKILL.md is missing '$f' but the doctrine has it (they diverged)"
done

# 2. The free-cap number must match SKILL.md exactly.
grep -q "25 deep" "$D" || fail "doctrine lost the '25 deep' free cap"
grep -q "25 deep" "$S" || fail "SKILL.md '25 deep' cap changed but the doctrine still says it (re-curate)"

# 3. Every banned-as-default face the lint enforces (anti-patterns.md) must appear in the
#    doctrine, so a new ban in the lint forces a doctrine update.
for face in Inter Roboto Arial "Space Grotesk" "Instrument Serif" Fraunces Geist "Bricolage" "Hanken"; do
  grep -qi "$face" "$A" || continue          # only enforce faces the lint actually bans now
  grep -qi "$face" "$D" || fail "anti-patterns.md bans '$face' but core-doctrine.md omits it (re-curate)"
done

# 4. The doctrine must carry its load-bearing closed lists (cannot be trimmed away).
grep -qi "imagery" "$D" || fail "doctrine lost the imagery-cliche list"
grep -q "44" "$D"       || fail "doctrine lost the perceptual-floor numbers (e.g. 44px touch target)"
grep -qiE "axis|axes" "$D" || fail "doctrine lost the visual-rubric axes"
grep -qi "quota_exceeded" "$D" || fail "doctrine lost the quota hard-stop"

echo "PASS: core-doctrine.md key facts agree with SKILL.md + anti-patterns.md"
