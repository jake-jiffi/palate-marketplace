#!/usr/bin/env bash
# Single-source guard (source-triage fix): the post-handover project hook's rule file
# (templates/astro-project/_claude/anti-patterns.md) MUST be a verbatim copy of
# references/anti-patterns.md, so the build linter (ux-lint.sh) and the shipped hook
# (anti-slop-check.js) cannot drift. They had drifted (31 vs 72 rules) before this guard.
# Re-sync with: cp references/anti-patterns.md templates/astro-project/_claude/anti-patterns.md
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if diff -q "$DIR/references/anti-patterns.md" "$DIR/templates/astro-project/_claude/anti-patterns.md" >/dev/null; then
  echo "PASS: shipped anti-patterns.md is in sync with references/anti-patterns.md"
else
  echo "FAIL: templates/astro-project/_claude/anti-patterns.md has DRIFTED from references/anti-patterns.md"
  echo "  re-sync: cp references/anti-patterns.md templates/astro-project/_claude/anti-patterns.md"
  exit 1
fi
