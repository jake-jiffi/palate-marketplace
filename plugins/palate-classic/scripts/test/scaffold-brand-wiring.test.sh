#!/usr/bin/env bash
# Tests the brand-wiring half of scripts/verify-is-real-astro.sh, plus the scaffold's
# npm scope.
#
# WHY IT EXISTS. Step 3 of the gate ("the brand package is consumed") used to fall back to
# `grep -q "vendored" .palate-skill-state.json`. That could never fail: state-init.sh writes
# `"vendored": false` into every build's state and create-palate.sh writes a note ending
# "the anti-freestyle gate reads the vendored marker", so the substring is present on a
# build with no brand wired at all. The check was decorative for its whole life and nothing
# tested it.
#
# The fixtures stop at step 4 (no src/layouts) on purpose, so the suite never runs
# `npm run build` and never needs the network.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$DIR/../verify-is-real-astro.sh"
TPL="$DIR/../../templates/astro-project"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()   { echo "ok   - $1"; pass=$((pass+1)); }
bad()  { echo "FAIL - $1"; fail=$((fail+1)); }

fixture() { # $1 = state json (empty string = no state file), $2 = extra deps json
  rm -rf "$TMP/p"; mkdir -p "$TMP/p"; cd "$TMP/p"
  printf '{ "name":"x","dependencies":{"astro":"7.2.0"%s} }' "$2" > package.json
  echo 'import vercel from "@astrojs/vercel";' > astro.config.mjs
  [ -n "$1" ] && printf '%s' "$1" > .palate-skill-state.json
  cd "$TMP/p"
}

# The message step 3 emits. Present = the brand check fired. Absent = it passed step 3.
MSG="brand package not consumed"

run_gate() { bash "$GATE" 2>&1; }

# 1. The exact false pass: the word "vendored" only in a note, brand not wired.
fixture '{ "brand": "package", "note": "the anti-freestyle gate reads the vendored marker." }' ""
out="$(run_gate)"
case "$out" in *"$MSG"*) ok "a 'vendored' mention in a note does not count as a wired brand";;
  *) bad "note-only 'vendored' still passes the brand check (got: $(printf '%s' "$out" | head -1))";; esac

# 2. The other false pass: state-init.sh's own `"vendored": false`.
fixture '{ "brand": { "mode": null, "vendored": false } }' ""
out="$(run_gate)"
case "$out" in *"$MSG"*) ok "\"vendored\": false does not count as a wired brand";;
  *) bad "\"vendored\": false still passes the brand check";; esac

# 3. No state file and no brand dependency: must fail, not fall through silently.
fixture "" ""
out="$(run_gate)"
case "$out" in *"$MSG"*) ok "no brand dependency and no state fails the brand check";;
  *) bad "an unwired brand with no state file passes";; esac

# 4. Genuinely vendored, state-init shape.
fixture '{ "brand": { "mode": "vendored", "vendored": true } }' ""
out="$(run_gate)"
case "$out" in *"$MSG"*) bad "a genuinely vendored brand is rejected (false negative)";;
  *) ok "vendored:true passes the brand check";; esac

# 5. Genuinely vendored, portable-starter shape written by create-palate.sh.
fixture '{ "brand": "vendored", "note": "portable starter" }' ""
out="$(run_gate)"
case "$out" in *"$MSG"*) bad "the portable starter's {\"brand\":\"vendored\"} is rejected";;
  *) ok "the portable starter's brand marker passes the brand check";; esac

# 6. A real brand dependency, no state file at all.
fixture "" ',"@palate-projects/x-brand":"1.0.0"'
out="$(run_gate)"
case "$out" in *"$MSG"*) bad "a real @palate-projects dependency is rejected";;
  *) ok "a @palate-projects brand dependency passes the brand check";; esac

# 7. A state file that will not parse must fail LOUD, not read as a pass.
fixture '{ "brand": "vendored"' ""
out="$(run_gate)"
case "$out" in *"not valid JSON"*) ok "an unparseable state file fails loudly instead of passing";;
  *) bad "a corrupt state file did not produce a loud failure (got: $(printf '%s' "$out" | head -1))";; esac

# 8. The scaffold's .npmrc must map the scope the scaffold's package.json depends on.
#    They disagreed: .npmrc mapped @jiffi-projects (our org) while the brand convention
#    and package.json are @palate-projects, so a handed-over client site resolved its
#    brand from the public registry and 404'd, and any package that DID exist would have
#    come from a scope the client does not own.
scope="$(sed -n 's/^@\([a-z-]*\):registry=.*/\1/p' "$TPL/.npmrc" | head -1)"
dep="$(grep -o '@[a-z-]*-projects/' "$TPL/package.json" | head -1 | tr -d '@/')"
if [ "$scope" = "$dep" ]; then ok ".npmrc scope (@$scope) matches the brand dependency scope (@$dep)"
else bad ".npmrc maps @$scope but package.json depends on @$dep"; fi
case "$(cat "$TPL/.npmrc")" in *jiffi-projects*) bad ".npmrc still maps @jiffi-projects";; *) ok ".npmrc no longer maps @jiffi-projects";; esac

echo ""; echo "scaffold-brand-wiring: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
