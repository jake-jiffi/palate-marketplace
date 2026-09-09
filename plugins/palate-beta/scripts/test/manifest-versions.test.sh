#!/usr/bin/env bash
# Tests that a build records WHAT IT WAS BUILT WITH, not just what it did.
#
# The bug this pins: the manifest recorded reference slugs and nothing else, so the same
# brief run twice against a different plugin, a different MCP deploy or a re-seeded library
# produced two different sites with no record of why. Four stamps answer it: the plugin
# version, the MCP version, the library (its reference count and catalogue stamp) and the
# rubric version.
#
# The library stamp is the one the plugin cannot know on its own: only the server knows what
# its catalogue currently holds, so it is read from the MCP's own refs_list_verticals result.
# An older MCP that does not send one must leave `library: null` with `library_unverified:
# true`, because a missing stamp is a fact about the connection and must never read as a
# verified one.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$DIR/../../hooks/palate-manifest.mjs"
ROOT="$DIR/../.."
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
# NO jq `//` default here: `false // "null"` is "null", so a boolean that is legitimately
# false would read as an absent field and the unverified flag could never be asserted.
field() { jq -r "$2" "$1" 2>/dev/null || echo ERR; }

VERTICALS='{"total":2170,"catalogue_stamp":"2026-07-09T04:12:55.108Z","mcp_version":"2026-09-09.catalogue-stamp","verticals":[{"vertical":"health","count":207,"subtypes":["clinic"],"exampleSlugs":["therapy-in-london"]}]}'

# =====================================================================================
# 1. THE MCP ANSWERS: every stamp lands, and the library is VERIFIED.
# =====================================================================================
W="$TMP/w1"; mkdir -p "$W"
call "$W" "mcp__palate__refs_list_verticals" '{}' "$VERTICALS"
MAN="$W/build-manifest.json"
is "the plugin version is the one on disk" "$(field "$MAN" .plugin_version)" "$(tr -d '[:space:]' < "$ROOT/VERSION")"
is "the MCP names its own version"         "$(field "$MAN" .mcp_version)" "2026-09-09.catalogue-stamp"
is "the library reference count is recorded" "$(field "$MAN" .library.references)" "2170"
is "the catalogue stamp is recorded"       "$(field "$MAN" .library.catalogue_stamp)" "2026-07-09T04:12:55.108Z"
is "and the library is NOT flagged unverified" "$(field "$MAN" .library_unverified)" "false"

# =====================================================================================
# 2. NO refs_list_verticals: the library is UNVERIFIED, and says so.
#    A build can survey by search alone, and a null stamp must never read as a verified one.
# =====================================================================================
W2="$TMP/w2"; mkdir -p "$W2"
call "$W2" "mcp__palate__refs_search" '{"query":"pelvic health clinic"}' '{"results":[{"slug":"therapy-in-london"}]}'
MAN2="$W2/build-manifest.json"
is "no verticals call: library is null"      "$(field "$MAN2" .library)" "null"
is "no verticals call: flagged unverified"   "$(field "$MAN2" .library_unverified)" "true"
is "the plugin version is recorded anyway"   "$(field "$MAN2" .plugin_version)" "$(tr -d '[:space:]' < "$ROOT/VERSION")"

# =====================================================================================
# 3. AN OLDER MCP answers refs_list_verticals with no stamp. Tolerated, never invented.
# =====================================================================================
W3="$TMP/w3"; mkdir -p "$W3"
call "$W3" "mcp__palate__refs_list_verticals" '{}' '{"total":2170,"verticals":[{"vertical":"health","count":207}]}'
MAN3="$W3/build-manifest.json"
is "an MCP with no stamp leaves library null" "$(field "$MAN3" .library)" "null"
is "and the build is flagged unverified"      "$(field "$MAN3" .library_unverified)" "true"
is "the call still counts as grounding"       "$(jq '(.mcp_calls|length)' "$MAN3")" "1"

# =====================================================================================
# 4. THE FIRST ANSWER WINS. A re-seed mid-build must not rewrite what the build was
#    grounded on: the earlier stamp is what the survey actually read.
# =====================================================================================
call "$W" "mcp__palate__refs_list_verticals" '{}' \
  '{"total":9999,"catalogue_stamp":"2026-12-25T00:00:00.000Z","mcp_version":"later","verticals":[]}'
