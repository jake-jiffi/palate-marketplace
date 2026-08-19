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

const dir = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : ".";
const findings = [];
const add = (what, detail) => findings.push({ what, detail });

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
for (const root of scanRoots) {
  for (const f of walk(root)) {
    if (!textExt.test(f)) continue;
    try {
      if (statSync(f).size > 2_000_000) continue;
      const m = readFileSync(f, "utf8").match(PLACEHOLDER);
      if (m) for (const tok of new Set(m)) {
        if (!seen.has(tok)) seen.set(tok, relative(dir, f));
      }
    } catch { /* unreadable file is not a finding here */ }
  }
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
  if (existsSync(join(dir, "src/pages/explore.astro"))) {
    add("Explore not retired", "src/pages/explore.astro is still live. It is a working document for one client (it names the rejected directions and coaches the choice), not a page of the site.");
  }
  const vts = read("src/lib/variants.ts");
  if (vts && /\{\s*id:\s*["'](v|lp)\d+/.test(vts)) {
    add("Explore not retired", "src/lib/variants.ts still registers variants, so the direction picker renders on the delivered site.");
  }
  for (const sm of ["dist/sitemap-0.xml", ".vercel/output/static/sitemap-0.xml", "public/sitemap-0.xml"]) {
    const x = read(sm);
    if (x && /\/(v|lp)\d+\/?</.test(x)) {
      const n = (x.match(/\/(v|lp)\d+\/?</g) || []).length;
      add("Explore not retired", `${sm} advertises ${n} variant URL(s). They will be crawled, indexed and fed to answer engines.`);
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
  if (!assetsDoc) {
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
  console.log("gate-shipready: clean (placeholders resolved, Explore retired, photos reviewed).");
  process.exit(0);
}
console.error(`gate-shipready: ${findings.length} finding(s). This build is NOT ready to hand over.\n`);
for (const f of findings) console.error(`  [${f.what}] ${f.detail}`);
process.exit(1);
