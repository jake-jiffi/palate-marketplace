#!/usr/bin/env bash
# /explore is the page the client opens first, and it is the fallback for every tool that
# cannot open a design canvas. So the assertions here are about what a CLIENT can see and do:
# the calibration question above the ladder, the marker where they said they were aiming, one
# card per direction carrying its own entrance and its own argument, and the canvas link first
# when there is one.
#
# A board is an artboard now, never an Astro route: `/explore` shows the rendered STILL at
# `/_explore/<id>.png`, exactly as `scripts/boards-render.mjs` writes it. This test scaffolds
# the site, writes the two still images by hand (the same PNG fixture boards-render.test.mjs
# uses, so this test needs no board-rendering machinery of its own), registers two variants
# with `artboard` and no route, and builds once to prove the page reads them.
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

# --- the shipped registry TYPE-CHECKS against the page that reads it --------------------
# RUN ON THE PRISTINE SCAFFOLD, before the fixture registry below overwrites src/lib/variants.ts.
# The fixture declares its own copy of the Variant interface, so a check run after it proves
# something about the fixture and NOTHING about the file a client is shipped. Caught by watching
# this very assertion pass with the fault reintroduced.
#
# A landing board is a Variant minus its `presentation`, and `byAmbition` used to demand the
# whole type, so `byAmbition(landingVariants)` on line 48 of this very page was a type error
# that no build reported: Astro does not type-check on build, and nothing in the suite ran
# `astro check`. Seven seconds, against a fault that reaches a client's repository.
#
# THE BAR IS A CEILING, NOT ZERO. The shipped template carries 22 pre-existing errors that
# belong to other files (optional dependencies that are not installed by default: three,
# @react-three/*, @zag-js/*, astro-pagefind; implicit `any` in a few frontmatter blocks; a
# `Cannot find name` in api/contact.ts and one in lib/kit-grounding.ts). Fixing them is not this
# test's job and asserting zero would mean either fixing them here or deleting the check. A
# ceiling fails the moment an error is ADDED, which is the thing worth catching, and the second
# assertion below is absolute: nothing the Explore registry touches may be among them.
CHECK_BASELINE=22
( cd "$SITE" && ./node_modules/.bin/astro check ) > "$TMP/astro-check.txt" 2>&1
checkerrs=$(sed 's/\x1b\[[0-9;]*m//g' "$TMP/astro-check.txt" | grep -cE "^src/.* - error" || true)
if [ "${checkerrs:-999}" -le "$CHECK_BASELINE" ]; then
  ok "astro check reports no new type errors ($checkerrs, ceiling $CHECK_BASELINE)"
else
  bad "astro check reports $checkerrs errors, over the $CHECK_BASELINE this template ships with"
  sed 's/\x1b\[[0-9;]*m//g' "$TMP/astro-check.txt" | grep -E "^src/.* - error" | head -8 | sed 's/^/      /'
fi
if sed 's/\x1b\[[0-9;]*m//g' "$TMP/astro-check.txt" \
   | grep -E "^src/.* - error" \
   | grep -qiE "variants\.ts|landingVariants|byAmbition|presentation"; then
  bad "a type error names the Explore registry, so the boards the client is shown do not type-check"
  sed 's/\x1b\[[0-9;]*m//g' "$TMP/astro-check.txt" | grep -iE "variants\.ts|landingVariants|byAmbition|presentation" | head -6 | sed 's/^/      /'
else
  ok "no type error names the Explore registry or the page that reads it"
fi