is "a later stamp does not overwrite the first" "$(field "$MAN" .library.catalogue_stamp)" "2026-07-09T04:12:55.108Z"
is "nor does a later reference count"           "$(field "$MAN" .library.references)" "2170"

# =====================================================================================
# 5. THE RUBRIC VERSION comes from the vendored rubric's own export. rubric.mjs is
#    byte-identical to the grader's copy and hash-pinned in both repos, so the plugin
#    READS the constant rather than adding one; absent means null, never a guess.
# =====================================================================================
FAKE="$TMP/plugin-root"; mkdir -p "$FAKE/scripts/reference-capture"
printf '9.9.9\n' > "$FAKE/VERSION"
printf "export const RUBRIC_VERSION = '2026-09-09.stamped';\n" > "$FAKE/scripts/reference-capture/rubric.mjs"
W4="$TMP/w4"; mkdir -p "$W4"
CLAUDE_PLUGIN_ROOT="$FAKE" call "$W4" "mcp__palate__refs_search" '{"query":"clinic"}' '{"results":[{"slug":"nocturne-label"}]}'
MAN4="$W4/build-manifest.json"
is "the rubric version is read from its export" "$(field "$MAN4" .rubric_version)" "2026-09-09.stamped"
is "and it is no longer flagged unverified"     "$(field "$MAN4" .rubric_unverified)" "false"
is "and the plugin root env is honoured"        "$(field "$MAN4" .plugin_version)" "9.9.9"

# A rubric with no export records null rather than a guess.
printf 'export const DIMENSIONS = [];\n' > "$FAKE/scripts/reference-capture/rubric.mjs"
W5="$TMP/w5"; mkdir -p "$W5"
CLAUDE_PLUGIN_ROOT="$FAKE" call "$W5" "mcp__palate__refs_search" '{"query":"clinic"}' '{"results":[{"slug":"nocturne-label"}]}'
is "no export: the rubric version is null" "$(field "$W5/build-manifest.json" .rubric_version)" "null"
is "no export: and it says so, rather than leaving the reader to notice" \
  "$(field "$W5/build-manifest.json" .rubric_unverified)" "true"

# =====================================================================================
# 6. AN OLDER MANIFEST is upgraded in place. Every field it already had survives.
# =====================================================================================
W6="$TMP/w6"; mkdir -p "$W6"
cat > "$W6/build-manifest.json" <<'OLD'
{
  "schema": 3,
  "created_at": "2026-09-01T00:00:00.000Z",
  "project": null,
  "business": "a pelvic health clinic",
  "mcp_calls": [],
  "references_surveyed": ["therapy-in-london"],
  "inner_pages_viewed": [],
  "layers_read": [],
  "files_written": ["src/pages/index.astro"],
  "sections": []
}
OLD
call "$W6" "mcp__palate__refs_list_verticals" '{}' "$VERTICALS"
MAN6="$W6/build-manifest.json"
is "an older manifest gains the stamps"        "$(field "$MAN6" .library.references)" "2170"
# An older manifest that never sees a stamp must READ as unverified, not as an absent field:
# the flag is what a later reader checks, so it has to be there on a manifest that predates it.
W7="$TMP/w7"; mkdir -p "$W7"
cat > "$W7/build-manifest.json" <<'OLDER'
{ "schema": 3, "created_at": "2026-09-01T00:00:00.000Z", "project": null, "mcp_calls": [],
  "references_surveyed": [], "inner_pages_viewed": [], "layers_read": [], "files_written": [], "sections": [] }
OLDER
call "$W7" "mcp__palate__refs_search" '{"query":"bakery"}' '{"results":[{"slug":"nocturne-label"}]}'
is "an older manifest with no stamp reads unverified" "$(field "$W7/build-manifest.json" .library_unverified)" "true"
is "and the same for the rubric"                      "$(field "$W7/build-manifest.json" .rubric_unverified)" "true"
is "and keeps the survey it already had"       "$(field "$MAN6" '.references_surveyed[0]')" "therapy-in-london"
is "and keeps its business brief"              "$(field "$MAN6" .business)" "a pelvic health clinic"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
