#!/usr/bin/env bash
# /explore is the page the client opens first, and it is the fallback for every tool that
# cannot open a design canvas. So the assertions here are about what a CLIENT can see and do:
# the calibration question above the ladder, the marker where they said they were aiming, one
# card per board carrying its own entrance and its own argument, and the canvas link first when
# there is one.
#
# The last block runs the real rendered gate over the page at 390, 834 and 1440. This page has
# form before: it once shipped eight eyebrow labels, bars that rendered at zero height, and 35
# nodes at 4.17:1 contrast. Reading the source found none of them.
#
# Slow by construction: an npm install, a build and a browser. run.sh skips it under --fast.
# Exit 2 with a reason wherever it cannot measure.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
export SCAFFOLD_TEMPLATE="$ROOT/templates/astro-project"
# shellcheck source=lib/scaffold-site.sh
. "$DIR/lib/scaffold-site.sh"

PORT="${EXPLORE_BOARDS_PORT:-8797}"
pass=0; fail=0
ok()  { echo "ok   - $1"; pass=$((pass+1)); }
bad() { echo "FAIL - $1"; fail=$((fail+1)); }
has() { if grep -qF -- "$2" "$HTML"; then ok "$1"; else bad "$1 (missing: $2)"; fi; }
hasnt() { if grep -qF -- "$2" "$HTML"; then bad "$1 (present: $2)"; else ok "$1"; fi; }

command -v node >/dev/null 2>&1 || { echo "explore-page-boards: node is required. NOT a pass." >&2; exit 2; }
command -v npm  >/dev/null 2>&1 || { echo "explore-page-boards: npm is required. NOT a pass." >&2; exit 2; }

TMP="$(mktemp -d)"
SRV_PID=""
cleanup() {
  [ -n "$SRV_PID" ] && { kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; }
  rm -rf "$TMP"
}
trap cleanup EXIT
SITE="$TMP/site"
scaffold_site "$SITE" boardtest || exit 2

# --- two registered boards, their pages, their card images ------------------------------
cat > "$SITE/src/lib/variants.ts" <<'TS'
export interface Variant {
  id: string; name: string; href: string; ambition: number; what: string; why: string;
  feeling: string; donor: string; section: string; motion: string; ctas: string[];
  clip?: string; lookAt?: string;
}
export const variants: Variant[] = [
  {
    id: "b1", name: "The Quiet Room", href: "/boards/b1", ambition: 1,
    what: "One column, one photograph, and a great deal of air.",
    why: "The people arriving are anxious and have been dismissed once already.",
    feeling: "unhurried, private, adult",
    donor: "therapy-in-london", section: "services",
    motion: "Nothing moves on load; the photograph fades in once it is scrolled to.",
    ctas: ["Book a first visit", "Ask a question"],
  },
  {
    id: "b2", name: "The Long Table", href: "/boards/b2", ambition: 2,
    what: "A wide table of the work, read left to right.",
    why: "This buyer compares before they commit, so the comparison is the page.",
    feeling: "candid, unhurried",
    donor: "the-modern-house", section: "proof",
    motion: "Rows settle into place as the table is scrolled.",
    ctas: ["See the work", "Start a project"],
  },
];
export const landingVariants: Variant[] = [];
export function byAmbition(list: Variant[]): Variant[] {
  return [...list].sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
}
TS
mkdir -p "$SITE/src/pages/boards" "$SITE/public/_explore" "$SITE/.palate/explore"
rm -f "$SITE/src/pages/boards/b1.astro"
for id in b1 b2; do
  cat > "$SITE/src/pages/boards/$id.astro" <<ASTRO
---
import BoardFrame from "../../layouts/BoardFrame.astro";
import SectionMark from "../../components/SectionMark.astro";
import { variants } from "../../lib/variants";
const variant = variants.find((v) => v.id === "$id");
---
{variant && (
  <BoardFrame variant={variant}>
    <section slot="hero" class="bg-brand-bg relative px-6 py-24">
      <SectionMark id="$id-hero" />
      <h1 class="font-display text-brand-text text-5xl">{variant.name}</h1>
    </section>
    <section slot="section" class="bg-brand-bg relative px-6 py-20">
      <SectionMark id="$id-section" />
      <h2 class="font-display text-brand-text text-3xl">{variant.section}</h2>
    </section>
  </BoardFrame>
)}
ASTRO
done