# --- two registered directions, each an artboard, no route -------------------------------
cat > "$SITE/src/lib/variants.ts" <<'TS'
export interface Variant {
  id: string; name: string; artboard: string; href?: string; ambition: number; what: string;
  why: string; feeling: string; donor: string; section: string; motion: string; ctas: string[];
  // Optional HERE only: this fixture also registers a landing board, and a landing board is
  // shown on the canvas alone, so it names no artboards of its own. The shipped Variant
  // requires it, because every rung on the ladder is four boards.
  presentation?: { inner: string; mobile: string; sheet: string };
  clip?: string; lookAt?: string;
}
export const variants: Variant[] = [
  {
    id: "b1", name: "The Quiet Room", artboard: "B1.dc.html", ambition: 1,
    presentation: { inner: "I1.dc.html", mobile: "M1.dc.html", sheet: "S1.dc.html" },
    what: "One column, one photograph, and a great deal of air.",
    why: "The people arriving are anxious and have been dismissed once already.",
    feeling: "unhurried, private, adult",
    donor: "therapy-in-london", section: "services",
    motion: "Nothing moves on load; the photograph fades in once it is scrolled to.",
    ctas: ["Book a first visit", "Ask a question"],
  },
  {
    id: "b2", name: "The Long Table", artboard: "B2.dc.html", ambition: 2,
    presentation: { inner: "I2.dc.html", mobile: "M2.dc.html", sheet: "S2.dc.html" },
    what: "A wide table of the work, read left to right.",
    why: "This buyer compares before they commit, so the comparison is the page.",
    feeling: "candid, unhurried",
    donor: "the-modern-house", section: "proof",
    motion: "Rows settle into place as the table is scrolled.",
    ctas: ["See the work", "Start a project"],
  },
];
// A LANDING BOARD IS SHOWN ON THE CANVAS ONLY. boards-render draws the ladder's rungs and
// nothing else, so /explore must not offer a still for one: the card used to link
// /_explore/lp1.png, which nothing ever writes.
export const landingVariants: Variant[] = [
  {
    id: "lp1", name: "The Straight Offer", artboard: "LP1.dc.html", ambition: 1,
    what: "One promise, one form, nothing else on the page.",
    why: "The click was paid for, so the page owes the visitor exactly what the ad said.",
    feeling: "direct, unembarrassed",
    donor: "attentive", section: "cta",
    motion: "Nothing moves until the form is answered.",
    ctas: ["Get a price", "Ask a question"],
  },
];
export function byAmbition(list: Variant[]): Variant[] {
  return [...list].sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
}
TS
mkdir -p "$SITE/public/_explore" "$SITE/.palate/explore"

# The board stills: a real PNG (the same fixture boards-render.test.mjs uses, no `sharp`
# dependency needed), so the browser pass measures a page with real images in it rather than a
# page of broken icons. The reference-calibration images stay real JPEGs via `sharp`, since
# nothing about them changed here.
node -e '
const { writeFileSync } = require("node:fs");
const { deflateSync } = require("node:zlib");
const out = process.argv[1];

function pngFixture(w, h) {
  const chunks = [];
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 3);
    raw[o] = 0;
    for (let x = 0; x < w; x++) {
      raw[o + 1 + x * 3] = Math.round((x / w) * 255);
      raw[o + 2 + x * 3] = Math.round((y / h) * 255);
      raw[o + 3 + x * 3] = Math.round(((x + y) / (w + h)) * 255);
    }
  }
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(chunk("IHDR", ihdr));
  chunks.push(chunk("IDAT", deflateSync(raw)));
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

writeFileSync(out + "/b1.png", pngFixture(1440, 900));
writeFileSync(out + "/b2.png", pngFixture(1440, 900));
// The WHOLE board, which is what the card links open. boards-render writes both, and the card
// image stays the 1440x900 entrance.
writeFileSync(out + "/b1-full.png", pngFixture(1440, 2400));
writeFileSync(out + "/b2-full.png", pngFixture(1440, 2400));
// THE OTHER THREE BOARDS OF EACH DIRECTION. A direction is four boards now, and the card shows
// all four: the entrance, the inner page, the phone and the sheet of the pieces as used.
for (const id of ["b1", "b2"]) {
  writeFileSync(out + "/" + id + "-inner.png", pngFixture(1440, 900));
  writeFileSync(out + "/" + id + "-mobile.png", pngFixture(390, 1600));
  writeFileSync(out + "/" + id + "-sheet.png", pngFixture(1440, 2200));
}
' "$SITE/public/_explore" || { echo "explore-page-boards: could not write the board stills. NOT a pass." >&2; exit 2; }

