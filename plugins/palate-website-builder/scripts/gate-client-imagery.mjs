#!/usr/bin/env node
import { routeOrExit } from "./lib/workflow-route.mjs";
/**
 * gate-client-imagery.mjs - a build that harvests a client's photographs and then uses none of
 * them has thrown away the only visual asset the client actually owns.
 *
 * ========================== THE DEFECT THIS EXISTS FOR ==========================
 *
 * Measured on a real build, 2026-09-10: 149 photographs were harvested from the client's live
 * site into the project, and the composed pages referenced ZERO of them. Nothing reported a
 * fault. There was no doctrine requiring the client's own photography and no gate that noticed
 * its absence, and `palate-assets.mjs --check` could not help because it only fails photographs
 * that are IN USE and unreviewed, so a site using none passes it trivially.
 *
 * The client's reaction was the correct one: a site about their business, built from their own
 * site, showing none of their own work.
 *
 * ========================== WHAT IT DOES AND DOES NOT DEMAND ==========================
 *
 * It does NOT demand a photograph on every page, and it does not override a measured art
 * direction. A build may legitimately decide to use no photography: if only three of three
 * hundred images are large enough to carry a hero, a gradient entrance is the honest answer and
 * forcing a soft, upscaled photo would be worse.
 *
 * What it demands is that the decision was MADE rather than defaulted into. If images were
 * harvested and none are used, the manifest must record why, in a sentence a human wrote. An
 * unexplained zero is the finding; a recorded zero is a decision.
 *
 * Exit: 0 clean or decision recorded, 1 findings, 2 could not run (never a pass).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const dir = process.argv[2] || ".";
routeOrExit("gate", "gate-client-imagery", [dir]);
const IMG = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);

/** Where a harvest lands, in the shapes this plugin has actually produced. */
const HARVEST_DIRS = ["_assets-archive", ".palate/harvest", ".palate/assets", "src/assets/harvest"];

function countImages(root, skip = /(^|\/)(node_modules|dist|\.vercel|\.astro|_explore|og|fonts|favicon)(\/|$)/) {
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (skip.test(p)) continue;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (IMG.has(extname(e).toLowerCase())) out.push(p);
    }
  };
  walk(root);
  return out;
}

const harvested = HARVEST_DIRS.flatMap((d) => countImages(join(dir, d)));
if (!harvested.length) {
  console.log("gate-client-imagery: skipped (no harvested client imagery in this build, so there is nothing it could have failed to use).");
  process.exit(0);
}

/** What the BUILT site actually references. Source could import an image it never renders. */
const distRoots = ["dist/client", "dist", ".vercel/output/static"].map((d) => join(dir, d)).filter(existsSync);
if (!distRoots.length) {
  console.error(`gate-client-imagery: could not run: ${harvested.length} harvested image(s) found but no build output to check them against. Build first.`);
  process.exit(2);
}
const distRoot = distRoots[0];

const pages = [];
const walkPages = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!/(^|\/)(_explore|boards|kit|pagefind|_astro)$/.test(p)) walkPages(p); }
    else if (e.endsWith(".html")) pages.push(p);
  }
};
walkPages(distRoot);

let referenced = 0;
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  // Count <img> and <source> that are not the favicon, the OG image or a kit placeholder.
  const srcs = [...html.matchAll(/<(?:img|source)[^>]+(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]);
  referenced += srcs.filter((s) => !/favicon|\/og\/|data:|_explore/.test(s)).length;
}

if (referenced > 0) {
  console.log(`gate-client-imagery: clean (${harvested.length} image(s) harvested, ${referenced} image reference(s) across ${pages.length} built page(s)).`);
  process.exit(0);
}

// Zero used. Was that a decision, or a default?
let manifest = null;
const mp = join(dir, "build-manifest.json");
try { manifest = JSON.parse(readFileSync(mp, "utf8")); } catch { /* no manifest */ }
const reason =
  manifest?.compose?.photography_reason ||
  manifest?.assets?.photography_reason ||
  manifest?.photography_reason;

if (typeof reason === "string" && reason.trim().split(/\s+/).length >= 8) {
  console.log(`gate-client-imagery: zero client images used, and that is RECORDED as a decision: "${reason.trim()}"`);
  process.exit(0);
}

console.error(`gate-client-imagery: ${harvested.length} client photograph(s) were harvested into this build and the composed site uses NONE of them.`);
console.error(`  Checked ${pages.length} built page(s) under ${relative(dir, distRoot) || "."}; zero image references outside the favicon, the OG image and the Explore surfaces.`);
console.error(`  A site about a business, built from that business's own site, showing none of their own work is the commonest way this build disappoints its owner.`);
console.error(`  Either use their photography, or record WHY not in build-manifest.json as compose.photography_reason, in a sentence a human wrote.`);
console.error(`  A measured reason is a legitimate answer: "only 3 of 340 images are large enough to carry a hero, so no rung depends on photography they do not own" passes this gate.`);
process.exit(1);
