#!/usr/bin/env bash
# Proves the board components against a REAL build, because every claim they make is a claim
# about rendered output.
#
# A board is what the client is shown instead of eight complete home pages, so the three
# things it has to carry are the three things that are easy to leave out and impossible to
# notice missing from the source: the system strip (which is how two boards with different
# tokens are seen to differ at all), the notes (which are the argument the rung makes for
# itself), and noindex (a board is a working document on a publicly fetchable origin).
#
# Slow by construction: an npm install and an astro build. scripts/test/run.sh skips it under
# --fast. Exit 2 with a reason wherever it cannot measure, never a silent pass.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
export SCAFFOLD_TEMPLATE="$ROOT/templates/astro-project"
# shellcheck source=lib/scaffold-site.sh
. "$DIR/lib/scaffold-site.sh"

pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }
has() { # <label> <needle>
  if grep -qF -- "$2" "$HTML"; then ok "$1"; else bad "$1 (missing: $2)"; fi
}

command -v node >/dev/null 2>&1 || { echo "board-components: node is required. NOT a pass." >&2; exit 2; }
command -v npm  >/dev/null 2>&1 || { echo "board-components: npm is required to build the template. NOT a pass." >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SITE="$TMP/site"

scaffold_site "$SITE" boardtest || exit 2

# The registry the scaffold ships is empty (its example is commented out), so the fixture
# registers the one board the template also ships as a worked example.
cat > "$SITE/src/lib/variants.registered.ts" <<'TS'
TS
node -e '
const fs = require("node:fs");
const p = process.argv[1] + "/src/lib/variants.ts";
let s = fs.readFileSync(p, "utf8");
const entry = `  {
    id: "b1",
    name: "The Quiet Room",
    href: "/boards/b1",
    ambition: 1,
    what: "One column, one photograph, and a great deal of air.",
    why: "The people arriving are anxious and have been dismissed once already, so nothing asks anything of them before they have read a sentence.",
    feeling: "unhurried, private, adult",
    donor: "therapy-in-london",
    section: "services",
    motion: "Nothing moves on load. A single slow fade carries the photograph in once it is scrolled to, and that is the whole budget.",
    ctas: ["Book a first visit", "Ask a question"],
    lookAt: "The way the first screen holds one idea rather than a menu of them.",
  },
`;
s = s.replace(/export const variants: Variant\[\] = \[/, "export const variants: Variant[] = [\n" + entry);
fs.writeFileSync(p, s);
' "$SITE"
rm -f "$SITE/src/lib/variants.registered.ts"

# BUILT AS PRODUCTION, deliberately. BaseLayout emits noindex on every non-production build
# as well, so a preview build would print the tag whether or not BoardFrame asked for it and
# the noindex assertion below would pass with the prop deleted. Building as production leaves
# the prop as the only thing that can put it there.
( cd "$SITE" && PUBLIC_SITE_ENV=production ./node_modules/.bin/astro build ) > "$TMP/build.log" 2>&1 || {
  echo "board-components: the template did not build, so the components are UNPROVEN. Last lines:" >&2
  tail -15 "$TMP/build.log" >&2; exit 2; }

# The Vercel adapter writes the static output under dist/client; a bare Astro build writes it
# under dist. Look in both rather than assume, because the answer changes with the host.
HTML=""
for cand in "$SITE/dist/client/boards/b1/index.html" "$SITE/dist/boards/b1/index.html"; do
  [ -f "$cand" ] && { HTML="$cand"; break; }
done
[ -n "$HTML" ] || { bad "the board route did not build to boards/b1/index.html"; echo "passed=$pass failed=$fail"; exit 1; }
ok "the board route builds to boards/b1/index.html"

# --- THE SYSTEM STRIP IS GONE, AND SO ARE ITS FIFTEEN ASSERTIONS ------------------------
#
# This block asserted that every board renders a type ramp (Display / Heading 1 / Heading 2 /
# Body / Small), a palette (Ground / Ink / Muted / Accent / Accent on dark), a control pair, a
# card and a nav. Those assertions were correct about the code and wrong about the product: the
# strip was identical in layout on every board, so five directions collapsed to sameness below
# the hero, and it showed type DISPLAYED rather than type IN USE.
#
# Jake rejected it on sight, 2026-09-09: "they all have different headers but everything else is
# about the same and its showing font use and stuff, which i thought would just be the actual use
# of them on the website". A test that asserts a rejected feature is not a safety net, it is the
# feature's last defender, and leaving it here is how the strip came back after being removed
# from one project by hand.
#
# A board now carries real sections composed from the website kit, which is what a client can
# actually judge. The kit has its own gates: gate-kit-tokens.mjs and gate-kit-complete.mjs.

# --- the notes: the argument the rung makes for itself ---------------------------------
has "the notes carry the name"    "The Quiet Room"
has "the notes carry what"        "One column, one photograph"
has "the notes carry why"         "have been dismissed once already"
has "the notes carry the feeling" "unhurried, private, adult"
has "the notes carry the motion plan" "A single slow fade carries the photograph"
has "the notes carry the donor"   "therapy-in-london"
has "the notes carry the section" "services"
has "the notes carry the CTA options" "Book a first visit"
has "the notes carry the second CTA"  "Ask a question"
has "the notes carry lookAt"      "holds one idea rather than a menu"

# --- noindex: a board is a working document on a public origin -------------------------
has "the board page is noindex" '<meta name="robots" content="noindex">'

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
