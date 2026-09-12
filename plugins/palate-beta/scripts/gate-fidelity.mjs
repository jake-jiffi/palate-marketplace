#!/usr/bin/env node
/**
 * scripts/gate-fidelity.mjs - did the built home page carry the direction the client picked?
 *
 * ========================== THE PROMISE IT KEEPS ==========================
 *
 * Explore's whole offer is that the client chooses a direction and gets it. Nothing has ever
 * checked that. A client picks rung 3, Compose writes the home page, and whether the thing they
 * chose survived the trip has been a matter of the builder's own opinion at the moment they
 * were most invested in the answer.
 *
 * The failure worth catching is not a wrong page, which somebody notices. It is a PLAUSIBLE
 * one: the same layout in a slightly different accent, the same accent at a different type
 * scale, the picked section quietly dropped because it was awkward to compose. Every one of
 * those is invisible side by side and obvious when measured.
 *
 * ======================== WHAT IT COMPARES, AND WHERE =====================
 *
 * The board's archived render against the built home, both at 1440, both measured OVER THE
 * PICKED HERO SECTION ALONE. Not the whole page, because a board is a quarter of one and the
 * difference in amount would read as infidelity. Not "above the fold" either, which was tried
 * and is not symmetric: below the board's hero sits the system strip, and below the home's
 * hero sits the next real section, so a 900px window measures two different things and reported
 * an 11% type-scale drift on a home page composed from the board's own component. Everything
 * outside the hero is set to `visibility: hidden`, the one lever `design-measure.mjs` already
 * honours and which, unlike removing nodes, cannot move the layout of what remains.
 *
 * The section checks are structural AND named, deliberately. The id says "this is the one";
 * the tag-and-class signature says "and it really is", because an id is a label an agent can
 * type and a signature is not.
 *
 * ===================== WHAT IT REFUSES TO CLAIM ===========================
 *
 * The appearance similarity is always ATTEMPTED, and whatever comes back is said out loud.
 * `embedHero()` owns the decision about whether it can run: it returns `applicable: false` with
 * a reason when the model is absent, unauthorised or the still is unusable, and that reason is
 * printed as UNMEASURED with the verdict resting on the measured facts alone. Gating the call
 * on PALATE_TASTE was tried and it was wrong: that variable is taste-local's consent gate for
 * the one-off download and it stops firing once the model is cached, so an operator who had
 * already installed the head got UNMEASURED for ever from a check that could have run. A gate
 * that quietly drops half its evidence and still prints "pass" is the failure this file exists
 * in the middle of.
 *
 * Usage: node scripts/gate-fidelity.mjs <projectDir> [--serve <url>] [--port 8791]
 * Exit:  0 clean, 1 the direction drifted (every mismatch named), 2 cannot check (with the
 *        reason). Never 0 having measured nothing.
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createServer } from "node:http";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { measurePage, deltaE } from "./reference-capture/design-measure.mjs";
import { pluginRootRefusal } from "../hooks/project-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const engineRequire = createRequire(new URL("./reference-capture/", import.meta.url));

const FOLD = 900;
const WIDTH = 1440;
const ACCENT_MAX_DELTA_E = 6;
const TYPE_SCALE_TOLERANCE = 0.10;
const SIMILARITY_FLOOR = 0.85;
const SIGNATURE_FLOOR = 0.6;
/**
 * FRAMING, WHICH IS THE THING A SIMILARITY SCORE CANNOT SEE.
 *
 * The eastcoast v3 home shipped with its hero photograph inset where the picked board bled it
 * edge to edge, and the h1 demoted from 64px over the photograph to a 28px kicker above it.
 * Every check above passed: same faces, same accent, same scale, the section present and
 * structurally the same. The appearance head read 0.928 against a 0.85 floor, because it
 * measures whether the parts look alike and framing is the arrangement of the parts.
 *
 * So framing is measured rather than judged. A media box within 8px of the viewport is a
 * bleed and anything narrower is an inset, which is the same call a person makes at a glance.
 * The h1 is its computed size and whether it sits above or below that media. A carried section
 * is its height. The tolerances are wide on purpose: a design is allowed to breathe, and 15%
 * on type or 25% on a section's height is past breathing and into a different page.
 */
const BLEED_TOLERANCE_PX = 8;
const H1_TOLERANCE = 0.15;
const SECTION_HEIGHT_TOLERANCE = 0.25;

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--serve", "--port"]);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) { if (VALUE_FLAGS.has(args[i])) i++; continue; }
  positional.push(args[i]);
}

/**
 * A skip, in the shape every sub-gate in this suite prints.
 *
 * `gate-fidelity: skipped (<reason>)` on the FIRST stderr line, exit 2, so gate-done.sh
 * separates a skip from a block on the same discriminator it uses for gate-seo and
 * gate-explore. A skip that reads as a pass is the failure that suite exists to prevent.
 */
const cannotCheck = (reason) => {
  process.stderr.write(`gate-fidelity: skipped (${reason})\n`);
  process.stderr.write("gate-fidelity: NOT a pass.\n");
  process.exit(2);
};

