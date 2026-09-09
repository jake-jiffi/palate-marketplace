#!/usr/bin/env bash
# EVERY GATE SAYS HOW MUCH IT READ, AND ZERO IS A SKIP.
#
# THE FAULT THIS PINS. A gate that walks a tree, finds nothing to walk, and exits 0 is
# indistinguishable in a transcript from a gate that read a hundred files and found them clean.
# That is how a real client build passed everything with the manifest in one directory and the
# site in another: the gates ran, inspected nothing, and reported clean. So each gate now prints
# the count it inspected, and a count of zero is a SKIP with a reason and exit 2, never a pass.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$DIR/.."
pass=0; fail=0

ok()   { echo "ok   - $1"; pass=$((pass+1)); }
bad()  { echo "FAIL - $1"; fail=$((fail+1)); }
want_rc() { # <desc> <want> <got>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (exit $3, want $2)"; fi
}
want_in() { # <desc> <haystack> <needle>
  if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1 (no '$3' in: $2)"; fi
}
want_re() { # <desc> <haystack> <regex>
  if printf '%s' "$2" | grep -qE "$3"; then ok "$1"; else bad "$1 (no /$3/ in: $2)"; fi
}

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# COPIED OUT OF THE REPO. ux-lint and palate-verify refuse any directory inside a Claude Code
# plugin checkout, and this suite's clean fixture lives in one.
cp -R "$DIR/fixtures/uxlint/good" "$TMP/lint-good"

# ---------------------------------------------------------------- gate-shipready
# An Astro shape with nothing in it: the project check passes and the scan reads no file.
EMPTY="$TMP/shipready-empty"; mkdir -p "$EMPTY/src/pages"
out="$(node "$SCRIPTS/gate-shipready.mjs" "$EMPTY" 2>&1)"; rc=$?
want_rc "gate-shipready with nothing to read -> exit 2" 2 "$rc"
want_in "and it says it skipped, with a reason" "$out" "skipped (nothing to inspect"

FULL="$TMP/shipready-full"; mkdir -p "$FULL/src/pages"
printf -- '---\n---\n<h1>Clean</h1>\n' > "$FULL/src/pages/index.astro"
out="$(node "$SCRIPTS/gate-shipready.mjs" "$FULL" 2>&1)"; rc=$?
want_rc "gate-shipready on a real project -> exit 0" 0 "$rc"
want_re "and its clean line says how many files it read" "$out" 'inspected [1-9][0-9]* file'

# ---------------------------------------------------------------------- gate-seo
# A built site whose src/pages holds no route at all: the sitemap and the build output are
# there, so every earlier rung passes, and the coverage check has nothing to compare.
NOROUTES="$TMP/seo-noroutes"; mkdir -p "$NOROUTES/src/pages" "$NOROUTES/dist"
printf '<?xml version="1.0"?><urlset></urlset>' > "$NOROUTES/dist/sitemap-0.xml"
out="$(node "$SCRIPTS/gate-seo.mjs" "$NOROUTES" 2>&1)"; rc=$?
want_rc "gate-seo with no routes to check -> exit 2" 2 "$rc"
want_in "and it says it skipped, with a reason" "$out" "skipped (nothing to inspect"

ROUTES="$TMP/seo-routes"; mkdir -p "$ROUTES/src/pages" "$ROUTES/dist/about"
printf -- '---\n---\n<h1>Home</h1>\n' > "$ROUTES/src/pages/index.astro"
printf -- '---\n---\n<h1>About</h1>\n' > "$ROUTES/src/pages/about.astro"
printf '<!doctype html><html><head><link rel="canonical" href="https://x.test/"></head><body>h</body></html>' > "$ROUTES/dist/index.html"
printf '<!doctype html><html><head><link rel="canonical" href="https://x.test/about"></head><body>a</body></html>' > "$ROUTES/dist/about/index.html"
printf '<?xml version="1.0"?><urlset><url><loc>https://x.test/</loc></url></urlset>' > "$ROUTES/dist/sitemap-0.xml"
out="$(node "$SCRIPTS/gate-seo.mjs" "$ROUTES" 2>&1)"
want_re "gate-seo says how many routes it read" "$out" 'inspected [1-9][0-9]* route'

# ----------------------------------------------------------------------- ux-lint
NOFILES="$TMP/lint-empty"; mkdir -p "$NOFILES"
out="$(bash "$SCRIPTS/ux-lint.sh" "$NOFILES" 2>&1)"; rc=$?
want_rc "ux-lint with no matching source -> exit 2" 2 "$rc"
want_in "and it says it skipped, with a reason" "$out" "skipped (nothing to inspect"

out="$(bash "$SCRIPTS/ux-lint.sh" "$TMP/lint-good" 2>&1)"
want_re "ux-lint says how many files it read" "$out" 'inspected [1-9][0-9]* file'

# --------------------------------------------------------------- verify-scaffold
# A stub build, so this needs no network and no Astro: npm run build makes the dist it checks.
VS="$TMP/scaffold"; mkdir -p "$VS/node_modules"
printf '{"name":"stub","scripts":{"build":"mkdir -p dist && printf x > dist/index.html"}}' > "$VS/package.json"
out="$(cd "$VS" && bash "$SCRIPTS/verify-scaffold.sh" 2>&1)"; rc=$?
want_rc "verify-scaffold on a built stub -> exit 0" 0 "$rc"
want_re "and it says how many built files it read" "$out" 'inspected [1-9][0-9]* file'

# ------------------------------------------------------------------- bootstrap.sh
# It must pass ux-lint's skip THROUGH as a skip. Reporting "clean at the High bar" over a lint
# that read nothing is the exact failure this epic is about.
out="$(bash "$SCRIPTS/bootstrap.sh" "$NOFILES" 2>&1)"; rc=$?
want_rc "palate-check over an empty target -> exit 2" 2 "$rc"
want_in "and it refuses to call it clean" "$out" "SKIPPED"

# ----------------------------------------------------------------- palate-verify
# PALATE_SKIP_ASTRO=1 so this needs no compiling Astro project: the point is that the PASS line
# NAMES what ran and what did not, rather than reading as two gates passing.
out="$(env PALATE_SKIP_ASTRO=1 bash "$SCRIPTS/palate-verify.sh" "$TMP/lint-good" 2>&1)"; rc=$?
want_rc "palate-verify with the Astro gate skipped -> exit 0" 0 "$rc"
want_in "and the PASS line names the gate that ran"     "$out" "ran: anti-slop lint"
want_in "and names the one that was skipped"            "$out" "skipped: anti-freestyle"

# ZERO GATES RUN IS NOT A PASS. With the Astro gate switched off and a lint that could not
# inspect anything, this printed "PASS (ran: none; ...)" and exited 0: a green exit code over
# nothing measured, in the epic whose rule is that a gate never exits 0 having inspected nothing.
out="$(env PALATE_SKIP_ASTRO=1 bash "$SCRIPTS/palate-verify.sh" "$NOFILES" 2>&1)"; rc=$?
want_rc "palate-verify with nothing inspected -> exit 2" 2 "$rc"
want_in "and it says SKIPPED rather than PASS" "$out" "palate-verify: SKIPPED (ran: none"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
