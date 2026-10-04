#!/usr/bin/env bash
# Sync palate-classic, the frozen 1.16 builder, from the skill repo's `classic` branch.
#   ./scripts/sync-classic.sh [path-to-skill-clone]
# Classic keeps the 1.16 package layout (SKILL.md at the root), so it is a plain archive plus the
# rename every second plugin in this marketplace needs: commands namespace by plugin name, so every
# /palate-website-builder: reference in Markdown becomes /palate-classic:. Scripts are left
# byte-identical; the classic branch's session hook reads its own name from plugin.json.
set -euo pipefail
SKILL="${1:-$HOME/dev/palate/skill}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
VERSION="$(git -C "$SKILL" show classic:VERSION | tr -d '[:space:]')"
case "$VERSION" in 1.16.*) ;; *) echo "sync-classic: classic VERSION is '$VERSION', expected 1.16.x" >&2; exit 1;; esac
STAGE="$(mktemp -d plugins/.palate-classic-stage-XXXXXX)"
git -C "$SKILL" archive classic | tar -x -C "$STAGE"
node - "$STAGE" "$VERSION" <<'JS'
const fs = require('fs'), path = require('path');
const [root, version] = process.argv.slice(2);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const f = path.join(dir, e.name);
  return e.isDirectory() ? walk(f) : [f];
});
for (const f of walk(root)) {
  if (!f.endsWith('.md')) continue;
  const text = fs.readFileSync(f, 'utf8'), next = text.replaceAll('/palate-website-builder:', '/palate-classic:');
  if (next !== text) fs.writeFileSync(f, next);
}
const file = path.join(root, '.claude-plugin/plugin.json'), m = JSON.parse(fs.readFileSync(file, 'utf8'));
if (m.version !== version) throw new Error(`classic plugin.json says ${m.version}, VERSION says ${version}`);
m.name = 'palate-classic';
m.description = 'Palate classic: the 1.16 builder, frozen. Use one Palate plugin at a time. ' + m.description;
fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
JS
rm -rf plugins/palate-classic
mv "$STAGE" plugins/palate-classic
node -e "
const fs=require('fs'), f='.claude-plugin/marketplace.json', m=JSON.parse(fs.readFileSync(f,'utf8'));
const e=m.plugins.find(p=>p.name==='palate-classic');
if(!e) { console.error('sync-classic: add a palate-classic entry to marketplace.json first'); process.exit(1); }
e.version='$VERSION'; fs.writeFileSync(f, JSON.stringify(m,null,2)+'\n');"
echo "synced palate-classic $VERSION from $SKILL classic"
