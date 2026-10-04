#!/usr/bin/env bash
# palate-verify - the portable "is it real + is it clean" gate for non-Claude tools.
#
# On Claude Code the hooks fire the gates for you. A Cursor / Codex / Gemini / Copilot build
# has no hooks, so this is the portable equivalent: ONE command that runs both deterministic
# floors the plugin runs, from one command, no clone:
#   1. anti-freestyle  (verify-is-real-astro.sh): a REAL Astro scaffold, no loose root .html,
#      it compiles. This is the gate that catches "you built raw index.html, not Astro".
#   2. anti-slop lint   (bootstrap.sh -> ux-lint.sh + anti-patterns.md): the banned faces, the
#      eyebrow/status pill, the closed list of AI tells.
#
# Usage (any project, no clone):
#   curl -fsSL https://raw.githubusercontent.com/jake-jiffi/palate-website-builder/main/scripts/palate-verify.sh | bash -s -- ./
# From a skill checkout (local scripts, no fetch):
#   scripts/palate-verify.sh [project-dir]
#
# Env:
#   PALATE_GATE_STRICT=1  lint fails on Medium-and-up (default High-and-up)
#   PALATE_REF=<git-ref>  pin the fetched gates to a tag/sha (default main)
#   PALATE_SKIP_ASTRO=1   lint only (e.g. a legitimately non-Astro sub-package)
#
# Exit: 0 all clear, 1 a gate failed, 2 internal error.
set -uo pipefail

TARGET="${1:-.}"
REF="${PALATE_REF:-main}"
BASE="https://raw.githubusercontent.com/jake-jiffi/palate-website-builder/${REF}"

# Prefer local siblings (a repo checkout: this sits in scripts/ beside the real gates), so it
# is offline + testable there; otherwise fetch the pinned scripts flat.
SELF_DIR=""
case "${BASH_SOURCE[0]:-$0}" in
  */*) SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)" ;;
esac

CACHE=""
# Preserve the pending exit status across cleanup (macOS bash: the trap's last command status
# would otherwise leak into the final exit code).
cleanup() { ec=$?; [ -n "$CACHE" ] && rm -rf "$CACHE"; exit "$ec"; }
trap cleanup EXIT

if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/verify-is-real-astro.sh" ] && [ -f "$SELF_DIR/bootstrap.sh" ]; then
  ASTRO="$SELF_DIR/verify-is-real-astro.sh"
  BOOT="$SELF_DIR/bootstrap.sh"
else
  command -v curl >/dev/null 2>&1 || { echo "palate-verify: curl is required to fetch the gates" >&2; exit 2; }
  CACHE="$(mktemp -d "${TMPDIR:-/tmp}/palate-verify.XXXXXX")"
  curl -fsSL "$BASE/scripts/verify-is-real-astro.sh" -o "$CACHE/verify-is-real-astro.sh" || { echo "palate-verify: could not fetch verify-is-real-astro.sh from $BASE (check the ref/network)" >&2; exit 2; }
  curl -fsSL "$BASE/scripts/bootstrap.sh"            -o "$CACHE/bootstrap.sh"            || { echo "palate-verify: could not fetch bootstrap.sh from $BASE" >&2; exit 2; }
  ASTRO="$CACHE/verify-is-real-astro.sh"
  BOOT="$CACHE/bootstrap.sh"
fi

rc=0

# Gate 1: anti-freestyle. verify-is-real-astro.sh inspects the CWD, so run it inside TARGET.
if [ "${PALATE_SKIP_ASTRO:-0}" != "1" ]; then
  echo "palate-verify: [1/2] anti-freestyle - real Astro scaffold, no loose root .html, it compiles" >&2
  if ( cd "$TARGET" && bash "$ASTRO" ); then
    echo "palate-verify: [1/2] OK" >&2
  else
    echo "palate-verify: [1/2] FAILED - scaffold from templates/astro-project (npx degit jake-jiffi/palate-website-builder/templates/astro-project .); do NOT hand-write root .html" >&2
    rc=1
  fi
fi

# Gate 2: anti-slop lint (bootstrap.sh = ux-lint.sh + anti-patterns.md). On a real Astro
# project, lint src/ (the build), so the downloaded doctrine at the root (AGENTS.md /
# PALATE_*.md, which quote the very tells the lint hunts) is not scanned as a false positive.
LINT_TARGET="$TARGET"
[ -d "$TARGET/src" ] && LINT_TARGET="$TARGET/src"
echo "palate-verify: [2/2] anti-slop lint ($LINT_TARGET) - banned faces, the eyebrow/status pill, the closed list of tells" >&2
if bash "$BOOT" "$LINT_TARGET"; then
  echo "palate-verify: [2/2] OK" >&2
else
  echo "palate-verify: [2/2] FAILED - AI tells above" >&2
  rc=1
fi

echo >&2
if [ "$rc" -eq 0 ]; then
  echo "palate-verify: PASS. The gate is the floor, not the ceiling - ship against the render." >&2
else
  echo "palate-verify: FAIL. Fix the causes above and re-run. You are not done until this exits 0." >&2
fi
exit "$rc"
