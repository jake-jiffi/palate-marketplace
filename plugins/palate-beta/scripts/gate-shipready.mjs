#!/usr/bin/env node
/**
 * gate-shipready.mjs - the checks that only matter at the seam between "built" and "delivered".
 *
 * ======================== THE BUILD THAT WROTE THIS FILE ========================
 *
 * A finished site, composed and captured, 0 console errors across 11 routes, genuinely good
 * work. It was also about to ship, to a client's production domain:
 *
 *   1. EIGHT REJECTED CONCEPT HOMEPAGES, live and in the sitemap. `variants.ts` documents its
 *      own contract - "At Compose time, after the client picks, this file is CLEARED" - and
 *      nothing enforced it, so /v1../v8 were routed, rendered, listed in sitemap-0.xml, and
 *      served to GPTBot and ClaudeBot by an explicit Allow: /.
 *   2. AN UNRESOLVED TEMPLATE PLACEHOLDER IN A THIRD-PARTY SCRIPT TAG. Every page fetched
 *      analytics with a literal {{HUMBLYTICS_SITE_ID}}: an unconsented third-party request that
 *      collects nothing. An unconfigured tag is worse than no tag, because it looks installed.
 *   3. NO ASSET REVIEW AT ALL. `.palate/assets.json` never existed, so the review gate had
 *      nothing to fail on, and four destructive photo treatments shipped - including a 3.2:1
 *      banner forced through a 4:5 slot, showing 25% of the frame. Worse than the 22% failure
 *      that gate was written for.
 *
 * Every one of these is invisible to a build that succeeds, a lint that passes and a screenshot
 * that looks right. They live in the gap between the artefact being correct and the artefact
 * being deliverable, and that gap had no gate.
 *
 * Usage:  node gate-shipready.mjs [project-dir]
 * Exit:   0 clean, 1 findings, 2 cannot check (never a pass).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pluginRootRefusal } from "../hooks/project-dir.mjs";

const dir = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : ".";
const findings = [];
const add = (what, detail) => findings.push({ what, detail });

// NEVER GRADE THE PLUGIN'S OWN FILES. This defaults to ".", so one run from a plugin checkout
// measures the tool instead of a site: the templates carry {{PLACEHOLDER}} tokens on purpose
// and would every one of them be reported as an unresolved placeholder shipping to a client.
const refusal = pluginRootRefusal(dir);
if (refusal) {
  console.error(`gate-shipready: refused: ${refusal}. Name the site directory explicitly. NOT a pass.`);
  process.exit(2);
}

if (!existsSync(join(dir, "src", "pages"))) {
  console.error(`gate-shipready: no ${join(dir, "src/pages")}. Not an Astro project; nothing checked. NOT a pass.`);
  process.exit(2);
}

const read = (p) => { try { return readFileSync(join(dir, p), "utf8"); } catch { return null; } };
const walk = (d, out = []) => {
  let e; try { e = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) {
    if (x.name === "node_modules" || x.name === ".git") continue;
    const p = join(d, x.name);
    if (x.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// ---------------------------------------------------------------- 1. placeholders
// Scanned in source AND in the built output, because the build is what ships and a placeholder
// can be introduced by a template that source review never opens.
const PLACEHOLDER = /\{\{[A-Z][A-Z0-9_]{2,}\}\}/g;
const scanRoots = ["src", ".vercel/output", "dist", "public"].map((r) => join(dir, r)).filter(existsSync);
const textExt = /\.(astro|ts|tsx|js|mjs|cjs|css|html|json|md|txt|xml|svelte|vue)$/i;
const seen = new Map();
// HOW MUCH DID IT ACTUALLY READ. A gate that walks a tree, finds nothing to walk and exits 0
// is indistinguishable from one that read a hundred files and found them clean, which is how a
// real build passed everything with the site in a directory the gate never opened.
let inspected = 0;
for (const root of scanRoots) {
  for (const f of walk(root)) {
    if (!textExt.test(f)) continue;
    try {
      if (statSync(f).size > 2_000_000) continue;
      inspected += 1;
      const m = readFileSync(f, "utf8").match(PLACEHOLDER);
      if (m) for (const tok of new Set(m)) {
        if (!seen.has(tok)) seen.set(tok, relative(dir, f));
      }
    } catch { /* unreadable file is not a finding here */ }
  }
}
if (inspected === 0) {
  console.error(
    `gate-shipready: skipped (nothing to inspect: no readable source or build files under ` +
    `${scanRoots.length ? scanRoots.map((r) => relative(dir, r) || ".").join(", ") : "src, dist, .vercel/output, public"}). NOT a pass.`,
  );
  process.exit(2);
}

