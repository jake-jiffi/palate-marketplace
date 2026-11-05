#!/usr/bin/env bash
# Detect the runtime environment and choose a writable working directory.
# Works across Cowork-in-a-folder, Cowork-as-a-task, Claude Code in a folder,
# and bare sandboxes. Assumes nothing; proves writability before choosing.
#
# Prints KEY=VALUE lines: ENV_KIND, WORK_ROOT, OUTPUTS_DIR, HAS_NODE, NODE_OK
# Usage: eval "$(detect-environment.sh)"
set -euo pipefail

writable() { touch "$1/.__palate_wtest" 2>/dev/null && rm -f "$1/.__palate_wtest" && return 0 || return 1; }
# A dir is "inside a skill" if it or an ancestor holds a SKILL.md (don't build there).
inside_skill() {
  local d="$1"
  while [ "$d" != "/" ] && [ -n "$d" ]; do
    [ -f "$d/SKILL.md" ] && return 0
    d="$(dirname "$d")"
  done
  return 1
}

WORK_ROOT=""
CANDIDATES=()
[ -n "${PALATE_WORK_DIR:-}" ] && CANDIDATES+=("$PALATE_WORK_DIR")
# Prefer cwd only if it's writable, not root, and NOT inside the skill itself.
if [ "$(pwd)" != "/" ] && writable "$(pwd)" && ! inside_skill "$(pwd)"; then CANDIDATES+=("$(pwd)"); fi
CANDIDATES+=("/mnt/user-data/outputs" "$HOME/palate-builds" "/home/claude/palate-builds" "/workspace" "/tmp/palate-builds")

for c in "${CANDIDATES[@]}"; do
  [ -z "$c" ] && continue
  inside_skill "$c" && continue
  mkdir -p "$c" 2>/dev/null || true
  if [ -d "$c" ] && writable "$c"; then WORK_ROOT="$c"; break; fi
done
[ -n "$WORK_ROOT" ] || { echo "PALATE_ENV_ERROR=no-writable-dir"; exit 1; }

if [ -d /mnt/user-data/outputs ] && writable /mnt/user-data/outputs; then
  OUTPUTS_DIR="/mnt/user-data/outputs"
else
  OUTPUTS_DIR="$WORK_ROOT"
fi

if [ -d /mnt/user-data ] && [ -d /mnt/skills ]; then ENV_KIND="cowork"
elif [ -n "${CLAUDE_CODE:-}" ] || { [ "$(pwd)" != "/" ] && ! inside_skill "$(pwd)"; }; then ENV_KIND="claude-code"
else ENV_KIND="sandbox"; fi

if command -v node >/dev/null 2>&1; then
  HAS_NODE="yes"
  [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ] && NODE_OK="yes" || NODE_OK="no"
else HAS_NODE="no"; NODE_OK="no"; fi

echo "ENV_KIND=${ENV_KIND}"
echo "WORK_ROOT=${WORK_ROOT}"
echo "OUTPUTS_DIR=${OUTPUTS_DIR}"
echo "HAS_NODE=${HAS_NODE}"
echo "NODE_OK=${NODE_OK}"
