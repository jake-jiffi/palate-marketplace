#!/usr/bin/env node
/**
 * palate-assets.mjs - measure what the photos ACTUALLY are, before choosing how to use them.
 *
 * ============================ THE FAILURE THIS EXISTS FOR ============================
 *
 * A build set `aspect-ratio: 3/1` full-bleed on a client's photo set without once looking at
 * the source images. Fifteen of the thirty-one were portrait or square. A 2:3 portrait forced
 * through a 3:1 letterbox shows 22% of the frame, dead centre, so a candid of two people at a
 * counter arrived on the homepage as two decapitated torsos centred on a t-shirt.
 *
 * Nothing caught it because nothing had measured anything. `inventory-assets.sh` COUNTS files
 * by extension; it records no dimension, no ratio, no verdict. The treatment was therefore
 * chosen from an assumption about what client photos look like, and client photos are handheld
 * candids, not architectural hero plates. They were never shot to be blown across 1440px.
 *
 * ================================= WHAT IT DECIDES ==================================
 *
 * Two things are MEASURABLE and are decided here, deterministically:
 *
 *   1. HOW BIG can this be shown before it goes soft. An 800px-wide photo in a 1440px
 *      full-bleed slot is a 1.8x upscale, which reads as "cheap" long before anyone can say why.
 *   2. HOW MUCH OF THE FRAME SURVIVES a given slot ratio. A cover-crop shows
 *      `min(source, slot) / max(source, slot)` of the frame, so the 2:3-into-3:1 case above is
 *      0.667 / 3 = 22%. That single number turns "this looks wrong" into "you are throwing away
 *      78% of the photograph".
 *
 * One thing is NOT measurable here and must never be guessed: WHERE THE SUBJECT IS. A 70%
 * crop that keeps two faces is fine; a 90% crop that slices one is not. Pixels cannot tell you
 * which. So this writes `subject: null` and the agent fills it in AFTER LOOKING at the image,
 * which it can do, because it is the vision model. `--check` fails while any photo in use is
 * still unreviewed, so "we did not look" is a visible state rather than a silent default.
 *
 * Usage:
 *   node palate-assets.mjs <dir> [--out .palate/assets.json] [--slots 3/1,16/9,4/5,1/1]
 *   node palate-assets.mjs <dir> --check          # exit 1 if any asset is unreviewed
 *
 * Exit: 0 fine, 1 findings (with --check), 2 bad arguments or no readable images.
 */
import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { createRequire } from "node:module";

// sharp lives with the other capture deps, not beside this file, so resolve from there.
const require = createRequire(new URL("./reference-capture/", import.meta.url));

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".tif", ".tiff"]);

/** Slots a site actually uses. Ratios as width/height. */
const DEFAULT_SLOTS = [
  { name: "full-bleed hero", ratio: 3 / 1 },
  { name: "wide banner", ratio: 16 / 9 },
  { name: "landscape card", ratio: 3 / 2 },
  { name: "square tile", ratio: 1 / 1 },
  { name: "portrait card", ratio: 4 / 5 },
];

/**
 * A cover-crop fills the box and discards the overflow, so the visible fraction of the source
 * frame is the ratio of the smaller aspect to the larger. This is the whole arithmetic, and it
 * reproduces the real failure exactly: 2:3 into 3:1 is 0.667/3 = 0.22.
 */
export function visibleFraction(sourceRatio, slotRatio) {
  if (!(sourceRatio > 0) || !(slotRatio > 0)) return 0;
  return Math.min(sourceRatio, slotRatio) / Math.max(sourceRatio, slotRatio);
}

export function orientationOf(ratio) {
  if (ratio < 0.9) return "portrait";
  if (ratio <= 1.1) return "square";
  if (ratio < 2.2) return "landscape";
  return "panoramic";
}

/**
 * The largest CSS width this can occupy before it is being upscaled. At 2x (every phone and
 * most laptops) you need twice the CSS pixels, which is the constraint people forget: a 1600px
 * photo is a 1600px slot on a desktop and only an 800px slot on a retina screen.
 */
export function maxCssWidth(pixelWidth) {
  return { at1x: pixelWidth, at2x: Math.floor(pixelWidth / 2) };
}

