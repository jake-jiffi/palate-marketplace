#!/usr/bin/env bash
# Tests the portable MCP-depth gate against known-good / known-bad manifests.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../gate-mcp-depth.sh"
pass=0; fail=0

check() { # desc  expected_exit  manifest_path
  bash "$GATE" "$3" >/dev/null 2>&1
  local ec=$?
  if [ "$ec" -eq "$2" ]; then
    echo "ok   - $1"; pass=$((pass + 1))
  else
    echo "FAIL - $1 (exit $ec, want $2)"; fail=$((fail + 1))
  fi
}

check "deep build passes" 0 "$DIR/fixtures/manifest-deep.json"
check "shallow build is blocked" 2 "$DIR/fixtures/manifest-shallow.json"
# Fail-open contract: a missing manifest is NOT a tracked build, so the gate SKIPS
# (exit 0), never blocks. A public-plugin user editing an existing app, or one whose
# MCP token is not set, must never be trapped. (The gate is the spine of the fail-open
# invariant; this asserts the contract the gate actually implements, not a stricter one.)
check "missing manifest skips (fail-open)" 0 "$DIR/fixtures/no-such-manifest.json"
check "token/concept-only read is blocked (R2 rich-layer gate)" 2 "$DIR/fixtures/manifest-token-only.json"
check "layer:pages counts as a rich read" 0 "$DIR/fixtures/manifest-pages.json"

# --- THE THIRD STATE (UNGROUNDED) ---------------------------------------------
# A readable manifest that recorded ZERO Palate MCP calls is UNGROUNDED (exit 3): the
# build ran with no taste layer. It is a LABEL, not a block and not a silent skip. If
# this ever returns 0 again the absence is invisible (the original bug); if it returns 2
# the non-blocking signal has become a hard block, the exact inversion the state exists
# to avoid.
check "zero MCP calls is UNGROUNDED (3), not a skip and not a block" 3 "$DIR/fixtures/manifest-ungrounded.json"
# The floor survives the third state: a build that DID reach the MCP but stayed shallow
# is still a real block, so UNGROUNDED did not swallow the gate it sits in front of.
check "shallow but CONNECTED build is still blocked (floor intact)" 2 "$DIR/fixtures/manifest-shallow.json"
# "Nothing to gate" must stay exit 0 and must NOT be relabelled ungrounded: a missing
# manifest is not a tracked build, and a missing jq is a tooling gap, neither of which
# says anything about whether the MCP was used. (missing manifest is asserted above.)
BASH_BIN="$(command -v bash)"
PATH="/nonexistent" "$BASH_BIN" "$GATE" "$DIR/fixtures/manifest-ungrounded.json" >/dev/null 2>&1
ec=$?
if [ "$ec" -eq 0 ]; then
  echo "ok   - missing jq still skips (exit 0), never UNGROUNDED"; pass=$((pass + 1))
else
  echo "FAIL - missing jq still skips (exit 0), never UNGROUNDED (exit $ec, want 0)"; fail=$((fail + 1))
fi

# An UNREADABLE manifest is a tooling/corruption problem, not evidence of anything. It must
# SKIP (exit 0), never be mislabelled UNGROUNDED: `jq length` on a corrupt file yields 0 the
# same way an empty mcp_calls array does, so without the readability rung in front of it a
# broken file would be reported as a build that ran without the taste layer. That is a
# fabricated fact about the customer's build, which is the class of error the third state
# exists to remove rather than create.
BAD="$(mktemp -d)/manifest-corrupt.json"
printf '{ this is not json' > "$BAD"
check "unreadable manifest skips (0), never UNGROUNDED" 0 "$BAD"

