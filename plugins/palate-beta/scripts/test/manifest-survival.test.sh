#!/usr/bin/env bash
# Tests that a build's SURVEY survives the ordinary accidents that used to delete it.
#
# The bug this pins: a Palate build surveys and diverges BEFORE it scaffolds, so its manifest
# is legitimately recorded against the session cwd. The moment package.json + src/pages appear
# the resolver correctly answers WORK_ROOT/{slug}-site, the recorded project no longer EQUALS
# it, and the "one manifest per build" guard blanked mcp_calls, references_surveyed,
# inner_pages_viewed and layers_read. On the normal build path. Silently. Every gate downstream
# then read the build as ungrounded, which is precisely what happened on a real client build.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$DIR/../../hooks/palate-manifest.mjs"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }
is()  { # <desc> <actual> <expected>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi
}

# Feed the hook one Palate call, as PostToolUse would.
call() { # <cwd> <tool> <args-json> <result-text>
  printf '{"cwd":%s,"tool_name":%s,"tool_input":%s,"tool_response":{"content":[{"type":"text","text":%s}]}}' \
    "$(jq -Rn --arg v "$1" '$v')" "$(jq -Rn --arg v "$2" '$v')" "$3" "$(jq -Rn --arg v "$4" '$v')" \
    | node "$HOOK" 2>/dev/null
}
# Feed the hook one file Write.
wrote() { # <cwd> <path>
  printf '{"cwd":%s,"tool_name":"Write","tool_input":{"file_path":%s},"tool_response":{}}' \
    "$(jq -Rn --arg v "$1" '$v')" "$(jq -Rn --arg v "$2" '$v')" | node "$HOOK" 2>/dev/null
}
mancalls() { jq '((.mcp_calls // []) | length)' "$1" 2>/dev/null || echo ERR; }

# =====================================================================================
# 1. THE REAL BUILD ORDER: survey in the workspace root, then scaffold. The survey must
#    still be there afterwards.
# =====================================================================================
W="$TMP/w1"; mkdir -p "$W"
call "$W" "mcp__palate__refs_search" '{"query":"pelvic health clinic"}' '{"results":[{"slug":"therapy-in-london"},{"slug":"august-health-ehr"}]}'
call "$W" "mcp__palate__refs_get" '{"slug":"therapy-in-london","layer":["do_dont"]}' '{"slug":"therapy-in-london","do_dont":{"do":["warm ground"],"dont":["cold white"]}}'
is "survey lands while there is no scaffold" "$(mancalls "$W/build-manifest.json")" "2"

# the scaffold appears, exactly as SKILL.md builds it
mkdir -p "$W/pelvy-site/src/pages"; echo '{}' > "$W/pelvy-site/package.json"
wrote "$W" "$W/pelvy-site/src/pages/index.astro"

MAN="$W/pelvy-site/build-manifest.json"
[ -f "$MAN" ] && ok "the manifest followed the scaffold" || bad "the manifest did not follow the scaffold"
is "THE SURVEY SURVIVED the scaffold" "$(mancalls "$MAN")" "2"
is "references survived too" "$(jq '(.references_surveyed|length)' "$MAN")" "2"
is "layers_read survived" "$(jq '(.layers_read|length)' "$MAN")" "1"
is "the journal travelled with it" "$( [ -f "$W/pelvy-site/.palate/mcp-journal.jsonl" ] && echo yes || echo no )" "yes"

# =====================================================================================
# 2. THE MANIFEST IS DELETED BY HAND. The journal is the record of last resort.
# =====================================================================================
rm -f "$MAN"
call "$W" "mcp__palate__refs_similar" '{"slug":"therapy-in-london"}' '{"results":[{"slug":"august-health-ehr"}]}'
is "a deleted manifest is rebuilt from the journal" "$(mancalls "$MAN")" "3"

# =====================================================================================
# 3. A DANGLING SYMLINK. An agent "unified" two manifest paths on a real build; the target
#    had already moved, so every write went through a broken link and conjured a fresh
#    default manifest at the far end.
# =====================================================================================
rm -f "$MAN"; ln -s "$W/nowhere/build-manifest.json" "$MAN"
call "$W" "mcp__palate__refs_get_screenshot" '{"slug":"august-health-ehr","page":"pricing"}' '{"slug":"august-health-ehr","page":"pricing","image":"<png>"}'
[ -L "$MAN" ] && bad "the dangling symlink is still in place" || ok "the dangling symlink was cleared"
is "the survey survived a dangling symlink" "$(mancalls "$MAN")" "4"
is "the inner page was recorded" "$(jq '(.inner_pages_viewed|length)' "$MAN")" "1"

# =====================================================================================
# 4. A CORRUPT MANIFEST is archived, never silently replaced.
# =====================================================================================
echo 'not json {{{' > "$MAN"
call "$W" "mcp__palate__refs_search" '{"query":"clinic"}' '{"results":[{"slug":"nocturne-label"}]}'
is "a corrupt manifest is archived" "$(ls "$W/pelvy-site"/build-manifest.json.corrupt-*.json 2>/dev/null | wc -l | tr -d ' ')" "1"
is "and the survey is restored from the journal" "$(mancalls "$MAN")" "5"

# =====================================================================================
# 5. A GENUINELY DIFFERENT BUILD still starts fresh, and the old one is kept.
# =====================================================================================
V="$TMP/other"; mkdir -p "$V/site/src/pages"; echo '{}' > "$V/site/package.json"
cp "$MAN" "$V/site/build-manifest.json"
jq '.project="/some/unrelated/repo"' "$MAN" > "$V/site/build-manifest.json"
call "$V" "mcp__palate__refs_search" '{"query":"surf school"}' '{"results":[{"slug":"zoop-soda"}]}'
is "an unrelated project starts a fresh manifest" "$(mancalls "$V/site/build-manifest.json")" "1"
is "and the previous manifest is archived, not destroyed" "$(ls "$V/site"/build-manifest.json.previous-*.json 2>/dev/null | wc -l | tr -d ' ')" "1"

# =====================================================================================
# 6. TWO BUILDS IN ONE WORKSPACE must not merge. The containment rule that saves the
#    scaffold migration would over-merge if the manifest were allowed to re-anchor to the
#    workspace root, so climbing out to a parent never rewrites the recorded project.
# =====================================================================================
X="$TMP/two"; mkdir -p "$X/a-site/src/pages" "$X/b-site/src/pages"
echo '{}' > "$X/a-site/package.json"; echo '{}' > "$X/b-site/package.json"
call "$X/a-site" "mcp__palate__refs_search" '{"query":"site a"}' '{"results":[{"slug":"aaa"}]}'
is "build A recorded its own survey" "$(mancalls "$X/a-site/build-manifest.json")" "1"
# a scratch write resolved from the workspace root: the manifest must stay anchored to a-site
wrote "$X/a-site" "/tmp/scratch-note.md"
is "a scratch write does not re-anchor the manifest" "$(jq -r '.project' "$X/a-site/build-manifest.json")" "$X/a-site"
call "$X/b-site" "mcp__palate__refs_search" '{"query":"site b"}' '{"results":[{"slug":"bbb"}]}'
is "build B has its own manifest" "$(mancalls "$X/b-site/build-manifest.json")" "1"
is "and B did not inherit A's references" "$(jq -r '.references_surveyed[0]' "$X/b-site/build-manifest.json")" "bbb"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