/**
 * A skip signal for the two cannotCheck-shaped refusals that fire AFTER the browser and its
 * servers are open (the hero-not-found and the home-did-not-load checks below). cannotCheck()
 * itself calls process.exit(2), which is right for every refusal above that runs before those
 * resources exist and wrong down there: an immediate exit skips the `finally` that closes them,
 * leaking a live Chromium process and up to two open HTTP servers. Thrown instead, caught once
 * around the whole measurement, printed in cannotCheck's own shape, and reported through
 * `process.exitCode` (never process.exit(), for the same ONNX-teardown reason the file's closing
 * comment gives) so `finally` always runs first.
 */
class SkipSignal extends Error {
  constructor(reason) {
    super(reason);
    this.name = "SkipSignal";
  }
}
const cannotCheckMidRun = (reason) => { throw new SkipSignal(reason); };

const dir = resolve(positional[0] || ".");
const refusal = pluginRootRefusal(dir);
if (refusal) cannotCheck(`refused: ${refusal}. Name the site directory explicitly.`);

// ------------------------------------------------------------------ what was picked
const manifestPath = join(dir, "build-manifest.json");
if (!existsSync(manifestPath)) cannotCheck(`no ${manifestPath}, so no picks recorded.`);
let manifest = null;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
catch { cannotCheck(`${manifestPath} is not readable JSON, so no picks could be read.`); }

const picks = Array.isArray(manifest?.explore?.picks) ? manifest.explore.picks : [];
if (!picks.length) cannotCheck("no picks recorded (manifest.explore.picks is empty), so there is no chosen direction to measure against.");
const heroPick = picks.find((p) => p.surface === "hero");
if (!heroPick) cannotCheck("no picks recorded for the hero surface, so the entrance cannot be compared.");
const sectionPick = picks.find((p) => p.surface === "section") || heroPick;

/**
 * THE ONLY EXCUSE A FRAMING DIFFERENCE HAS IS A RECORDED ONE.
 *
 * `compose.overrides[]` is written by `palate-pick.mjs --override`, which means somebody typed
 * the reason and it is in the manifest where a reviewer can read it. A departure from the
 * picked board is allowed, often rightly (the only usable photograph is soft at full bleed);
 * what is not allowed is the departure being invisible. So an override suppresses the finding
 * and prints itself, and a build with no override and a changed frame fails.
 *
 * The home's route is `/`. The section is matched on the board's own id (`b3-hero`) or on the
 * bare piece name (`hero`), because a person recording an override says "hero" and the id is
 * the board's internal name for the same thing.
 */
const overrides = Array.isArray(manifest?.compose?.overrides) ? manifest.compose.overrides : [];
function overrideFor(sectionId) {
  if (!sectionId) return null;
  return overrides.find((o) => {
    if (!o || typeof o !== "object") return false;
    if (String(o.route || "").trim() !== "/") return false;
    const s = String(o.section || "").trim();
    if (!s) return false;
    return s === sectionId || sectionId.endsWith(`-${s}`);
  }) || null;
}

if (!existsSync(join(dir, "src/pages/index.astro"))) {
  cannotCheck(`no ${join("src/pages/index.astro")}, so Compose has not written the home page yet.`);
}

const shotsRoot = join(dir, ".palate/explore/shots");
const heroRenderPath = join(shotsRoot, heroPick.variant_id, "rendered.html");
if (!existsSync(heroRenderPath)) {
  cannotCheck(`the picked board ${heroPick.variant_id} has no archived render at ${heroRenderPath}. Run boards-render.mjs before Compose, or the picked direction cannot be compared with anything.`);
}
const sectionRenderPath = join(shotsRoot, sectionPick.variant_id, "rendered.html");

// --------------------------------------------------------------- where the home is
const serveUrl = opt("--serve", null);
/**
 * dist is required only when there is no other way to reach the home.
 *
 * The board no longer needs it. Its archived render is an ARTBOARD (Task 3): self-contained
 * CSS in its own helmet, bare-filename images copied beside it, so it is served from its own
 * directory below and resolves without a build at all. What still needs a build, or a running
 * --serve preview, is the HOME ITSELF: the composed page has to come from somewhere before it
 * can be compared with the picked board.
 */
const distRoot = ["dist/client", "dist"].map((d) => join(dir, d)).find((d) => existsSync(join(d, "index.html")));
if (!distRoot && !serveUrl) {
  cannotCheck(`no built site under ${join(dir, "dist")} and no --serve URL. The composed home has to be built (or served) before it can be compared with the picked board.`);
}

// --------------------------------------------------------------- section identities
/**
 * The section ids the board actually rendered, in document order.
 *
 * Read from the RENDER rather than derived from a naming convention. A convention is a promise
 * about what somebody typed; the render is what exists.
 */