# The label must never be recorded as its opposite. recordGrounding() in the Stop hook derives
# the state from the gate's exit code AND the telemetry, because exit 0 means three different
# things and only one of them is "passed". With jq absent the gate skips, so a naive
# "not exit 3 means grounded" would stamp {state:"grounded", mcp_calls:0} on disk: a record
# that contradicts itself across its own two fields, asserting the taste layer was present on
# a build that had none.
STOP_HOOK="$DIR/../../hooks/palate-stop.mjs"
gstate() { # manifest_dir -> prints the recorded grounding state
  printf '{"cwd":"%s"}' "$1" | HOME="$2" node "$STOP_HOOK" >/dev/null 2>&1
  node -e "try{process.stdout.write(String((JSON.parse(require('fs').readFileSync('$1/build-manifest.json','utf8')).grounding||{}).state))}catch(e){process.stdout.write('none')}"
}
GD="$(mktemp -d)"; GH="$(mktemp -d)"
printf '{"files_written":["src/pages/x.astro"],"mcp_calls":[]}' > "$GD/build-manifest.json"
got="$(gstate "$GD" "$GH")"
if [ "$got" = "ungrounded" ]; then
  echo "ok   - zero MCP calls is recorded as ungrounded"; pass=$((pass + 1))
else
  echo "FAIL - zero MCP calls recorded as '$got', want ungrounded"; fail=$((fail + 1))
fi

# Same manifest, gate unable to run. Must be "unknown", and must NOT be "grounded".
printf '{"files_written":["src/pages/x.astro"],"mcp_calls":[]}' > "$GD/build-manifest.json"
NOJQ="$(mktemp -d)"
for b in bash node sed grep cat mktemp dirname; do
  src="$(command -v "$b" 2>/dev/null)" && ln -sf "$src" "$NOJQ/$b"
done
printf '{"cwd":"%s"}' "$GD" | PATH="$NOJQ" HOME="$GH" "$(command -v node)" "$STOP_HOOK" >/dev/null 2>&1
got="$(node -e "try{process.stdout.write(String((JSON.parse(require('fs').readFileSync('$GD/build-manifest.json','utf8')).grounding||{}).state))}catch(e){process.stdout.write('none')}")"
if [ "$got" != "grounded" ]; then
  echo "ok   - zero MCP calls is never recorded as grounded (got '$got')"; pass=$((pass + 1))
else
  echo "FAIL - zero MCP calls recorded as grounded, which is a fabricated fact"; fail=$((fail + 1))
fi

# THE INVERSION GUARD. Under PALATE_GATE_STRICT=1 the write gate must ALLOW an ungrounded
# build and DENY a shallow connected one. If exit 3 ever starts denying, every source write is
# blocked for exactly the person whose MCP is not connected, and nothing else in the suite
# would go red.
PRE_HOOK="$DIR/../../hooks/palate-pretooluse.mjs"
PD="$(mktemp -d)"; mkdir -p "$PD/src/pages"
printf '{"files_written":["src/pages/x.astro"],"mcp_calls":[]}' > "$PD/build-manifest.json"
out="$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/src/pages/about.astro"},"cwd":"%s"}' "$PD" "$PD" \
  | PALATE_GATE_STRICT=1 node "$PRE_HOOK" 2>/dev/null)"
if ! printf '%s' "$out" | grep -q '"deny"'; then
  echo "ok   - strict mode ALLOWS an ungrounded write (exit 3 is not a block)"; pass=$((pass + 1))
else
  echo "FAIL - strict mode DENIED an ungrounded write; the third state has inverted"; fail=$((fail + 1))
fi

cp "$DIR/fixtures/manifest-shallow.json" "$PD/build-manifest.json"
node -e "const f='$PD/build-manifest.json',fs=require('fs');const m=JSON.parse(fs.readFileSync(f,'utf8'));m.files_written=['src/pages/x.astro'];fs.writeFileSync(f,JSON.stringify(m));"
out="$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/src/pages/about.astro"},"cwd":"%s"}' "$PD" "$PD" \
  | PALATE_GATE_STRICT=1 node "$PRE_HOOK" 2>/dev/null)"
if printf '%s' "$out" | grep -q '"deny"'; then
  echo "ok   - strict mode still DENIES a shallow connected write (floor intact)"; pass=$((pass + 1))
else
  echo "FAIL - strict mode allowed a shallow connected write; the depth floor is gone"; fail=$((fail + 1))
fi

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
