#!/usr/bin/env bash
# NEVER GRADE THE PLUGIN'S OWN FILES.
#
# THE FAULT THIS PINS. Every gate defaults its project directory to ".", and the resolver falls
# back to the start directory when it detects nothing, so a gate run from the plugin checkout
# happily lints the plugin: its doctrine files QUOTE the tells the lint hunts, its templates
# carry {{PLACEHOLDER}} tokens on purpose, and its own repo root is not a client site. The
# evidence was five stray build-manifest.json files written inside this repo by the hooks,
# one of them recording 188 files_written across three unrelated repositories.
#
# So: the plugin root, anything inside it, and any directory carrying .claude-plugin/plugin.json
# are REFUSED with a reason and exit 2, never measured and never reported clean.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }
refuses() { # <desc> <output> <rc>
  if [ "$3" = "2" ] && printf '%s' "$2" | grep -qF "refused"; then ok "$1";
  else bad "$1 (exit $3, output: $2)"; fi
}

# --- the gates, run from the plugin root with no argument ----------------------------
out="$(cd "$ROOT" && bash "$ROOT/scripts/ux-lint.sh" 2>&1)"; rc=$?
refuses "ux-lint refuses the plugin root" "$out" "$rc"

out="$(cd "$ROOT" && node "$ROOT/scripts/gate-shipready.mjs" 2>&1)"; rc=$?
refuses "gate-shipready refuses the plugin root" "$out" "$rc"

out="$(cd "$ROOT" && node "$ROOT/scripts/gate-explore.mjs" 2>&1)"; rc=$?
refuses "gate-explore refuses the plugin root" "$out" "$rc"

out="$(cd "$ROOT" && bash "$ROOT/scripts/palate-verify.sh" 2>&1)"; rc=$?
refuses "palate-verify refuses the plugin root" "$out" "$rc"

# --- and when it is named EXPLICITLY, not only when it is the default -----------------
out="$(node "$ROOT/scripts/gate-shipready.mjs" "$ROOT" 2>&1)"; rc=$?
refuses "gate-shipready refuses the plugin root named outright" "$out" "$rc"

# --- the resolver -------------------------------------------------------------------
# templates/astro-project IS a package.json + src/pages, so it resolves as a project on every
# other rule. It is inside the plugin, which is the only thing that disqualifies it.
res="$(cd "$ROOT/templates/astro-project" && env CLAUDE_PLUGIN_ROOT="$ROOT" node -e '
import("'"$ROOT"'/hooks/project-dir.mjs").then((m) => {
  const r = m.resolveProjectDir(process.cwd());
  console.log(JSON.stringify({ how: r.how, dir: r.dir, reason: r.reason || "" }));
});
')"
if printf '%s' "$res" | grep -qF '"how":"refused"'; then ok "the resolver refuses a directory inside CLAUDE_PLUGIN_ROOT";
else bad "the resolver refuses a directory inside CLAUDE_PLUGIN_ROOT (got $res)"; fi
if printf '%s' "$res" | grep -qF '"dir":null'; then ok "and hands back no directory at all";
else bad "and hands back no directory at all (got $res)"; fi
if printf '%s' "$res" | grep -qE '"reason":"[^"]+"'; then ok "and says why";
else bad "and says why (got $res)"; fi

# A real client project must still resolve, or the guard has broken the thing it protects.
mkdir -p "$TMP/site/src/pages"; printf '{"name":"site"}' > "$TMP/site/package.json"
res="$(cd "$TMP/site" && env CLAUDE_PLUGIN_ROOT="$ROOT" node -e '
import("'"$ROOT"'/hooks/project-dir.mjs").then((m) => {
  console.log(JSON.stringify(m.resolveProjectDir(process.cwd())));
});
')"
# Not keyed on `how`: with no hint, walkUp("") already resolves to the cwd, so this reports
# "hint" and always has. What matters is that it resolves to the site and is not refused.
if printf '%s' "$res" | grep -qF "$TMP/site" && ! printf '%s' "$res" | grep -qF 'refused'; then
  ok "an ordinary client project still resolves"
else
  bad "an ordinary client project still resolves (got $res)"
fi

# --- AND FROM A SUB-DIRECTORY, which is where the strays actually landed ---------------
# Checking the candidate alone left the fault half open. A session standing in scripts/test
# takes the FALLBACK rung (nothing detected) and a session in templates/astro-project takes the
# HINT rung (it is a real package.json + src/pages), and both used to resolve a project and get
# a build-manifest.json written into the plugin. Two of the five stray locations, and the habit
# an agent has of cd-ing into a subdirectory of its own build.
for sub in scripts/test templates/astro-project; do
  res="$(cd "$ROOT/$sub" && env CLAUDE_PLUGIN_ROOT="$TMP/fake-installed-cache" node -e '
import("'"$ROOT"'/hooks/project-dir.mjs").then((m) => {
  const r = m.resolveProjectDir(process.cwd());
  console.log(JSON.stringify({ how: r.how, dir: r.dir }));
});
')"
  if printf '%s' "$res" | grep -qF '"how":"refused"'; then ok "the resolver refuses $sub";
  else bad "the resolver refuses $sub (got $res)"; fi

  rm -f "$ROOT/$sub/build-manifest.json"
  printf '{"hook_event_name":"PostToolUse","cwd":"%s","tool_name":"Write","tool_input":{"file_path":"%s/x.astro"},"tool_response":{"ok":true}}' \
    "$ROOT/$sub" "$ROOT/$sub" \
    | env CLAUDE_PLUGIN_ROOT="$TMP/fake-installed-cache" node "$ROOT/hooks/palate-manifest.mjs" >/dev/null 2>&1
  if [ -f "$ROOT/$sub/build-manifest.json" ]; then
    bad "the manifest hook must not write into $sub"; rm -f "$ROOT/$sub/build-manifest.json"
  else
    ok "the manifest hook writes nothing into $sub"
  fi
done

# --- the hooks write nothing into the plugin -----------------------------------------
rm -f "$ROOT/build-manifest.json"
printf '{"hook_event_name":"PostToolUse","cwd":"%s","tool_name":"Write","tool_input":{"file_path":"%s/README.md"},"tool_response":{"ok":true}}' "$ROOT" "$ROOT" \
  | env CLAUDE_PLUGIN_ROOT="$ROOT" node "$ROOT/hooks/palate-manifest.mjs" >/dev/null 2>&1
if [ -f "$ROOT/build-manifest.json" ]; then
  bad "the manifest hook must not write into the plugin"
  rm -f "$ROOT/build-manifest.json"
else
  ok "the manifest hook writes nothing into the plugin"
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
