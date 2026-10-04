#!/usr/bin/env bash
# palate-check (bootstrap) - run Palate's anti-slop floor on a build, on ANY tool.
#
# The deterministic gate floor (ux-lint + anti-patterns.md) is the plugin's job on Claude
# Code, but a Cursor / Codex / Gemini / Copilot user has no hooks. This is the portable
# equivalent: a single command that fetches the lint + ruleset and runs them, so "run the
# gate before you ship" is a real instruction, not a claim about scripts the user never got.
#
# Usage (no clone, any project):
#   curl -fsSL https://raw.githubusercontent.com/jake-jiffi/palate-website-builder/main/scripts/bootstrap.sh | bash -s -- ./
# Or from a skill checkout (uses the local gates, no fetch):
#   scripts/bootstrap.sh [project-dir]
#
# Env:
#   PALATE_GATE_STRICT=1  fail on Medium-and-up findings (default: High-and-up).
#   PALATE_REF=<git-ref>  pin the fetched gates to a tag/sha (default: main).
#
# Exit: 0 clean, 1 findings at/above the threshold, 2 internal error (mirrors ux-lint.sh).
set -euo pipefail

TARGET="${1:-.}"
REF="${PALATE_REF:-main}"
BASE="https://raw.githubusercontent.com/jake-jiffi/palate-website-builder/${REF}"

# Strict tightens the floor from High to Medium (a non-Claude brain has no hooks to lean on,
# so the doctrine tells it to run this at the stricter bar).
FAIL_ON="High"; [ "${PALATE_GATE_STRICT:-0}" = "1" ] && FAIL_ON="Medium"

# Locate ux-lint.sh + anti-patterns.md. Prefer local siblings (a repo checkout: bootstrap.sh
# sits in scripts/ beside ux-lint.sh, with ../references/anti-patterns.md), so this is offline
# + testable there. Otherwise fetch the pinned pair flat and point ux-lint at it via --rules.
SELF_DIR=""
case "${BASH_SOURCE[0]:-$0}" in
  */*) SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)" ;;
esac

CACHE=""
# Preserve the pending exit status across cleanup: on macOS bash the trap's last command
# status would otherwise leak into the final exit code (a falsey `[ -n "$CACHE" ]` -> 1).
cleanup() { ec=$?; [ -n "$CACHE" ] && rm -rf "$CACHE"; exit "$ec"; }
trap cleanup EXIT

if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/ux-lint.sh" ] && [ -f "$SELF_DIR/../references/anti-patterns.md" ]; then
  LINT="$SELF_DIR/ux-lint.sh"
  RULES="$SELF_DIR/../references/anti-patterns.md"
else
  command -v curl >/dev/null 2>&1 || { echo "palate-check: curl is required to fetch the gates" >&2; exit 2; }
  CACHE="$(mktemp -d "${TMPDIR:-/tmp}/palate-check.XXXXXX")"
  curl -fsSL "$BASE/scripts/ux-lint.sh"            -o "$CACHE/ux-lint.sh"       || { echo "palate-check: could not fetch ux-lint.sh from $BASE (check the ref/network)" >&2; exit 2; }
  curl -fsSL "$BASE/references/anti-patterns.md"   -o "$CACHE/anti-patterns.md" || { echo "palate-check: could not fetch anti-patterns.md from $BASE" >&2; exit 2; }
  LINT="$CACHE/ux-lint.sh"
  RULES="$CACHE/anti-patterns.md"
fi

echo "palate-check: linting '$TARGET' for the AI tells (fail-on $FAIL_ON, ref $REF)" >&2

# Run the lint without set -e aborting before the cleanup trap; pass its exit code through.
set +e
bash "$LINT" "$TARGET" --rules "$RULES" --fail-on "$FAIL_ON"
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  echo "palate-check: clean at the $FAIL_ON bar. The lint is the floor, not the ceiling - ship against the render." >&2
elif [ "$rc" -eq 1 ]; then
  echo "palate-check: findings above. Fix the cause (do not silence a rule without a one-line brand reason), then re-run. Max 3 attempts, then HALT." >&2
fi
exit "$rc"