# Real PNGs and JPEGs, so the browser pass measures a page with images in it rather than a
# page of broken icons.
node -e '
const { createRequire } = require("node:module");
const req = createRequire(process.argv[1] + "/scripts/reference-capture/");
const sharp = req("sharp");
const out = process.argv[2];
(async () => {
  for (const [name, w, h] of [["b1.png",1440,900],["b2.png",1440,900],["ref1.jpg",720,450],["ref2.jpg",720,450],["ref3.jpg",720,450]]) {
    const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 236, g: 233, b: 222 } } })
      [name.endsWith(".png") ? "png" : "jpeg"]().toBuffer();
    require("node:fs").writeFileSync(out + "/" + name, buf);
  }
})();
' "$ROOT" "$SITE/public/_explore" || { echo "explore-page-boards: could not write the fixture images (sharp). NOT a pass." >&2; exit 2; }

cat > "$SITE/.palate/explore/refs.json" <<'JSON'
[
  { "slug": "aesop", "name": "Aesop", "position": 1, "why": "Restrained: one photograph and a great deal of air.", "screenshot": "refshots/aesop.png" },
  { "slug": "leoleo", "name": "Leo Leo", "position": 2, "why": "In the middle: confident type, quiet motion.", "screenshot": "refshots/leoleo.png" },
  { "slug": "utsubo", "name": "Utsubo", "position": 3, "why": "Bold: the entrance is an interaction, not a banner.", "screenshot": "refshots/utsubo.png" }
]
JSON

cat > "$SITE/build-manifest.json" <<'JSON'
{
  "schema": 3,
  "project": ".",
  "explore": { "ran": true, "canvas_url": "https://claude.ai/code/artifact/fixture-canvas" },
  "commission": { "intensity": "high", "intensity_asked": 3 }
}
JSON

( cd "$SITE" && PUBLIC_EXPLORE_MODE=true ./node_modules/.bin/astro build ) > "$TMP/build.log" 2>&1 || {
  echo "explore-page-boards: the site did not build, so /explore is UNPROVEN. Last lines:" >&2
  tail -15 "$TMP/build.log" >&2; exit 2; }

HTML=""
for cand in "$SITE/dist/client/explore/index.html" "$SITE/dist/explore/index.html"; do
  [ -f "$cand" ] && { HTML="$cand"; break; }
done
[ -n "$HTML" ] || { bad "/explore did not build"; echo "passed=$pass failed=$fail"; exit 1; }
ok "/explore builds"

# --- the boards, shown rather than listed -----------------------------------------------
has "board b1 shows its entrance"            'data-board-shot="b1"'
has "board b2 shows its entrance"            'data-board-shot="b2"'
has "the b1 card image is the rendered hero"  '/_explore/b1.png'
has "the b2 card image is the rendered hero"  '/_explore/b2.png'
has "each card links to its board"            'href="/boards/b1"'
has "the notes carry what moves"              'What moves'
has "the motion plan is the registry's"       'the photograph fades in once it is scrolled to'
has "the CTA options are offered"             'Book a first visit / Ask a question'
has "the donor travels"                       'the-modern-house'

# --- the calibration row, above the ladder ----------------------------------------------
has "the calibration question is asked"       'how bold you want to be'
has "reference 1 is shown"                    'Aesop'
has "reference 3 is shown"                    'Utsubo'
has "a reference says why it sits there"      'the entrance is an interaction, not a banner'
has "the reference images are served"         '/_explore/ref1.jpg'
# The question has to come BEFORE the ladder or it is not calibrating anything.
qcol=$(grep -bo 'how bold you want to be' "$HTML" | head -1 | cut -d: -f1)
lcol=$(grep -bo 'more restrained' "$HTML" | head -1 | cut -d: -f1)
[ "${qcol:-999999999}" -lt "${lcol:-0}" ] && ok "the calibration question comes before the ladder" \
  || bad "the ladder is drawn before the client has been asked how bold to be"

