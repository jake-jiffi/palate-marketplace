#!/usr/bin/env bash
# Tests that a machine with no usable `bash` gets a SKIP that says so, never a verdict.
#
# Every deterministic gate is a shell script and the hooks spawn `bash` directly. Where there
# is no bash (Windows outside WSL or Git Bash), execFileSync throws with no exit status, and
# the Stop hook read that as "blocked": a Windows user was told, on every build, that their
# site had failed a quality gate, by machinery that had never looked at it. Worse, the
# grounding record still said "grounded" whenever any MCP call existed, so a build nothing had
# measured claimed it had been.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$DIR/../../hooks/palate-stop.mjs"
pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }

# A `bash` on PATH that exits 127, which is what a missing interpreter looks like.
mkdir -p "$TMP/fakebin"
printf '#!/usr/bin/env sh\nexit 127\n' > "$TMP/fakebin/bash"
chmod +x "$TMP/fakebin/bash"

P="$TMP/proj"; mkdir -p "$P/src/pages"; echo '{}' > "$P/package.json"
manifest() {
  cat > "$P/build-manifest.json" <<JSON
{ "schema": 3, "project": "$P",
  "mcp_calls": [ { "tool": "mcp__palate__refs_search", "slugs": ["a"], "evidence": "content" } ],
  "references_surveyed": ["a"], "files_written": ["src/pages/index.astro"] }
JSON
}

manifest
OUT=$(printf '{"cwd":"%s","stop_hook_active":false}' "$P" | PATH="$TMP/fakebin:$PATH" node "$HOOK" 2>&1)
EC=$?

[ "$EC" -eq 0 ] && ok "the hook still exits 0 (a missing shell never wedges a session)" \
  || bad "the hook exited $EC"
printf '%s' "$OUT" | grep -qF "SKIPPED, not passed" \
  && ok "it says the gates were skipped, not passed" || bad "it did not say the gates were skipped"
printf '%s' "$OUT" | grep -qiE "not done|did not draw on the library" \
  && bad "it still reports a failed gate it never ran" || ok "it does NOT claim the build failed a gate"
printf '%s' "$OUT" | grep -qiE "WSL|Git Bash" \
  && ok "it names the way to get the gates back" || bad "it does not say what to do about it"

GROUND=$(jq -r '.grounding.state' "$P/build-manifest.json" 2>/dev/null)
[ "$GROUND" = "unknown" ] && ok "grounding records \"unknown\", not \"grounded\"" \
  || bad "grounding recorded \"$GROUND\" when nothing could measure it"

# The control: with a REAL bash the behaviour must be exactly what it always was.
manifest
OUT2=$(printf '{"cwd":"%s","stop_hook_active":false}' "$P" | node "$HOOK" 2>&1)
printf '%s' "$OUT2" | grep -qF "SKIPPED, not passed" \
  && bad "the no-shell path fired on a machine that HAS bash" || ok "with bash present, the skip does not fire"
printf '%s' "$OUT2" | grep -qiE "MCP-depth gate" \
  && ok "with bash present, the real gate verdict comes through" || bad "the real gate did not run"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
