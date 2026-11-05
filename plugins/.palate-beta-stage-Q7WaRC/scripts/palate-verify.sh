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

# NEVER GRADE THE PLUGIN'S OWN FILES.
#
# DUPLICATED FROM hooks/project-dir.mjs ON PURPOSE, and it is the one duplication here that is
# not drift waiting to happen: bootstrap.sh curls this script ALONE into a cache directory, so
# it has no sibling to import and must carry the predicate itself. Three conditions, matching
# pluginRootRefusal(): the directory is CLAUDE_PLUGIN_ROOT, it sits inside it, or it carries
# .claude-plugin/plugin.json, on the directory itself or on any ancestor up to the git toplevel.
# A test that needs a fixture linted copies it to a temporary directory first.
palate_plugin_refusal() { # <dir> -> prints the reason and returns 0 when it must be refused
  local d
  d="$(cd "$1" 2>/dev/null && pwd)" || return 1
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    local root
    root="$(cd "$CLAUDE_PLUGIN_ROOT" 2>/dev/null && pwd)" || root=""
    if [ -n "$root" ]; then
      case "$d" in
        "$root") echo "$d is CLAUDE_PLUGIN_ROOT, the Palate plugin itself, not a site"; return 0 ;;
        "$root"/*) echo "$d is inside CLAUDE_PLUGIN_ROOT ($root), so it is part of the Palate plugin, not a site"; return 0 ;;
      esac
    fi
  fi
  # Ancestors too, bounded by the git toplevel: checking the candidate alone still let a gate
  # run inside scripts/test or templates/astro-project measure the plugin. `.git` is a
  # directory in a clone and a FILE in a worktree, so -e rather than -d.
  local cur="$d" i=0
  while [ "$i" -lt 12 ]; do
    if [ -f "$cur/.claude-plugin/plugin.json" ]; then
      if [ "$cur" = "$d" ]; then
        echo "$d carries .claude-plugin/plugin.json, so it is a Claude Code plugin checkout, not a site"
      else
        echo "$d is inside the Claude Code plugin checkout at $cur (.claude-plugin/plugin.json), not a site"
      fi
      return 0
    fi
    [ -e "$cur/.git" ] && break
    local parent; parent="$(dirname "$cur")"
    [ "$parent" = "$cur" ] && break
    cur="$parent"; i=$((i + 1))
  done
  return 1
}

if refusal="$(palate_plugin_refusal "$TARGET")"; then
  echo "palate-verify: refused: $refusal. Name the site directory explicitly. NOT a pass." >&2
  exit 2
fi
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
# WHICH GATES ACTUALLY RAN. "PASS" over two gates where one was switched off and the other
# could not read anything says the same word as a real pass, so the line names both lists.
RAN=""
SKIPPED=""
note_ran()     { RAN="${RAN:+$RAN, }$1"; }
note_skipped() { SKIPPED="${SKIPPED:+$SKIPPED, }$1 ($2)"; }

# Gate 1: anti-freestyle. verify-is-real-astro.sh inspects the CWD, so run it inside TARGET.
if [ "${PALATE_SKIP_ASTRO:-0}" != "1" ]; then
  echo "palate-verify: [1/2] anti-freestyle - real Astro scaffold, no loose root .html, it compiles" >&2
  if ( cd "$TARGET" && bash "$ASTRO" ); then
    echo "palate-verify: [1/2] OK" >&2
    note_ran "anti-freestyle"
  else
    echo "palate-verify: [1/2] FAILED - scaffold from templates/astro-project (npx degit jake-jiffi/palate-website-builder/templates/astro-project .); do NOT hand-write root .html" >&2
    note_ran "anti-freestyle"
    rc=1
  fi
else
  note_skipped "anti-freestyle" "PALATE_SKIP_ASTRO=1"
fi

# Gate 2: anti-slop lint (bootstrap.sh = ux-lint.sh + anti-patterns.md). On a real Astro
# project, lint src/ (the build), so the downloaded doctrine at the root (AGENTS.md /
# PALATE_*.md, which quote the very tells the lint hunts) is not scanned as a false positive.
LINT_TARGET="$TARGET"
[ -d "$TARGET/src" ] && LINT_TARGET="$TARGET/src"
echo "palate-verify: [2/2] anti-slop lint ($LINT_TARGET) - banned faces, the eyebrow/status pill, the closed list of tells" >&2
if bash "$BOOT" "$LINT_TARGET"; then
  echo "palate-verify: [2/2] OK" >&2
  note_ran "anti-slop lint"
else
  boot_rc=$?
  if [ "$boot_rc" -eq 2 ]; then
    # Could not check, which is not a failure and is certainly not a pass.
    echo "palate-verify: [2/2] SKIPPED - the lint could not check $LINT_TARGET (reason above)" >&2
    note_skipped "anti-slop lint" "nothing to inspect"
  else
    echo "palate-verify: [2/2] FAILED - AI tells above" >&2
    note_ran "anti-slop lint"
    rc=1
  fi
fi

echo >&2
gates_line="ran: ${RAN:-none}"
[ -n "$SKIPPED" ] && gates_line="$gates_line; skipped: $SKIPPED"
# ZERO GATES RUN IS NOT A PASS. With the Astro gate switched off and a lint that could not
# inspect anything, this printed PASS and exited 0 over nothing measured. The line named
# "ran: none", which is the honest half, but a CI step reads the verdict word and the exit code,
# and this whole epic exists to stop a gate exiting 0 having inspected nothing.
if [ -z "$RAN" ]; then
  echo "palate-verify: SKIPPED ($gates_line). Nothing was inspected, so nothing has been established. NOT a pass." >&2
  exit 2
fi
if [ "$rc" -eq 0 ]; then
  echo "palate-verify: PASS ($gates_line). The gate is the floor, not the ceiling - ship against the render." >&2
else
  echo "palate-verify: FAIL ($gates_line). Fix the causes above and re-run. You are not done until this exits 0." >&2
fi
exit "$rc"