/** Verdicts a measurement can support on its own, with the reason attached. */
export function assess(meta, slots = DEFAULT_SLOTS) {
  const ratio = meta.width / meta.height;
  const orientation = orientationOf(ratio);
  const css = maxCssWidth(meta.width);
  const fits = slots.map((s) => {
    const visible = visibleFraction(ratio, s.ratio);
    return {
      slot: s.name,
      ratio: +s.ratio.toFixed(3),
      visible: +visible.toFixed(3),
      verdict: visible >= 0.7 ? "ok" : visible >= 0.5 ? "risky" : "destructive",
    };
  });

  const notes = [];
  // A full-bleed hero at 1440 CSS needs 1440 real pixels at 1x, 2880 at 2x. Below 1600 it is
  // soft on a laptop and obviously soft on a phone.
  const heroCapable = meta.width >= 1600 && ratio >= 1.2;
  if (!heroCapable) {
    notes.push(
      meta.width < 1600
        ? `only ${meta.width}px wide: a full-bleed hero would upscale it (${css.at2x}px is its honest 2x limit)`
        : `${orientation} at ${ratio.toFixed(2)}: a full-bleed hero would crop through it`,
    );
  }
  if (orientation === "portrait") {
    notes.push("portrait: never letterbox this. Give it a portrait or square slot, or place it beside text rather than behind it.");
  }
  const destructive = fits.filter((f) => f.verdict === "destructive").map((f) => f.slot);
  if (destructive.length) {
    notes.push(`destroys the frame in: ${destructive.join(", ")}`);
  }

  return {
    ratio: +ratio.toFixed(3),
    orientation,
    maxCssWidth: css,
    heroCapable,
    fits,
    notes,
    // NOT measurable from pixels. The agent fills this in after viewing the image.
    subject: null,
    treatment: null,
    reviewed: false,
  };
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (IMAGE_EXT.has(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

function parseArgs(argv) {
  const a = { dir: null, out: null, slots: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--out") a.out = argv[++i];
    else if (k === "--slots") a.slots = argv[++i];
    else if (k === "--check") a.check = true;
    else if (!k.startsWith("--") && !a.dir) a.dir = k;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir || ".";
  if (!existsSync(dir)) {
    console.error(`palate-assets: no such directory: ${dir}`);
    process.exit(2);
  }

  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    // Fail LOUD. A silent skip here would report "no image problems" on a set nobody measured,
    // which is the exact condition this tool exists to make impossible.
    console.error(
      "palate-assets: sharp is not installed, so NOTHING was measured. This is BLOCKED, not clean.\n" +
        "  Install it in the plugin: (cd scripts/reference-capture && npm i sharp)",
    );
    process.exit(2);
  }

  const slots = args.slots
    ? args.slots.split(",").map((s) => {
        const [w, h] = s.split("/").map(Number);
        return { name: s.trim(), ratio: w / h };
      })
    : DEFAULT_SLOTS;

  const files = walk(dir);
  if (!files.length) {
    console.error(`palate-assets: no images under ${dir}`);
    process.exit(2);
  }

  const outPath = args.out || join(dir, ".palate", "assets.json");
  const prior = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { assets: {} };
  const priorAssets = prior.assets || {};

  const assets = {};
  let unreadable = 0;
  for (const f of files) {
    const key = relative(dir, f);
    let meta;
    try {
      const m = await sharp(f).metadata();
      if (!m.width || !m.height) throw new Error("no dimensions");
      meta = { width: m.width, height: m.height, format: m.format, bytes: statSync(f).size };
    } catch (e) {
      unreadable++;
      assets[key] = { error: String((e && e.message) || e), reviewed: false };
      continue;
    }
    const a = { ...meta, ...assess(meta, slots) };
    // A human/agent review already recorded is PRESERVED across re-runs: re-measuring must
    // never silently discard the half that took someone looking at the picture.
    const was = priorAssets[key];
    if (was && was.reviewed) {
      a.subject = was.subject ?? null;
      a.treatment = was.treatment ?? null;
      a.reviewed = true;
    }
    assets[key] = a;
  }

  const list = Object.entries(assets).filter(([, a]) => !a.error);
  const byOrientation = {};
  for (const [, a] of list) byOrientation[a.orientation] = (byOrientation[a.orientation] || 0) + 1;

  const doc = {
    version: 1,
    dir,
    counts: {
      total: files.length,
      measured: list.length,
      unreadable,
      reviewed: list.filter(([, a]) => a.reviewed).length,
      heroCapable: list.filter(([, a]) => a.heroCapable).length,
      byOrientation,
    },
    slots: slots.map((s) => ({ name: s.name, ratio: +s.ratio.toFixed(3) })),
    assets,
    generatedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");

  // The summary is the point: someone must be able to see the SHAPE of the set in one screen,
  // because "most of these are portrait" is the fact that decides the whole layout.
  const orient = Object.entries(byOrientation)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  console.log(`palate-assets: ${list.length} image(s) measured -> ${outPath}`);
  console.log(`  orientation: ${orient}`);
  console.log(`  hero-capable (>=1600px wide AND landscape): ${doc.counts.heroCapable} of ${list.length}`);
  if (unreadable) console.log(`  unreadable: ${unreadable} (recorded, not skipped)`);

  const worst = list
    .map(([k, a]) => ({ k, a, bad: a.fits.filter((f) => f.verdict === "destructive").length }))
    .filter((x) => x.bad > 0)
    .slice(0, 5);
  if (worst.length) {
    console.log(`  photos a common slot would destroy:`);
    for (const w of worst) {
      const f = w.a.fits.find((x) => x.verdict === "destructive");
      console.log(`    ${w.k}  ${w.a.width}x${w.a.height} (${w.a.orientation}) - ${f.slot} shows ${Math.round(f.visible * 100)}% of the frame`);
    }
  }

  if (args.check) {
    const unreviewed = list.filter(([, a]) => !a.reviewed);
    if (unreviewed.length) {
      console.error(
        `\npalate-assets: ${unreviewed.length} of ${list.length} image(s) have never been LOOKED at.\n` +
          "  Pixels give you size and crop loss. They cannot tell you where the subject is, and a\n" +
          "  crop that keeps two faces and one that slices them measure identically. VIEW each image\n" +
          "  in use, then record `subject` (where the important content sits) and `treatment` (the\n" +
          "  slot and object-position it should get) in the assets file.",
      );
      process.exit(1);
    }
    console.log("  every measured image has a recorded treatment.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`palate-assets: ${(e && e.message) || e}`);
    process.exit(2);
  });
}
