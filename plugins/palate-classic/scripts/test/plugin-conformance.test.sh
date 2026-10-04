#!/usr/bin/env bash
# Tests the Claude Code PLUGIN contract, which nothing else in this suite covers.
#
# Every other test here is about what a build produces. These are about whether the plugin
# LOADS and RUNS correctly once installed, and each one is a rule whose breach is silent:
# a hook with an absolute path works perfectly on the machine that wrote it, a script
# without its executable bit fails only for whoever runs it the documented way, and a
# version mismatch between VERSION and plugin.json ships a plugin claiming to be something
# it is not. Seven shell scripts were shipped non-executable before this existed, including
# `reference-capture/setup.sh`, which a reference doc tells people to run bare.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

cd "$ROOT"

# --- 1. .claude-plugin holds MANIFESTS ONLY -----------------------------------------
extra=$(git ls-files .claude-plugin | grep -vE '^\.claude-plugin/(plugin|marketplace)\.json$' || true)
[ -z "$extra" ] && ok ".claude-plugin/ contains only manifests" \
  || bad ".claude-plugin/ carries non-manifest files: $(echo "$extra" | tr '\n' ' ')"

# --- 2. plugin.json: required fields, and a version that matches VERSION -------------
node -e '
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(".claude-plugin/plugin.json","utf8"));
const need=["name","version","description","author"];
const missing=need.filter(k=>!p[k]);
if(missing.length){console.error("MISSING:"+missing.join(","));process.exit(1)}
const v=fs.readFileSync("VERSION","utf8").trim();
if(p.version!==v){console.error("MISMATCH:plugin.json="+p.version+" VERSION="+v);process.exit(2)}
' 2>"$DIR/.pc.err"
case $? in
  0) ok "plugin.json has the required fields and matches VERSION" ;;
  1) bad "plugin.json is missing fields: $(cat "$DIR/.pc.err")" ;;
  *) bad "plugin.json version disagrees with VERSION: $(cat "$DIR/.pc.err")" ;;
esac
rm -f "$DIR/.pc.err"

# --- 3. hooks.json is PORTABLE ------------------------------------------------------
# An absolute path works on the machine that wrote it and nowhere else, which is why this
# is the rule the plugin docs put first.
if grep -qE '"/Users/|"/home/|"~/|/tmp/' hooks/hooks.json 2>/dev/null; then
  bad "hooks/hooks.json contains an absolute path"
else
  ok "hooks/hooks.json has no absolute paths"
fi
n=$(grep -o '\${CLAUDE_PLUGIN_ROOT}' hooks/hooks.json 2>/dev/null | wc -l | tr -d ' ')
[ "${n:-0}" -ge 1 ] && ok "hooks/hooks.json resolves through \${CLAUDE_PLUGIN_ROOT} ($n)" \
  || bad "hooks/hooks.json never uses \${CLAUDE_PLUGIN_ROOT}"

# Every command a hook runs must exist.
missing=""
while IFS= read -r rel; do
  [ -f "$rel" ] || missing="$missing $rel"
done < <(grep -oE '\$\{CLAUDE_PLUGIN_ROOT\}/[A-Za-z0-9._/-]+' hooks/hooks.json 2>/dev/null \
         | sed 's|${CLAUDE_PLUGIN_ROOT}/||' | sort -u)
[ -z "$missing" ] && ok "every hook command file exists" || bad "hooks point at missing files:$missing"

# --- 4. EVERY tracked shell script is executable -------------------------------------
# `bash foo.sh` hides this; running it the documented way does not.
ne=$(git ls-files -s | awk '$1!~/100755/ && $4~/\.sh$/ {print $4}')
[ -z "$ne" ] && ok "every tracked .sh is executable" \
  || bad "non-executable shell scripts: $(echo "$ne" | tr '\n' ' ')"

# --- 5. THE MANIFESTS ARE VALID JSON -------------------------------------------------
for f in .claude-plugin/plugin.json hooks/hooks.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null \
    && ok "$f is valid JSON" || bad "$f is not valid JSON"
done

# --- 6. AGENTS DECLARE THEIR FRONTMATTER ---------------------------------------------
for a in agents/*.md; do
  [ -f "$a" ] || continue
  head -1 "$a" | grep -q '^---$' && ok "$(basename "$a") opens with frontmatter" \
    || bad "$(basename "$a") has no frontmatter, so it will not register as an agent"
done

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
