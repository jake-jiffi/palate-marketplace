#!/usr/bin/env bash
# Phase F (CRO): install the CRO + Ads module. Sub-skills install but stay
# dormant until the traffic threshold is met.
# Usage: install-cro.sh <slug> [threshold]
set -euo pipefail
SLUG="${1:?slug}"; THRESHOLD="${2:-500}"
mkdir -p .claude/skills
cp -r "$(dirname "$0")/../templates/cro/skills/." .claude/skills/ 2>/dev/null || true
cp "$(dirname "$0")/../templates/cro/AGENTS.md.tpl" AGENTS.md 2>/dev/null || true

# The CRO sub-skill definitions ship as SKILL.md.tpl (so the parent skill zip
# contains exactly one SKILL.md and passes the uploader). Rename them back to
# SKILL.md now that they are installed into the project.
find .claude/skills -name "SKILL.md.tpl" | while read -r f; do
  mv "$f" "${f%.tpl}"
done

cat > .palate-cro-config.json <<JSON
{
  "enabled": true,
  "dormantUntilSessions": ${THRESHOLD},
  "activated": false,
  "platforms": { "humblytics": true, "googleAds": false, "metaAds": false },
  "note": "Sub-skills are installed but dormant. They activate once Humblytics reports >= dormantUntilSessions sessions. Until then funnel-reporter and ad-expert do not run on schedule, and optimizer/ab-test-generator refuse to launch experiments."
}
JSON
echo "CRO_INSTALLED_DORMANT: threshold ${THRESHOLD} sessions"