node -e '
const { createRequire } = require("node:module");
const req = createRequire(process.argv[1] + "/scripts/reference-capture/");
const sharp = req("sharp");
const out = process.argv[2];
(async () => {
  // The donor heroes too: boards-render writes `<id>-donor.jpg` beside every board still, and
  // the card renders it whenever the registry names a donor. A real JPEG rather than a PNG under
  // a .jpg name, so the browser pass measures the picture the client actually gets.
  for (const [name, w, h] of [["ref1.jpg",720,450],["ref2.jpg",720,450],["ref3.jpg",720,450],
                              ["b1-donor.jpg",720,450],["b2-donor.jpg",720,450]]) {
    const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 236, g: 233, b: 222 } } })
      .jpeg().toBuffer();
    require("node:fs").writeFileSync(out + "/" + name, buf);
  }
})();
' "$ROOT" "$SITE/public/_explore" || { echo "explore-page-boards: could not write the reference fixture images (sharp). NOT a pass." >&2; exit 2; }

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
  "explore": { "ran": true, "canvas": { "url": "https://claude.ai/code/artifact/fixture-canvas" } },
  "commission": { "intensity": "high", "intensity_asked": 3 }
}
JSON

# --- FIRST, the run that DREW NO DONOR ROW ----------------------------------------------
# Every registry entry names a donor, so the card used to render `<id>-donor.jpg` on that alone
# and a `--no-donors` build shipped a broken image on the page the client opens. The manifest is
# the only thing that knows whether the row was ever drawn.
setrow() { # <json fragment or "none">
  node -e '
    const { readFileSync, writeFileSync } = require("node:fs");
    const f = process.argv[1], m = JSON.parse(readFileSync(f, "utf8"));
    if (process.argv[2] === "none") delete m.explore.donor_row;
    else m.explore.donor_row = JSON.parse(process.argv[2]);
    writeFileSync(f, JSON.stringify(m, null, 2));
  ' "$SITE/build-manifest.json" "$1"
}
build_explore() { # <log name> -> sets HTML, or returns 1
  ( cd "$SITE" && PUBLIC_EXPLORE_MODE=true ./node_modules/.bin/astro build ) > "$TMP/$1.log" 2>&1 || {
    echo "explore-page-boards: the site did not build, so /explore is UNPROVEN. Last lines:" >&2
    tail -15 "$TMP/$1.log" >&2; return 1; }
  HTML=""
  for cand in "$SITE/dist/client/explore/index.html" "$SITE/dist/explore/index.html"; do
    [ -f "$cand" ] && { HTML="$cand"; break; }
  done
  [ -n "$HTML" ]
}

setrow '{"skipped":true}' || { echo "explore-page-boards: could not write the skipped-row manifest. NOT a pass." >&2; exit 2; }
build_explore build-skipped || exit 2
hasnt "a build whose donor row was skipped shows no donor image" '-donor.jpg'
has   "and the board stills are unaffected by the skip"          '/_explore/b1.png'
rm -rf "$SITE/dist"

# --- and the run whose ONLY record of the calibration answer is the intake ---------------
# The client answers it in the intake, before the deep survey, and it lands on
# `plan_checkpoint.shown.intake.calibration.position`. `commission.intensity_asked` is written
# later, by `/pick --intensity`, which the doctrine runs AFTER the client has picked, so a build
# handed over exactly as the doctrine describes used to ship a ladder with no marker on it: the
# one number the client gave about the range, missing from the page built to show them the range.
cp "$SITE/build-manifest.json" "$TMP/manifest-ordinary.json"
cat > "$SITE/build-manifest.json" <<'JSON'
{
  "schema": 3,
  "project": ".",
  "explore": { "ran": true, "canvas": { "url": "https://claude.ai/code/artifact/fixture-canvas" } },
  "commission": { "intensity": "high" },
  "plan_checkpoint": { "shown": { "intake": { "calibration": { "position": 3, "why": "the bold one" } } } }
}
JSON
build_explore build-intake || exit 2
has "the intake position alone draws the marker"             'you said about here'
has "and it lands where the later record would have put it"  'data-asked-direction="2"'
cp "$TMP/manifest-ordinary.json" "$SITE/build-manifest.json"
rm -rf "$SITE/dist"

# --- then the ordinary run, which DID draw one ------------------------------------------
setrow none || { echo "explore-page-boards: could not restore the manifest. NOT a pass." >&2; exit 2; }
( cd "$SITE" && PUBLIC_EXPLORE_MODE=true ./node_modules/.bin/astro build ) > "$TMP/build.log" 2>&1 || {
  echo "explore-page-boards: the site did not build, so /explore is UNPROVEN. Last lines:" >&2
  tail -15 "$TMP/build.log" >&2; exit 2; }