for (const [tok, where] of seen) {
  add("unresolved placeholder", `${tok} still present (first at ${where}). A scaffold token reaching production is a broken feature that LOOKS installed.`);
}

// ------------------------------------------------------------ 2. Explore retired
// Only once the client has picked. Before that, live variants are the deliverable.
let manifest = null;
try { manifest = JSON.parse(read("build-manifest.json") || "null"); } catch { /* unreadable */ }
const picked = Boolean(manifest?.explore?.picks?.length) || Boolean(manifest?.explore?.ran && manifest?.variants?.length);

if (picked) {
  const variantPages = existsSync(join(dir, "src/pages"))
    ? readdirSync(join(dir, "src/pages")).filter((f) => /^(v|lp)\d+\.astro$/.test(f))
    : [];
  if (variantPages.length) {
    add("Explore not retired", `${variantPages.length} variant route(s) still live (${variantPages.slice(0, 4).join(", ")}${variantPages.length > 4 ? ", ..." : ""}) after the client picked. These are REJECTED concepts on the client's domain.`);
  }
  // THE BOARDS ARE THE CURRENT SHAPE OF THE SAME FAULT. `/boards/bN` and `public/_explore/`
  // are working documents for one client: they name the directions that were NOT chosen, and
  // the card images are stills of them. Left in place they are routed, crawlable and served to
  // answer engines exactly as the eight rejected homepages were.
  const boardsDir = join(dir, "src/pages/boards");
  if (existsSync(boardsDir)) {
    let boardPages = [];
    try { boardPages = readdirSync(boardsDir).filter((f) => f.endsWith(".astro")); } catch { /* unreadable */ }
    add(
      "Explore not retired",
      `src/pages/boards/ still exists${boardPages.length ? ` with ${boardPages.length} board route(s) (${boardPages.slice(0, 4).join(", ")}${boardPages.length > 4 ? ", ..." : ""})` : ""} after the client picked. Archive it to _explore-archive/ or delete it: these are the directions they did not choose.`,
    );
  }
  if (existsSync(join(dir, "public/_explore"))) {
    add(
      "Explore not retired",
      "public/_explore/ still exists after the client picked. It holds the board stills and the calibration captures, which ship to the client's own domain as images of the work they turned down.",
    );
  }
  if (existsSync(join(dir, "src/pages/explore.astro"))) {
    add("Explore not retired", "src/pages/explore.astro is still live. It is a working document for one client (it names the rejected directions and coaches the choice), not a page of the site.");
  }
  const vts = read("src/lib/variants.ts");
  if (vts && /\{\s*id:\s*["'](v|lp|b)\d+/.test(vts)) {
    add("Explore not retired", "src/lib/variants.ts still registers boards, so the direction picker renders on the delivered site.");
  }
  for (const sm of ["dist/sitemap-0.xml", ".vercel/output/static/sitemap-0.xml", "public/sitemap-0.xml"]) {
    const x = read(sm);
    if (x && /\/(v|lp)\d+\/?<|\/boards\/[^<]*</.test(x)) {
      const n = (x.match(/\/(v|lp)\d+\/?<|\/boards\/[^<]*</g) || []).length;
      add("Explore not retired", `${sm} advertises ${n} variant URL(s). They will be crawled, indexed and fed to answer engines.`);
      break;
    }
  }
}

// ------------------------------------------------- 2b. the kit's own demo surfaces are gone
//
// THE KIT INDEX SAID THIS GATE REMOVED THEM AND IT DID NOT.
//
// `/kit`, `/kit/<piece>/<Variation>` and the framed renders under `/kit-frame` are working
// documents: they demonstrate every section piece with INVENTED firms, INVENTED people and
// INVENTED quotes, which is exactly the class of content a real client build had to correct four
// times over. Left in the tree they build to real routes on the client's own domain, noindex or
// not, and a page nobody linked is still a page a crawler that finds it will read. The generated
// artwork under `public/images/kit/` and `public/media/kit/` ships with them.
//
// Only at PRODUCTION stage. A preview exists so the pieces can be judged, and taking the kit away
// there would remove the one surface that makes the sections reviewable at all.
let stage = "";
try { stage = JSON.parse(read(".palate-skill-state.json") || "{}")?.stage || ""; } catch { /* unreadable */ }
if (stage === "production") {
  const kitSurfaces = [
    ["src/pages/kit", "the piece and state demos, which name firms and people that do not exist"],
    ["src/pages/kit-frame", "the framed renders of the same demos"],
    ["public/images/kit", "the demo artwork: invented wordmarks, product screens and stand-ins"],
    ["public/media/kit", "the demo video files"],
    ["src/lib/kit-sample.ts", "the invented people, firms and quotes the demos render"],
    ["src/lib/kit-states.ts", "the state fixtures, which carry the same invented content at length"],
  ];
  for (const [rel, why] of kitSurfaces) {
    if (existsSync(join(dir, rel))) {
      add("kit demos not retired", `${rel} is still in the tree at production stage. It holds ${why}. Delete it before hand-over: the composed pages keep working, because a page imports the COMPONENTS and never the demos.`);
    }
  }
  for (const sm of ["dist/sitemap-0.xml", ".vercel/output/static/sitemap-0.xml", "public/sitemap-0.xml"]) {
    const x = read(sm);
    if (x && /\/kit(-frame)?\//.test(x)) {
      const n = (x.match(/\/kit(-frame)?\/[^<]*</g) || []).length;
      add("kit demos not retired", `${sm} advertises ${n} kit demo URL(s), so the invented content is offered to crawlers and answer engines.`);
      break;
    }
  }
}

// ------------------------------------------------------- 3. the photos were looked at
// A check that only fails when its own output exists cannot fail on a build that skipped it,
// which is exactly how four destructive treatments shipped. Absence IS the finding.
const srcFiles = walk(join(dir, "src")).filter((f) => /\.(astro|tsx|jsx|svelte|vue|md|mdx)$/i.test(f));
let usesImages = false;
for (const f of srcFiles) {
  try {
    const s = readFileSync(f, "utf8");
    if (/<img[\s>]|<Image[\s>]|background-image\s*:|\.(jpe?g|png|webp|avif)\b/i.test(s)) { usesImages = true; break; }
  } catch { /* ignore */ }
}
if (usesImages) {
  const assetsDoc = read(".palate/assets.json");
  /**
   * A STOREFRONT'S PHOTOGRAPHY IS THE MERCHANT'S CATALOGUE, MEASURED FROM SOURCE.
   *
   * palate-assets.mjs measures files on disk. A commerce build renders product imagery from
   * cdn.shopify.com, so there are no local files, assets.json is never written, and this check
   * fired "photos never measured" on a build whose photographs were in fact measured more
   * precisely than a local scan manages: the Storefront API returns width and height per image,
   * which is exactly the number palate-assets exists to obtain.
   *
   * SO THIS EXEMPTS MEASUREMENT, NEVER REVIEW, and only for catalogue imagery. The review
   * requirement below is about photographs WE art-direct into slots, where pixels cannot see
   * where the subject is. A merchant's 250-product grid is not four hand-picked hero treatments
   * and was never what that rule was written for. Any LOCAL asset still has to be measured and
   * reviewed exactly as before, which is what the `else` branch continues to enforce.
   *
   * Engages only when a catalogue exists AND carries real dimensions, so a brochure build is
   * untouched and a catalogue without dimensions still fails.
   */
  let cat = null;
  try {
    const raw = read(".palate/catalogue.json");
    if (raw) cat = JSON.parse(raw);
  } catch { /* an unreadable catalogue is no catalogue */ }
  const measuredFromSource = cat && cat.ok === true
    ? (cat.products || []).filter((x) => x && x.image && x.image.width > 0 && x.image.height > 0).length
    : 0;

  if (!assetsDoc && measuredFromSource > 0) {
    console.log(`gate-shipready: ${measuredFromSource} catalogue photograph(s) measured from the Storefront API (width and height per image); no local assets to review.`);
  } else if (!assetsDoc) {
    add("photos never measured", "src uses images but .palate/assets.json does not exist, so palate-assets.mjs never ran. Run it, then VIEW each photo and record subject + treatment: `node ${CLAUDE_PLUGIN_ROOT}/scripts/palate-assets.mjs <assets-dir>`.");
  } else {
    let doc = null; try { doc = JSON.parse(assetsDoc); } catch { /* handled below */ }
    if (!doc) add("photos never measured", ".palate/assets.json is not readable JSON, so the asset review is UNKNOWN, not clean.");
    else {
      const photos = Object.entries(doc.assets || {}).filter(([, a]) => a && !a.error && a.kind !== "icon");
      const unreviewed = photos.filter(([, a]) => !a.reviewed);
      if (unreviewed.length) {
        add("photos never looked at", `${unreviewed.length} of ${photos.length} photograph(s) have no recorded subject/treatment. Pixels cannot see where the subject is: a crop keeping two faces and one slicing them measure identically.`);
      }
    }
  }
}

// ------------------------------------------------------------------------ report
if (!findings.length) {
  console.log(`gate-shipready: clean (placeholders resolved, Explore retired, kit demos retired, photos reviewed) (inspected ${inspected} file(s)).`);
  process.exit(0);
}
console.error(`gate-shipready: ${findings.length} finding(s) (inspected ${inspected} file(s)). This build is NOT ready to hand over.\n`);
for (const f of findings) console.error(`  [${f.what}] ${f.detail}`);
process.exit(1);