function sectionIds(html) {
  return [...html.matchAll(/data-section-id="([^"]+)"/g)].map((m) => m[1]);
}
const heroIds = sectionIds(readFileSync(heroRenderPath, "utf8"));
if (!heroIds.length) {
  cannotCheck(`the archived render of ${heroPick.variant_id} carries no data-section-id, so its sections cannot be identified. Mark the hero root data-section-id="${heroPick.variant_id}-hero" in the artboard and re-run boards-render.`);
}
/**
 * THE HERO IS FOUND BY NAME, not position.
 *
 * An artboard opens with its navigation (BoardFrame's own chrome), so the first mark in
 * document order is `<id>-navigation`, not the hero. Falls back to the first mark when the
 * expected name is not there, which is the old behaviour and still better than refusing.
 */
const heroSectionId = heroIds.includes(`${heroPick.variant_id}-hero`) ? `${heroPick.variant_id}-hero` : heroIds[0];
const sectionIdsOfPick = existsSync(sectionRenderPath) ? sectionIds(readFileSync(sectionRenderPath, "utf8")) : heroIds;

/**
 * WHICH SECTION THE BOARD IS OFFERING.
 *
 * The registry names it. `Variant.section` is a required field precisely so a board can say
 * which inner section is its argument, and `<slot name="section">` is where BoardFrame puts it.
 *
 * This used to take the LAST data-section-id in the render, on the reasoning that the render is
 * what exists and a convention is only a promise about what somebody typed. That reasoning is
 * right about the ids and wrong about WHICH id: a board renders hero, its section, and a proof
 * block, so "last" is the proof every time. Measured on a real build: b3 registers
 * `section: "process"`, the composed home lifted `b3-process`, and the gate reported the pick
 * "quietly overruled" because the last mark on b3's board is `b3-proof`. A false failure on an
 * honest build teaches people to stop reading the gate.
 *
 * So: read the registry, then CONFIRM the id it names is actually in the render. The registry
 * decides which section; the render still decides whether it exists. A registry that names a
 * section the board never rendered falls back to positional, which is the old behaviour and is
 * better than nothing.
 */