# --- the marker: where they said they were aiming ---------------------------------------
has "the ladder marks the calibration answer" 'you said about here'
# intensity_asked 3 of 3 references maps to the top rung of a 2-rung ladder.
has "the marker sits on the mapped rung"      'data-asked-rung="2"'

# --- the canvas, first when there is one ------------------------------------------------
has "the canvas is linked"                    'https://claude.ai/code/artifact/fixture-canvas'
ccol=$(grep -bo 'fixture-canvas' "$HTML" | head -1 | cut -d: -f1)
[ "${ccol:-999999999}" -lt "${lcol:-0}" ] && ok "the canvas link comes before the ladder" \
  || bad "the canvas link is buried below the ladder"

# --- and it is still a working document, not a page of the site -------------------------
has "the page is noindex" '<meta name="robots" content="noindex">'

# --- the picker knows which board it is on ----------------------------------------------
# A static build serves /boards/b2/ and the registry records /boards/b2, so a raw equality
# never matched and the pill named the first rung on every board.
B2=""
for cand in "$SITE/dist/client/boards/b2/index.html" "$SITE/dist/boards/b2/index.html"; do
  [ -f "$cand" ] && { B2="$cand"; break; }
done
if [ -n "$B2" ]; then
  pill="$(sed -n 's/.*ev-pill[^>]*>\(.*\)/\1/p' "$B2" | head -c 600)"
  case "$pill" in
    *"The Long Table"*) ok "the picker names the board you are on" ;;
    *) bad "the picker names the wrong board on /boards/b2/ (pill: ${pill:0:120})" ;;
  esac
else
  bad "board b2 did not build, so the picker could not be checked"
fi

# --- the rendered gate, at all three viewports ------------------------------------------
DIST="$(dirname "$(dirname "$HTML")")"
PORT="$PORT" node -e '
const { createServer } = require("node:http");
const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[1]);
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css",
  ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".json":"application/json",
  ".xml":"application/xml", ".txt":"text/plain; charset=utf-8", ".woff2":"font/woff2" };
createServer((req, res) => {
  const url = new URL(req.url, "http://l");
  // Vercel serves the platform analytics script itself. A static server does not, and its 404
  // reads as a console error the page did not cause.
  if (url.pathname === "/_vercel/insights/script.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end("/* stub of the platform script */\n");
    return;
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  for (const f of [p, path.join(p, "index.html"), p + "/index.html"]) {
    try { if (statSync(f).isFile()) {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      res.end(readFileSync(f)); return;
    } } catch {}
  }
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>404</title>");
}).listen(Number(process.env.PORT), () => console.log("READY"));
' "$DIST" > "$TMP/serve.log" 2>&1 &
SRV_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -q READY "$TMP/serve.log" 2>/dev/null && break; sleep 0.5; done
grep -q READY "$TMP/serve.log" || { echo "explore-page-boards: the preview server never came up:" >&2; cat "$TMP/serve.log" >&2; exit 2; }

bash "$ROOT/scripts/verify-rendered.sh" "http://127.0.0.1:$PORT" --routes /explore --no-vitals > "$TMP/verify.txt" 2>&1
rc=$?
if [ "$rc" = "3" ]; then
  echo "explore-page-boards: no browser available for verify-rendered. The page is UNPROVEN at three viewports." >&2
  exit 2
fi
if [ "$rc" = "0" ]; then
  ok "/explore is clean through the rendered gate at 390, 834 and 1440"
else
  bad "/explore has findings through the rendered gate"
  grep -E "High|Medium" "$TMP/verify.txt" | head -12 | sed 's/^/      /'
fi
[ -n "${EXPLORE_BOARDS_KEEP:-}" ] && cp "$TMP/verify.txt" "$EXPLORE_BOARDS_KEEP"

echo "---"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
