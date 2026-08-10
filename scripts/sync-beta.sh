#!/usr/bin/env bash
# Sync the BETA plugin from the skill repo's `beta` branch.
#
#   ./scripts/sync-beta.sh [path-to-skill-clone] [beta-version]
#
# ============================ WHAT THIS IS FOR ============================
#
# Two plugins ship from ONE source. `palate-website-builder` is what customers
# install and it moves only on a deliberate promotion. `palate-beta` is the
# unstable track: it carries whatever is on the skill repo's `beta` branch, it
# is expected to have bugs, and it is published so testers can opt in without
# touching their working install.
#
# THE IDENTITY REWRITE IS THE WHOLE TRICK. The skill repo has exactly one
# plugin.json and one set of commands, both naming `palate-website-builder`.
# Maintaining a second hand-edited copy would guarantee the two drift, and the
# drift would be silent. So the source stays single-named and THIS SCRIPT
# rewrites identity into the generated copy:
#
#   plugin.json name     palate-website-builder -> palate-beta
#   plugin.json version  <VERSION>              -> the beta version
#   command references   /palate-website-builder: -> /palate-beta:
#
# Claude Code namespaces commands by plugin name, so without that last rewrite
# every cross-reference inside the beta plugin would point at a command the
# beta plugin does not have.
#
# The vendored copy is GENERATED. Never hand-edit plugins/palate-beta: fix it
# in the skill repo on `beta` and re-sync.
set -euo pipefail

SKILL="${1:-$HOME/dev/palate/skill}"
cd "$(dirname "$0")/.."

BRANCH="beta"
git -C "$SKILL" rev-parse --verify "$BRANCH" >/dev/null 2>&1 || {
  echo "sync-beta: no '$BRANCH' branch in $SKILL. Beta ships from that branch, never from main." >&2
  exit 1
}

SRC_VERSION="$(git -C "$SKILL" show "$BRANCH:VERSION" 2>/dev/null | tr -d '[:space:]')"
BETA_VERSION="${2:-${SRC_VERSION}-beta.1}"

rm -rf plugins/palate-beta
mkdir -p plugins/palate-beta
git -C "$SKILL" archive "$BRANCH" | tar -x -C plugins/palate-beta

# --- identity rewrite, on the generated copy only -------------------------
node - "$BETA_VERSION" <<'NODE'
const fs = require('fs');
const version = process.argv[2];
const p = 'plugins/palate-beta/.claude-plugin/plugin.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.name = 'palate-beta';
j.version = version;
// Say it in the description too. Someone reading /plugin should not have to
// infer instability from a name, and "beta" in a name is easy to skim past.
j.description = 'BETA, EXPECTED TO HAVE BUGS. The unstable track of the Palate ' +
  'website-builder, published so testers can opt in. Do not run it alongside ' +
  'palate-website-builder: both register hooks on plain Write, so two manifest ' +
  'recorders would write the same build-manifest.json and double-count MCP calls. ' +
  'Install one at a time. ' + (j.description || '');
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
console.log(`  plugin.json -> name=${j.name} version=${j.version}`);
NODE

echo "$BETA_VERSION" > plugins/palate-beta/VERSION

# Commands namespace by plugin name, so every self-reference has to follow.
if [ -d plugins/palate-beta/commands ]; then
  before="$(grep -rho '/palate-website-builder:' plugins/palate-beta/commands 2>/dev/null | wc -l | tr -d ' ')"
  find plugins/palate-beta/commands -name '*.md' -exec \
    sed -i '' 's|/palate-website-builder:|/palate-beta:|g' {} +
  echo "  commands -> rewrote $before reference(s) to /palate-beta:"
fi

echo "synced palate-beta $BETA_VERSION from $SKILL@$BRANCH (source VERSION $SRC_VERSION)"
echo
echo "Next: bump plugins[palate-beta].version in .claude-plugin/marketplace.json to $BETA_VERSION, then commit and push."