HTML=""
for cand in "$SITE/dist/client/explore/index.html" "$SITE/dist/explore/index.html"; do
  [ -f "$cand" ] && { HTML="$cand"; break; }
done
[ -n "$HTML" ] || { bad "/explore did not build"; echo "passed=$pass failed=$fail"; exit 1; }
ok "/explore builds"

# --- the directions, shown as stills, never as routes -----------------------------------
has "board b1 shows its entrance"            'data-board-shot="b1"'
has "board b2 shows its entrance"            'data-board-shot="b2"'
has "the b1 card image is the rendered still" '/_explore/b1.png'
has "the b2 card image is the rendered still" '/_explore/b2.png'
has "each card links to the whole board"     'href="/_explore/b1-full.png"'
# Anchored to the specific element, not just "the string appears somewhere": several sites on
# the page render the same href for the same id, so a bare substring check cannot tell one
# broken site from five correct ones. This one catches exactly the b1 card image link.
# It opens `-full.png`, never the card image. `<id>.png` is the top 900px, which is what the
# fidelity gate measures and the right size for a card; behind a link promising the board it is
# the entrance again with everything below it cut off.
has "the b1 card image anchor opens the whole board" \
  '<a class="ex-shot" href="/_explore/b1-full.png" data-board-shot="b1"'
hasnt "no route under /boards/ exists"        '/boards/'
# The landing card is shown on the canvas and has no still on this page, so it must not link one.
has "the landing board is listed"             'The Straight Offer'
hasnt "the landing card links no still nothing draws" '/_explore/lp1.png'
has "the notes carry what moves"              'What moves'
has "the motion plan is the registry's"       'the photograph fades in once it is scrolled to'
has "the CTA options are offered"             'Book a first visit / Ask a question'
has "the donor travels"                       'the-modern-house'
# THE DONOR SITS BESIDE THE BOARD. A rung claims it reproduces a library reference; without its
# hero on the page that claim is a slug in a registry the client never opens.
has "the b1 card shows its donor's hero"      'src="/_explore/b1-donor.jpg"'
has "the b2 card shows its donor's hero"      'src="/_explore/b2-donor.jpg"'
has "the donor still is captioned"            'Drawn from the-modern-house'

# --- "direction" IS THE CLIENT'S WORD. A rung is internal (the ledger, the ladder module,
# gate-board-judge.mjs), and this page is what the client actually reads, so it must say
# "Direction N of M" and never say "rung".
has "the first card labels itself as a direction, e.g. Direction 1 of" 'Direction 1 of'
hasnt "the page the client reads never says rung"                      'rung'

# --- the other three boards of the direction -------------------------------------------
# A client signing off a DIRECTION is signing off the inner page, the phone and the pieces as
# used, not only an entrance. Each still is linked at full size and captioned, or the row is
# three pictures nobody can point at by name.
has "b1 shows its inner page"                 'data-board-extra="b1-inner"'
has "b1 shows its mobile board"               'data-board-extra="b1-mobile"'
has "b1 shows its detail sheet"               'data-board-extra="b1-sheet"'
has "b2 shows its inner page"                 'data-board-extra="b2-inner"'
has "b2 shows its detail sheet"               'data-board-extra="b2-sheet"'
has "the inner still is linked at full size"  'href="/_explore/b1-inner.png"'
has "the mobile still is linked at full size" 'href="/_explore/b1-mobile.png"'
has "the sheet still is linked at full size"  'href="/_explore/b1-sheet.png"'
has "the inner still is captioned"            'Inner page'
has "the mobile still is captioned"           'Mobile'
has "the sheet still is captioned"            'The details'

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
has "the marker sits on the mapped direction" 'data-asked-direction="2"'

# --- the canvas, first when there is one ------------------------------------------------
has "the canvas is linked"                    'https://claude.ai/code/artifact/fixture-canvas'
ccol=$(grep -bo 'fixture-canvas' "$HTML" | head -1 | cut -d: -f1)
[ "${ccol:-999999999}" -lt "${lcol:-0}" ] && ok "the canvas link comes before the ladder" \
  || bad "the canvas link is buried below the ladder"

# --- and it is still a working document, not a page of the site -------------------------
has "the page is noindex" '<meta name="robots" content="noindex">'

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