function registeredSectionId(variantId) {
  const src = ["src/lib/variants.ts", "src/lib/variants.js"]
    .map((f) => join(dir, f))
    .find((f) => existsSync(f));
  if (!src) return null;
  let text = "";
  try { text = readFileSync(src, "utf8"); } catch { return null; }
  // The variant's own object literal, from its id to the next id (or the end).
  const at = text.indexOf(`id: "${variantId}"`);
  if (at < 0) return null;
  const nextId = text.indexOf('id: "', at + 6);
  const block = text.slice(at, nextId > at ? nextId : text.length);
  const m = block.match(/\bsection:\s*["'`]([^"'`]+)["'`]/);
  if (!m) return null;
  const named = `${variantId}-${m[1]}`;
  return sectionIdsOfPick.includes(named) ? named : null;
}
const innerSectionId =
  registeredSectionId(sectionPick.variant_id) ??
  (sectionIdsOfPick.length > 1 ? sectionIdsOfPick[sectionIdsOfPick.length - 1] : null);

/**
 * The tag-and-first-class skeleton of a chunk of markup.
 *
 * The same signal gate-uniqueness reads, for the same reason: it survives a re-skin and a copy
 * change, and it does not survive a section being rebuilt from scratch. Used here to check that
 * the section carrying the picked id IS the picked section, not a stub that borrowed its name.
 */
function structSig(html) {
  const sig = [];
  const re = /<(section|header|main|footer|article|aside|nav|div|h1|h2|h3|p|ul|ol|figure|a|img|span)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cm = /class\s*=\s*"([^"]*)"/i.exec(m[2] || "");
    const cls = ((cm && cm[1]) || "").trim().split(/\s+/)[0] || "";
    sig.push(`${m[1].toLowerCase()}.${cls.toLowerCase()}`);
  }
  return new Set(sig);
}
function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
/**
 * The markup of the element carrying an id, from its own opening tag to the matching close.
 *
 * IT READS THE MARKED ELEMENT, WHATEVER TAG IT IS. This used to walk back to the nearest
 * `<section`, which on a board whose hero root is a `<div>` (or a `<header>`) returns the
 * PREVIOUS section, or nothing at all, and a null here skips the skeleton comparison in
 * silence: the one check that tells a lifted hero from a rebuilt one with the same id simply
 * stopped running, and the gate still printed a pass.
 */
function sectionMarkup(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  // The marker sits inside the element's own opening tag, so the nearest `<` before it starts
  // that tag.
  const open = html.lastIndexOf("<", at);
  if (open < 0) return null;
  const named = /^<([a-zA-Z][\w-]*)/.exec(html.slice(open, at + marker.length));
  if (!named) return null;
  const tag = named[1].toLowerCase();
  let i = open;
  let depth = 0;
  const re = new RegExp(`<\\/?${tag}\\b`, "gi");
  re.lastIndex = open;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("</")) { depth--; if (depth === 0) return html.slice(open, m.index + tag.length + 3); }
    else depth++;
    i = m.index;
  }
  return html.slice(open, Math.min(html.length, i + 4000));
}

// -------------------------------------------------------------------- measure both
const findings = [];
const add = (what, detail) => findings.push({ what, detail });
const notes = [];
/**
 * A framing finding, unless somebody recorded why the frame changed.
 *
 * The override is printed whether or not anything else fails, so a build that departed from
 * the board on purpose still says so on the way past.
 */
const addFramed = (sectionId, what, detail) => {
  const o = overrideFor(sectionId);
  if (o) { notes.push(`override on /, ${String(o.section).trim()}: ${o.reason || "no reason recorded"}`); return; }
  add(what, detail);
};

let playwright;
try { playwright = engineRequire("playwright"); }
catch { cannotCheck(`playwright is not installed (${join(HERE, "reference-capture", "setup.sh")}), so nothing was measured.`); }

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".json": "application/json", ".xml": "application/xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
};
const BOARD_ROUTE = "/__palate-board.html";
function serve(root, port, boardHtml) {
  return new Promise((ok, no) => {
    const s = createServer((req, res) => {
      let p;
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, "http://l").pathname); }
      catch { res.writeHead(400); res.end(); return; }
      // The board is served FROM THE BUILD'S OWN ORIGIN so its absolute asset paths resolve.
      if (boardHtml && pathname === BOARD_ROUTE) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(boardHtml);
        return;
      }
      p = join(root, pathname);
      for (const f of [p, join(p, "index.html"), `${p}/index.html`]) {
        try {
          if (statSync(f).isFile()) {
            res.writeHead(200, { "Content-Type": TYPES[f.slice(f.lastIndexOf("."))] || "application/octet-stream" });
            res.end(readFileSync(f));
            return;
          }
        } catch { /* next candidate */ }
      }
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>404</title>");
    });
    s.on("error", no);
    s.listen(port, () => ok(s));
  });
}
async function serveOnFreePort(root, first, boardHtml) {
  let last = null;
  for (let p = first; p < first + 6; p++) {
    try { return { server: await serve(root, p, boardHtml), port: p }; }
    catch (e) { last = e; if (e && e.code === "EADDRINUSE") continue; throw e; }
  }
  throw last;
}

/**
 * Hide the Explore scaffolding and everything below the fold, then measure.
 *
 * Hidden rather than removed, which is the one lever design-measure.mjs already honours and
 * which, unlike removing nodes, cannot move the layout of what remains.
 *
 * THE SCAFFOLDING HAS TO GO OR THE COMPARISON IS RIGGED. The direction picker is a fixed pill
 * in the corner, so it is above the fold at 1440x900 on every board, and it sets a monospace
 * face nothing in the design chose. The board render always carries it and the composed home
 * never does, so leaving it in would report the picker as a type drift on every honest build.
 */
/**
 * Hide everything outside the picked hero section, then measure.
 *
 * THE SECTION IS THE UNIT, not a 900px window. The window was tried: below the board's hero
 * sits the system strip and below the home's hero sits the next real section, so the two
 * windows contain different things and the gate reported an 11% type-scale drift on a home
 * page composed from the board's own component. Scoping to the section makes the two sides
 * the same thing by construction.
 *
 * Ancestors stay visible because they carry the ground the section sits on. The direction
 * picker and the SectionMark badge fall outside the hero and are hidden with everything else,
 * which is what keeps a monospace pill in the corner out of the type comparison.
 *
 * Returns null when the marker is not there, so the caller reports what it could not measure
 * rather than measuring the whole page and calling the answer a comparison.
 */
async function measureHeroScope(page, selector) {
  const scoped = await page.evaluate(({ sel, scaffolding }) => {
    const marked = document.querySelector(sel);
    if (!marked) return false;
    const hero = marked.matches("section") ? marked : (marked.closest("section") || marked);
    for (const el of document.body.querySelectorAll("*")) {
      if (el === hero || hero.contains(el) || el.contains(hero)) continue;
      el.style.visibility = "hidden";
    }
    // AND THE SCAFFOLDING INSIDE THE HERO. The SectionMark badge sits within the section it
    // labels and sets a monospace face nothing in the design chose, so the board carries it and
    // the composed home never does: measured, that reads as "missing ui-monospace" on an honest
    // build. `:not(section)` covers renders taken before the badge declared itself.
    //
    // NEVER THE HERO ITSELF, OR ANYTHING IT SITS INSIDE. `[data-section-id]:not(section)`
    // matches a hero whose root is a `<div>` (or a `<header>`, or a `<footer>`), so the one
    // element the whole comparison is scoped to was hidden and the board measured as setting
    // no type, no accent and no scale at all. Hiding an ancestor does the same thing, because
    // visibility inherits.
    for (const el of document.querySelectorAll(scaffolding)) {
      if (el === hero || el.contains(hero)) continue;
      el.style.visibility = "hidden";
    }
    return true;
  }, { sel: selector, scaffolding: "[data-palate-mark], .ev-switcher, [data-section-id]:not(section)" });
  if (!scoped) return null;
  return measurePage(page);
}

/**
 * How the hero is FRAMED, plus the height of every marked section, read the same way on both
 * sides.
 *
 * One evaluate, run against the board and against the built home with nothing but the selector
 * changing, so the classification is symmetric by construction. An asymmetric measurement is
 * the fault this file already learned once, when a 900px window contained the board's system
 * strip on one side and the home's next real section on the other and reported an 11% drift on
 * a page composed from the board's own component.
 *
 * Run BEFORE the scoping sweep. `visibility: hidden` does not move a layout, so the heights
 * would survive it, but a measurement that does not depend on the order it is called in is one
 * fewer thing to be wrong about later.
 *
 * Nothing here is a judgement. It returns what it saw and returns nulls for what it could not
 * see, and the caller says out loud which comparisons it therefore could not make.
 */
async function measureFraming(page, heroSelector, sectionSelector) {
  return page.evaluate(({ heroSel, sectionSel, bleedTol }) => {
    const marked = document.querySelector(heroSel);
    const hero = marked ? (marked.matches("section") ? marked : (marked.closest("section") || marked)) : null;
    const out = { found: Boolean(hero), media: null, framing: null, h1: null, sections: {} };

    // Every marked section's rendered height, tallest wins if an id is somehow marked twice.
    for (const el of document.querySelectorAll(sectionSel)) {
      const id = el.getAttribute("data-palate-section") || el.getAttribute("data-section-id");
      if (!id) continue;
      const h = Math.round(el.getBoundingClientRect().height);
      if (h <= 0) continue;
      if (!(id in out.sections) || h > out.sections[id]) out.sections[id] = h;
    }
    if (!hero) return out;

    // The hero's media is its LARGEST picture-shaped box. Largest by area rather than first in
    // document order, because a logo in the corner is an img too and it is not the framing.
    let best = null;
    for (const el of hero.querySelectorAll('img, video, picture, [style*="background-image"]')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (!best || r.width * r.height > best.width * best.height) {
        best = { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) };
      }
    }
    if (best) {
      out.media = best;
      out.framing = Math.abs(best.width - window.innerWidth) <= bleedTol ? "bleed" : "inset";
    }

    const h1 = hero.querySelector("h1");
    if (h1) {
      const size = Number.parseFloat(window.getComputedStyle(h1).fontSize);
      out.h1 = {
        size: Number.isFinite(size) ? Math.round(size) : null,
        top: Math.round(h1.getBoundingClientRect().top),
      };
    }
    return out;
  }, { heroSel: heroSelector, sectionSel: sectionSelector, bleedTol: BLEED_TOLERANCE_PX });
}

/** Where the h1 sits relative to the hero's media, in the words the finding uses. */
const h1Place = (h1, media) => (h1 && media ? (h1.top < media.top ? "above the media" : "below the media") : null);

/**
 * The dominant accent: the heaviest colour that is not a neutral.
 *
 * design-measure.mjs has its own `isNeutral` and does not export it, and that module is
 * byte-identical to the grader's copy and hash-pinned in both repos, so adding an export here
 * would break `check-design-measure-sync.mjs`. The chroma test below is the same idea (is
 * there any colour in this colour) computed locally rather than a second definition of the
 * scoring rule, which stays where it lives.
 */
function dominantAccent(colours) {
  for (const c of colours || []) {
    const h = c.v.replace("#", "");
    if (h.length !== 6) continue;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (Math.max(r, g, b) - Math.min(r, g, b) >= 24) return c.v;
  }
  return null;
}

/** The ratio of the largest type to the body size: the shape of the scale, not its values. */
function typeScale(sizes) {
  const nums = (sizes || []).map((s) => ({ px: Number(s.v), w: s.w })).filter((s) => Number.isFinite(s.px));
  if (!nums.length) return null;
  const largest = Math.max(...nums.map((s) => s.px));
  const bodyCandidates = nums.filter((s) => s.px >= 14 && s.px <= 20).sort((a, b) => b.w - a.w);
  const body = bodyCandidates.length ? bodyCandidates[0].px : Math.min(...nums.map((s) => s.px));
  return body > 0 ? largest / body : null;
}

const browser = await playwright.chromium.launch();
let boardServer = null;
let homeServer = null;
let exitCode = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: FOLD }, deviceScaleFactor: 1 });

  // --- the board, from its own archived directory -------------------------------------
  // The board is an artboard: self-contained CSS, bare-filename images copied beside it
  // (Task 3). Serve its own directory, not the build's, so b1-img1.jpg resolves and no dist
  // is needed for the board itself.
  const boardServed = await serveOnFreePort(join(shotsRoot, heroPick.variant_id), Number(opt("--port", "8791")), readFileSync(heroRenderPath, "utf8"));
  boardServer = boardServed.server;
  const boardPage = await ctx.newPage();
  await boardPage.goto(`http://127.0.0.1:${boardServed.port}${BOARD_ROUTE}`, { waitUntil: "load", timeout: 30000 });
  await boardPage.waitForTimeout(300);
  const boardFraming = await measureFraming(boardPage, `[data-section-id="${heroSectionId}"]`, "[data-section-id]");
  const boardFacts = await measureHeroScope(boardPage, `[data-section-id="${heroSectionId}"]`);
  if (!boardFacts) {
    cannotCheckMidRun(`the archived render of ${heroPick.variant_id} has no element marked ${heroSectionId}, so its hero could not be scoped.`);
  }

  // --- the built home, from its own build directory (a second server) or --serve ------
  async function serveDist(root) {
    // Same starting port as the board: the board already holds it, so serveOnFreePort's own
    // EADDRINUSE handling walks past it onto the next free one, with no port math here.
    const served = await serveOnFreePort(root, Number(opt("--port", "8791")), null);
    homeServer = served.server;
    return `http://127.0.0.1:${served.port}/`;
  }
  const homeUrl = serveUrl || (distRoot ? await serveDist(distRoot) : null);
  const homePage = await ctx.newPage();
  const res = await homePage.goto(homeUrl, { waitUntil: "networkidle", timeout: 45000 }).catch(() => null);
  if (!res || !res.ok()) cannotCheckMidRun(`the built home did not load at ${homeUrl} (${res ? res.status() : "no response"}).`);
  const homeHtml = await homePage.content();
  await homePage.waitForTimeout(300);
  const heroShot = join(shotsRoot, "_built-hero.png");
  mkdirSync(shotsRoot, { recursive: true });
  await homePage.screenshot({ path: heroShot, fullPage: false });
  const homeFraming = await measureFraming(
    homePage,
    `[data-palate-section="${heroSectionId}"], [data-section-id="${heroSectionId}"]`,
    "[data-palate-section], [data-section-id]",
  );
  const homeFacts = await measureHeroScope(homePage, `[data-palate-section="${heroSectionId}"], [data-section-id="${heroSectionId}"]`);

  // --- 0. could the home's hero be found at all? --------------------------------------
  // Everything below compares the two heroes, so an unmarked home is not a drift, it is an
  // unmeasurable comparison, and the section checks further down say so specifically.
  if (!homeFacts) {
    notes.push(`the built home carries no element marked ${heroSectionId}, so the faces, the accent and the type scale could not be compared.`);
  }

  // --- 1. the faces of the picked hero -------------------------------------------------
  const boardFonts = new Set((boardFacts.fonts || []).map((f) => f.v).filter(Boolean));
  const homeFonts = new Set(((homeFacts && homeFacts.fonts) || []).map((f) => f.v).filter(Boolean));
  if (homeFacts) {
  const missing = [...boardFonts].filter((f) => !homeFonts.has(f));
  const extra = [...homeFonts].filter((f) => !boardFonts.has(f));
  if (missing.length || extra.length) {
    add(
      "the type is not the picked board's",
      `in the hero the board sets [${[...boardFonts].join(", ") || "nothing"}] and the built home sets [${[...homeFonts].join(", ") || "nothing"}]` +
      `${missing.length ? `; missing ${missing.join(", ")}` : ""}${extra.length ? `; added ${extra.join(", ")}` : ""}. ` +
      "The faces are the loudest thing a client picked, so a face that arrived from somewhere else is a different direction wearing the same layout.",
    );
  }
  }

  // --- 2. the accent ------------------------------------------------------------------
  const boardAccent = dominantAccent(boardFacts.colours);
  const homeAccent = homeFacts ? dominantAccent(homeFacts.colours) : null;
  if (!boardAccent || !homeAccent) {
    if (homeFacts) notes.push(`the accent could not be compared (${!boardAccent ? "the board" : "the built home"} leads with no chromatic colour in its hero).`);
  } else {
    const d = deltaE(boardAccent, homeAccent);
    if (d > ACCENT_MAX_DELTA_E) {
      add(
        "the accent is not the picked board's",
        `the board leads with ${boardAccent} and the built home leads with ${homeAccent}, deltaE ${d.toFixed(1)} against a ceiling of ${ACCENT_MAX_DELTA_E}. ` +
        "That is a difference a reader sees. Adopt the board's tokens rather than re-deriving them.",
      );
    } else {
      notes.push(`accent ${homeAccent} against the board's ${boardAccent}, deltaE ${d.toFixed(1)}.`);
    }
  }

  // --- 3. the type scale --------------------------------------------------------------
  const boardScale = typeScale(boardFacts.sizes);
  const homeScale = homeFacts ? typeScale(homeFacts.sizes) : null;
  if (!boardScale || !homeScale) {
    if (homeFacts) notes.push("the type scale could not be compared (one side set no measurable type in its hero).");
  } else {
    const drift = Math.abs(homeScale - boardScale) / boardScale;
    if (drift > TYPE_SCALE_TOLERANCE) {
      add(
        "the type scale is not the picked board's",
        `the board runs ${boardScale.toFixed(2)} from body to display and the built home runs ${homeScale.toFixed(2)}, ` +
        `${Math.round(drift * 100)}% apart against a ${Math.round(TYPE_SCALE_TOLERANCE * 100)}% tolerance. The scale is the direction's voice at every size, not only in the hero.`,
      );
    } else {
      notes.push(`type scale ${homeScale.toFixed(2)} against the board's ${boardScale.toFixed(2)}.`);
    }
  }

  // --- 4. the hero section is the FIRST section of the built page ---------------------
  const homeMarks = [...homeHtml.matchAll(/data-palate-section="([^"]+)"|data-section-id="([^"]+)"/g)].map((m) => m[1] || m[2]);
  if (!homeMarks.length) {
    add(
      "the built home names no sections",
      `nothing in the built home carries data-palate-section, so the picked board's sections cannot be traced into it. ` +
      `Put data-palate-section="${heroSectionId}" on the lifted hero (and the same for every lifted section), which is what makes a pick checkable rather than asserted.`,
    );
  } else if (homeMarks[0] !== heroSectionId) {
    add(
      "the picked hero is not the entrance",
      `the client picked ${heroPick.variant_id} for the hero (${heroSectionId}) and the built home opens with ${homeMarks[0]}. The entrance is the whole of a first impression.`,
    );
  } else {
    const boardSection = sectionMarkup(readFileSync(heroRenderPath, "utf8"), `data-section-id="${heroSectionId}"`);
    const homeSection = sectionMarkup(homeHtml, `data-palate-section="${heroSectionId}"`) || sectionMarkup(homeHtml, `data-section-id="${heroSectionId}"`);
    if (boardSection && homeSection) {
      const sim = jaccard(structSig(boardSection), structSig(homeSection));
      if (sim < SIGNATURE_FLOOR) {
        add(
          "the hero carries the picked name and not its structure",
          `the section marked ${heroSectionId} in the built home shares ${Math.round(sim * 100)}% of the board's tag-and-class skeleton, under the ${Math.round(SIGNATURE_FLOOR * 100)}% floor. ` +
          "A name is a label anyone can type. Lift the component rather than rebuilding something with the same id.",
        );
      } else {
        notes.push(`the hero ${heroSectionId} matches the board's structure at ${Math.round(sim * 100)}%.`);
      }
    }
  }

  // --- 5. the picked inner section appears --------------------------------------------
  if (innerSectionId) {
    if (!homeMarks.includes(innerSectionId)) {
      add(
        "the picked section is missing",
        `the client picked ${sectionPick.variant_id}'s ${innerSectionId} and the built home carries [${homeMarks.join(", ") || "nothing"}]. ` +
        "A section that was chosen and then not built is the pick quietly overruled.",
      );
    } else {
      notes.push(`the picked section ${innerSectionId} is present.`);
    }
  } else {
    notes.push("the picked board registers no inner section, so only the hero was compared.");
  }

  // --- 6. the hero's framing ------------------------------------------------------------
  // Bleed against inset is the single loudest thing about an entrance, and it is exactly what
  // the similarity head cannot see: same photograph, same type, same accent, rearranged.
  if (!boardFraming.media || !homeFraming.media) {
    notes.push(
      `the hero's framing could not be compared (${!boardFraming.media ? "the board" : "the built home"} shows no picture-shaped box in its hero).`,
    );
  } else if (boardFraming.framing !== homeFraming.framing) {
    addFramed(
      heroSectionId,
      "the hero's framing is not the picked board's",
      `board: ${boardFraming.framing}, built: ${homeFraming.framing}. The board's hero media is ${boardFraming.media.width}px wide and the built home's is ${homeFraming.media.width}px at the same 1440 viewport. ` +
      "Whether the entrance opens edge to edge or sits in a column is the arrangement the client chose, and every other measure here can agree while that one changes the page. " +
      `If the change is deliberate, record it: palate-pick.mjs --override / --section ${heroSectionId} --what "..." --reason "...".`,
    );
  } else {
    notes.push(`the hero's framing is ${homeFraming.framing} on both sides.`);
  }

  // --- 7. the h1 -------------------------------------------------------------------------
  // Its size and where it sits relative to the media. A headline demoted from over the
  // photograph to a small line above it is a different entrance in the same components.
  if (!boardFraming.h1 || !homeFraming.h1 || !boardFraming.h1.size || !homeFraming.h1.size) {
    notes.push(`the h1 could not be compared (${!boardFraming.h1 || !boardFraming.h1.size ? "the board" : "the built home"} sets no measurable h1 in its hero).`);
  } else {
    const boardPlace = h1Place(boardFraming.h1, boardFraming.media);
    const homePlace = h1Place(homeFraming.h1, homeFraming.media);
    const sizeDrift = Math.abs(homeFraming.h1.size - boardFraming.h1.size) / boardFraming.h1.size;
    const moved = Boolean(boardPlace && homePlace && boardPlace !== homePlace);
    const where = (place) => (place ? ` ${place}` : "");
    if (sizeDrift > H1_TOLERANCE || moved) {
      addFramed(
        heroSectionId,
        "the h1 is not the picked board's",
        `board ${boardFraming.h1.size}px${where(boardPlace)}, built ${homeFraming.h1.size}px${where(homePlace)}` +
        `${sizeDrift > H1_TOLERANCE ? `, ${Math.round(sizeDrift * 100)}% apart against a ${Math.round(H1_TOLERANCE * 100)}% tolerance` : ""}` +
        `${moved ? ", and it changed sides of the media" : ""}. ` +
        "The headline is the first thing read and the board decided how loudly it is said.",
      );
    } else {
      notes.push(`the h1 is ${homeFraming.h1.size}px against the board's ${boardFraming.h1.size}px${where(homePlace)}.`);
    }
  }

  // --- 8. the carried sections keep their room --------------------------------------------
  // Only SHORTER is a finding. A built page legitimately carries more copy than a board does,
  // so a taller section is the page doing its job; a section compressed to a fraction of the
  // room the board gave it is the board's composition quietly undone.
  const carried = Object.keys(boardFraming.sections).filter((id) => id in homeFraming.sections);
  if (!carried.length) {
    notes.push("no marked section appears on both the board and the built home, so no section height was compared.");
  }
  for (const id of carried) {
    const boardH = boardFraming.sections[id];
    const homeH = homeFraming.sections[id];
    if (!boardH) continue;
    const shorterBy = (boardH - homeH) / boardH;
    if (shorterBy > SECTION_HEIGHT_TOLERANCE) {
      addFramed(
        id,
        `section ${id} is ${Math.round(shorterBy * 100)}% shorter than on the board`,
        `the board gives it ${boardH}px and the built home gives it ${homeH}px at the same 1440 viewport, past a ${Math.round(SECTION_HEIGHT_TOLERANCE * 100)}% tolerance. ` +
        "Room is a design decision: the same elements in two thirds of the height is a denser page than the one the client chose.",
      );
    } else {
      notes.push(`section ${id} runs ${homeH}px against the board's ${boardH}px.`);
    }
  }

  // --- 9. the appearance similarity, always attempted -----------------------------------
  let similarity = null;
  try {
    const { embedHero, disposeTaste } = await import("./reference-capture/taste-local.mjs");
    try {
      const boardHero = join(shotsRoot, heroPick.variant_id, "hero.png");
      const a = await embedHero(boardHero);
      const b = await embedHero(heroShot);
      if (!a.applicable || !b.applicable) {
        const bad = a.applicable ? b : a;
        notes.push(`appearance similarity UNMEASURED: ${bad.reason} (${bad.detail || "no detail"}). The verdict rests on the measured facts alone.`);
      } else {
        // Both vectors are l2-normalised by embedHero, so the dot product IS the cosine.
        similarity = a.embedding.reduce((s, x, i) => s + x * b.embedding[i], 0);
        if (similarity < SIMILARITY_FLOOR) {
          add(
            "the built home does not look like the picked board",
            `cosine similarity ${similarity.toFixed(3)} against a floor of ${SIMILARITY_FLOOR}. The measured facts may agree while the page reads as a different design; this is the check that sees that.`,
          );
        } else {
          notes.push(`appearance similarity ${similarity.toFixed(3)}.`);
        }
      }
    } finally {
      // NOT HOUSEKEEPING. Without it the ONNX runtime tears itself down during exit and aborts
      // AFTER every line has been written, turning a clean exit 0 into 134, which every caller
      // of this gate would read as a failed comparison.
      await disposeTaste().catch(() => {});
    }
  } catch (e) {
    notes.push(`appearance similarity UNMEASURED: the head could not run (${String(e && e.message ? e.message : e).slice(0, 160)}). The verdict rests on the measured facts alone.`);
  }


  // ------------------------------------------------------------------------ the verdict
  if (findings.length) {
    process.stderr.write(`gate-fidelity: ${findings.length} way(s) the built home has drifted from the picked direction (${heroPick.variant_id}, rung ${heroPick.rung}).\n\n`);
    for (const f of findings) process.stderr.write(`  [${f.what}] ${f.detail}\n`);
    if (notes.length) {
      process.stderr.write("\n  Measured and clean:\n");
      for (const n of notes) process.stderr.write(`    - ${n}\n`);
    }
    exitCode = 1;
  } else {
    process.stdout.write(`gate-fidelity: the built home carries the picked direction (${heroPick.variant_id}, rung ${heroPick.rung}, hero ${heroSectionId}).\n`);
    for (const n of notes) process.stdout.write(`  - ${n}\n`);
  }
} catch (e) {
  if (!(e instanceof SkipSignal)) throw e;
  // Printed exactly as cannotCheck() prints it. process.exitCode, never process.exit(), so the
  // `finally` below still runs and closes the browser and both servers before the process ends.
  process.stderr.write(`gate-fidelity: skipped (${e.message})\n`);
  process.stderr.write("gate-fidelity: NOT a pass.\n");
  exitCode = 2;
} finally {
  await browser.close().catch(() => {});
  if (boardServer) boardServer.close();
  if (homeServer) homeServer.close();
}

/**
 * NEVER process.exit() ONCE THE APPEARANCE HEAD HAS BEEN RESIDENT.
 *
 * `process.exit()` races the ONNX runtime's native teardown, which aborts with
 * "mutex lock failed: Invalid argument" AFTER every line of output has been written and turns
 * a clean 0 into 134. Every caller of this gate reads a non-zero exit as a failed comparison,
 * so a passing build would have been reported as drifted. grade-local.mjs carries the same rule
 * for the same reason. Set the code and let the process unwind: the browser and both servers
 * are closed above, so nothing holds the loop open.
 */
process.exitCode = exitCode;
