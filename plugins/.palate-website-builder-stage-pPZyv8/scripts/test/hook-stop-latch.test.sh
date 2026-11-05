#!/usr/bin/env bash
# Tests two things hooks/palate-stop.mjs got wrong, both about a gate that does not reach.
#
# 1. THE BLOCK WAS DOWNGRADED. gate-shipready.mjs fails a build for unresolved {{PLACEHOLDER}}
#    tokens, rejected Explore concepts still routed on the client's domain, and photographs
#    nobody ever measured. It ran only inside gate-done.sh, whose failures palate-stop turns
#    into a stderr nudge unless PALATE_GATE_STRICT=1, so on a default install those findings
#    reached nobody. All three are client-facing damage and must block like every other piece
#    of positive on-disk evidence.
#
# 2. THE RELEASE WAS FREE. A blocked build proceeded on the very next stop, because
#    `stop_hook_active` released the hook unconditionally. Stopping twice cleared the gate with
#    the same failures still on disk. The evidence now has to MOVE, and the latch is bounded so
#    it cannot loop forever.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$DIR/../hooks/palate-stop.mjs"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()   { echo "ok   - $1"; pass=$((pass+1)); }
bad()  { echo "FAIL - $1"; fail=$((fail+1)); }
want() { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 (got $2 want $3)"; fi; }

# A minimal Astro-shaped project that passes every OTHER positive check: no console errors, no
# overflow, verdict pass, no interaction failures. Only ship-readiness is in question.
mkproj() {
  local d="$T/$1"; rm -rf "$d"
  mkdir -p "$d/src/pages" "$d/.palate-shots"
  printf '{"name":"site"}\n' > "$d/package.json"
  printf '{"files_written":["%s/src/pages/index.astro"]}\n' "$d" > "$d/build-manifest.json"
  printf '{"console_errors":0,"overflow":{"desktop":0},"sections":[]}' > "$d/.palate-shots/manifest.json"
  printf '{"verdict":"pass","visual":{"ran":true,"pass":true,"console_errors":0}}' > "$d/verify-report.json"
  printf -- '---\n---\n<h1>Home</h1>\n' > "$d/src/pages/index.astro"
  # The build-site marker. gate-shipready judges the seam between built and DELIVERABLE, so it
  # is scoped to an active BUILD SITE exactly like the DIVERGE wall: one of its findings is an
  # absence, and an absence check outside its own flow traps people editing their own site.
  printf '{"schemaVersion":"1.2","brandMode":"brand-creation"}' > "$d/.palate-skill-state.json"
  echo "$d"
}

# Runs the Stop hook against a project and reports BLOCK or allow.
run() { # dir [stop_hook_active]
  local d="$1" active="${2:-false}"
  if echo "{\"cwd\":\"$d\",\"stop_hook_active\":$active}" | node "$HOOK" 2>/dev/null | grep -q '"decision":"block"'; then
    echo BLOCK
  else
    echo allow
  fi
}

# ---------------------------------------------------------- 1. ship-ready blocks by default
clean="$(mkproj clean)"
want "a ship-ready project is allowed" "$(run "$clean")" allow

ph="$(mkproj placeholder)"
printf -- '---\n---\n<script src="https://x.test/{{HUMBLYTICS_SITE_ID}}.js"></script>\n' > "$ph/src/pages/index.astro"
want "an unresolved {{PLACEHOLDER}} blocks by default (no PALATE_GATE_STRICT)" "$(run "$ph")" BLOCK

# The whole point of the finding: the same evidence used to be a stderr line nobody reads.
if echo "{\"cwd\":\"$ph\"}" | node "$HOOK" 2>/dev/null | grep -q 'HUMBLYTICS_SITE_ID'; then
  ok "the block names the actual token, not a generic 'not ready'"
else
  bad "the block names the actual token, not a generic 'not ready'"
fi

expl="$(mkproj explore)"
printf '{"files_written":["%s/src/pages/index.astro"],"explore":{"ran":true,"picks":[{"surface":"home","variant_id":"v3"}]},"variants":[{"id":"v3"}]}\n' "$expl" > "$expl/build-manifest.json"
printf -- '---\n---\n<h1>v1</h1>\n' > "$expl/src/pages/v1.astro"
want "rejected Explore concepts left live block by default" "$(run "$expl")" BLOCK

img="$(mkproj images)"
printf -- '---\n---\n<img src="/hero.jpg" alt="team">\n' > "$img/src/pages/index.astro"
want "photographs never measured block by default" "$(run "$img")" BLOCK

off="$(mkproj escape)"
printf -- '---\n---\n<script src="https://x.test/{{HUMBLYTICS_SITE_ID}}.js"></script>\n' > "$off/src/pages/index.astro"
if PALATE_GATE_OFF=1 echo >/dev/null; then :; fi
res="$(echo "{\"cwd\":\"$off\"}" | PALATE_GATE_OFF=1 node "$HOOK" 2>/dev/null | grep -c '"decision":"block"' || true)"
want "PALATE_GATE_OFF=1 still bypasses everything" "$res" 0

# A non-Astro directory has no src/pages, so gate-shipready exits 2 (cannot check). Cannot
# check must never read as a block, and must never read as a pass either.
noast="$T/noastro"; mkdir -p "$noast/.palate-shots"
printf '{"files_written":["src/pages/index.astro"]}\n' > "$noast/build-manifest.json"
printf '{"console_errors":0,"overflow":{"desktop":0},"sections":[]}' > "$noast/.palate-shots/manifest.json"
printf '{"verdict":"pass","visual":{"ran":true,"pass":true,"console_errors":0}}' > "$noast/verify-report.json"
want "cannot-check (no src/pages) does not block" "$(run "$noast")" allow

# THE FALSE-TRAP THIS SCOPING EXISTS FOR: someone editing their own Astro site with the plugin
# installed, no Palate build in flight. "photos never measured" is an ABSENCE finding, so
# without the marker it would block every such session on a site that uses an <img>.
edit="$(mkproj ordinaryedit)"
rm -f "$edit/.palate-skill-state.json"
printf -- '---\n---\n<img src="/hero.jpg" alt="team">\n' > "$edit/src/pages/index.astro"
want "an ordinary Astro edit session (no build-site marker) is NOT blocked" "$(run "$edit")" allow

# ------------------------------------------------------------------- 2. the release latch
latch="$(mkproj latch)"
printf -- '---\n---\n<script src="https://x.test/{{HUMBLYTICS_SITE_ID}}.js"></script>\n' > "$latch/src/pages/index.astro"

want "attempt 1 blocks"                                  "$(run "$latch")"      BLOCK
want "stopping again does NOT release it (attempt 2)"    "$(run "$latch" true)" BLOCK
want "stopping again does NOT release it (attempt 3)"    "$(run "$latch" true)" BLOCK
want "the latch is bounded: attempt 4 releases"          "$(run "$latch" true)" allow

# The release must be audible. A release that reads like a pass is the failure this file exists
# for, so the outstanding failures are printed on stderr.
noise="$(echo "{\"cwd\":\"$latch\",\"stop_hook_active\":true}" | node "$HOOK" 2>&1 >/dev/null | grep -c 'RELEASING' || true)"
if [ "$noise" -ge 1 ]; then ok "the release says so on stderr, with the failures listed"; else bad "the release says so on stderr, with the failures listed"; fi

# Changed evidence resets the unchanged counter, so real progress is never punished.
prog="$(mkproj progress)"
printf -- '---\n---\n<script src="https://x.test/{{HUMBLYTICS_SITE_ID}}.js"></script>\n' > "$prog/src/pages/index.astro"
run "$prog" >/dev/null; run "$prog" true >/dev/null; run "$prog" true >/dev/null
# Three blocks on the same evidence: one more would release. Now the evidence MOVES.
printf -- '---\n---\n<script src="https://x.test/{{OTHER_TOKEN}}.js"></script>\n' > "$prog/src/pages/index.astro"
want "different evidence resets the unchanged counter and blocks again" "$(run "$prog" true)" BLOCK

# Fixing it clears the latch entirely.
printf -- '---\n---\n<h1>Home</h1>\n' > "$prog/src/pages/index.astro"
want "fixing the finding releases immediately" "$(run "$prog" true)" allow
if node -e "process.exit(JSON.parse(require('fs').readFileSync('$prog/build-manifest.json','utf8')).stop_gate===undefined?0:1)"; then
  ok "the latch is dropped once the evidence clears"
else
  bad "the latch is dropped once the evidence clears"
fi


# A released-but-failing build must NOT reach cross-build memory. recordBuild feeds the novelty
# gate, so a broken build recorded there goes on to certify later builds as different from it.
rel="$(mkproj released)"
printf -- '---\n---\n<script src="https://x.test/{{HUMBLYTICS_SITE_ID}}.js"></script>\n' > "$rel/src/pages/index.astro"
LOG="$HOME/.config/palate/builds.log.json"
before="$( [ -f "$LOG" ] && wc -c < "$LOG" || echo 0 )"
run "$rel" >/dev/null; run "$rel" true >/dev/null; run "$rel" true >/dev/null; run "$rel" true >/dev/null
after="$( [ -f "$LOG" ] && wc -c < "$LOG" || echo 0 )"
[ "$before" = "$after" ] && ok "a released-but-failing build is not written to cross-build memory" \
  || bad "a released-but-failing build is not written to cross-build memory (log grew $before -> $after)"

echo "----"; echo "hook-stop-latch.test: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
