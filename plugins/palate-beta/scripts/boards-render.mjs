#!/usr/bin/env node
/**
 * scripts/boards-render.mjs - turn the registered direction boards into canvas artboards.
 *
 * ========================== WHAT IT IS FOR ==========================
 *
 * Explore stopped building eight complete home pages. It builds boards: a hero, the system
 * strip, one inner section and the notes panel. This script renders each of them once and
 * writes the working files the operator hands to the Claude Design canvas, plus the hero
 * stills the `/explore` page and the fidelity gate both read.
 *
 * THE CANVAS IS NEVER THE SOURCE OF TRUTH. The Astro project is. An artboard is a snapshot of
 * a rendered board, deliberately flattened so the canvas's property panel can restyle it; what
 * the client changes there is FEEDBACK, read back by `scripts/palate-pick.mjs`, and it is
 * Compose that decides what the site does about it.
 *
 * ========================= WHY IT FLATTENS =========================
 *
 * The canvas editor edits inline `style` attributes. A page whose colour comes from a class in
 * a stylesheet is, to a client dragging a swatch, unstyleable: they click a heading and the
 * panel has nothing to change. So every element carries its computed value for a fixed list of
 * properties (PROPERTY_LIST) as an inline style, and the stylesheet travels too, in the helmet,
 * for everything inline styles cannot express (pseudo-elements, hover, keyframes).
 *
 * The artboard is a FIXED 1440-wide frame. Inline computed values are the values at 1440, so a
 * flattened board does not reflow; that is the trade the canvas asks for and it is why the
 * frame's width and height are written into canvas.json rather than guessed.
 *
 * ================== WHAT IT REFUSES TO DO =========================
 *
 * There is NO network inside the canvas. Every asset is inlined or written beside the artboard,
 * and anything that cannot be is a failure rather than a silently broken frame:
 *   - an image that will not come under 70 KB exits 2 naming it,
 *   - a registered board with no built page exits 2 naming it,
 *   - and a failure on board 4 REMOVES THE SEED DIRECTORY, so a half-written seed can never be
 *     handed to a client as though it were the set.
 *
 * Scripts are stripped. The site's own motion script is inlined when it is under 20 KB AND
 * self-contained: a module whose `import` cannot be fetched is dead weight in a canvas with no
 * egress, and it would look like motion that simply did not fire.
 *
 * Usage:
 *   node scripts/boards-render.mjs <projectDir> [--out .palate/explore] [--no-build]
 *                                  [--refs .palate/explore/refs.json] [--port 8794]
 * Exit: 0 wrote the seed, 2 could not (with the reason and the board named).
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, copyFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { invokedDirectly } from "./lib/invoked-directly.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "reference-capture");
// playwright and sharp live with the capture engine, exactly as verify-rendered and
// palate-assets resolve them. No new dependency, and one runtime to install.
const engineRequire = createRequire(new URL("./reference-capture/", import.meta.url));

/**
 * The properties the canvas property panel edits. Written as inline styles on every element so
 * a client can click a heading and change it. Kept short on purpose: every extra property is
 * bytes on every element, and these are the ones a person reaches for.
 */
export const PROPERTY_LIST = [
  "color", "background-color", "font-family", "font-size", "font-weight",
  "line-height", "letter-spacing", "padding", "margin", "border-radius", "gap",
  "display", "flex-direction", "align-items", "justify-content", "grid-template-columns",
];

const MAX_IMAGE_BYTES = 70 * 1024;
/**
 * The ladder an image is walked down to reach the ceiling: width first, then quality.
 *
 * Quality alone was tried and it does not get there on a photographic capture. A 1440-wide
 * hero at quality 32 is both over the ceiling and ugly, where the same picture at 1000 wide
 * and quality 58 is under it and still reads. Width is the cheaper axis on a frame that is
 * never magnified, so it moves first.
 */
const IMAGE_LADDER = [
  { width: 1200, quality: 78 },
  { width: 1200, quality: 64 },
  { width: 1000, quality: 58 },
  { width: 860, quality: 52 },
  { width: 720, quality: 45 },
  { width: 640, quality: 38 },
];
const MAX_SCRIPT_BYTES = 20 * 1024;
const FRAME_WIDTH = 1440;
const HERO_HEIGHT = 900;
const REF_WIDTH = 720;
const REF_HEIGHT = 580;
const ROW_GAP = 120;
const FRAME_GAP = 80;

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
// Only these flags take a value, so a positional is anything not a flag and not one of their
// values. Guessing from "the previous argument was a flag" swallowed the project directory
// whenever it followed --no-build.
const VALUE_FLAGS = new Set(["--out", "--refs", "--port"]);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) { if (VALUE_FLAGS.has(args[i])) i++; continue; }
  positional.push(args[i]);
}

/**
 * EVERY REFUSAL CLEARS THE SEED, not only a failure part-way through the set.
 *
 * The dangerous case is not a half-written directory, it is a COMPLETE one from the last run.
 * Add a rung, re-render, get refused because its page is missing, and a seed describing the
 * previous set is still sitting there looking current. A seed that does not match the registry
 * must not exist, and regenerating one is cheap.
 */
let seedToClear = null;
function die(reason) {
  if (seedToClear) {
    rmSync(seedToClear, { recursive: true, force: true });
    process.stderr.write(`boards-render: the seed directory was cleared, because a seed that does not match the registry must not exist.\n`);
  }
  process.stderr.write(`boards-render: ${reason}\n`);
  process.exit(2);
}

/**
 * Every board entry, parsed out of the registry's source.
 *
 * The registry is TypeScript with a commented-out example carrying every required field, so a
 * naive regex scan reads the template itself as a registered board. Comments are stripped first,
 * the same way gate-explore does it, and for the same reason.
 */
export function parseRegistry(src) {
  const clean = stripComments(src);
  const body = arrayBody(clean, "variants");
  if (!body) return [];
  return objects(body).map((o) => ({
    id: field(o, "id"),
    name: field(o, "name"),
    href: field(o, "href"),
    ambition: field(o, "ambition"),
    what: field(o, "what"),
    why: field(o, "why"),
    feeling: field(o, "feeling"),
    donor: field(o, "donor"),
    section: field(o, "section"),
    motion: field(o, "motion"),
    clip: field(o, "clip"),
  })).filter((v) => v.id);
}

function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out;
}

function arrayBody(src, name) {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]*)?=\\s*\\[`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") depth--;
    i++;
  }
  return depth === 0 ? src.slice(start, i - 1) : null;
}

function objects(body) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < body.length) {
        if (body[i] === "\\") { i += 2; continue; }
        if (body[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) out.push(body.slice(start, i + 1)); }
  }
  return out;
}

function field(obj, key) {
  const s = new RegExp(`\\b${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`, "s").exec(obj);
  if (s) return s[2].replace(/\\(['"\`])/g, "$1").trim();
  const num = new RegExp(`\\b${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(obj);
  return num ? Number(num[1]) : null;
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Write PROPERTY_LIST's computed values onto every element as an inline style.
 *
 * Runs in the page, not here, because only the browser knows what a class resolved to. Values
 * already set inline win: a style the author wrote is a decision, and overwriting it with the
 * same computed number would only make the artboard bigger.
 */
export async function inlineComputedStyles(page, propertyList) {
  return page.evaluate((props) => {
    let touched = 0;
    let key = 0;
    for (const el of document.body.querySelectorAll("*")) {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "template") continue;
      /**
       * A STABLE KEY, so the read-back can tell a deletion from a shift.
       *
       * The canvas editor edits text and inline styles; it does not rewrite attributes. Without
       * a key the diff could only align by position, and deleting one paragraph reported every
       * element after it as an edit: measured on a real board, one deletion produced 167
       * "changes", and the run then told Compose to honour all of them. With a key a deletion
       * is one entry that says so.
       */
      if (!el.hasAttribute("data-palate-k")) el.setAttribute("data-palate-k", `k${++key}`);
      const cs = getComputedStyle(el);
      const own = el.getAttribute("style") || "";
      const add = [];
      for (const p of props) {
        if (own.includes(p + ":")) continue;
        const v = cs.getPropertyValue(p);
        if (!v || v === "none" || v === "normal" || v === "auto") continue;
        add.push(`${p}:${v}`);
      }
      if (add.length) {
        el.setAttribute("style", own ? `${own.replace(/;\s*$/, "")};${add.join(";")}` : add.join(";"));
        touched++;
      }
    }
    return touched;
  }, propertyList);
}

/**
 * The artboard, in the shape the canvas editor requires.
 *
 * The support.js line is copied verbatim because the editor replaces it; changing its spelling
 * is how an artboard stops being editable with nothing saying so.
 */
export function toArtboard({ html, css, fonts = "", imports = [], script = "", name = "" }) {
  const head = [
    // @import MUST COME FIRST. CSS ignores an @import that follows any other rule, so a
    // Google Fonts sheet appended after the stylesheet is a sheet that never loads, silently.
    ...imports.map((href) => `@import url("${href}");`),
    fonts,
    css,
    // The frame is fixed at 1440. Without this the flattened body inherits the canvas's own
    // width and every computed value written at 1440 describes a layout that is not there.
    `x-dc{display:block;width:${FRAME_WIDTH}px;overflow:hidden}`,
    "body{margin:0}",
    "img{max-width:100%}",
  ].filter(Boolean).join("\n");
  const motion = script ? `<script>${script}</script>` : "";
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<script src=\"./support.js\"></script></head><body>" +
    `<x-dc><helmet><style>${head}</style></helmet>` +
    `<!-- ${escapeHtml(name)} -->` +
    html +
    motion +
    "</x-dc></body></html>"
  );
}

/**
 * The canvas manifest: row 0 the calibration references, row 1 the boards in ladder order.
 *
 * Frames neither scale nor crop on the canvas, so w and h are the RENDERED size and nothing
 * here may round them. 80 px between frames in a row, 120 px between rows, per the canvas's
 * own layout rules.
 */
export function writeCanvasJson({ boards, refs = [], out }) {
  const artboards = [];
  const annotations = [];

  let rowHeight = 0;
  if (refs.length) {
    let x = 0;
    for (const r of refs) {
      artboards.push({ file: `Ref${r.position}.dc.html`, x, y: 0, w: REF_WIDTH, h: REF_HEIGHT, title: `Reference ${r.position}: ${r.name}` });
      x += REF_WIDTH + FRAME_GAP;
      rowHeight = REF_HEIGHT;
    }
    annotations.push({
      id: "cal-q",
      x: 0,
      y: -140,
      w: 420,
      text: "Which of these is closest to how bold you want to be? The row below is the range we built from your answer.",
    });
  }

  const boardY = refs.length ? rowHeight + ROW_GAP : 0;
  let bx = 0;
  for (const b of boards) {
    artboards.push({
      file: `${b.file}`,
      x: bx,
      y: boardY,
      w: FRAME_WIDTH,
      h: b.height,
      title: `Rung ${b.ambition} of ${boards.length}: ${b.name}`,
    });
    annotations.push({
      id: `board-${String(b.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 34)}`,
      x: bx,
      y: boardY + b.height + 24,
      w: 420,
      text: `${b.name} - rung ${b.ambition} of ${boards.length}. ${b.feeling}. ${b.what}`,
    });
    bx += FRAME_WIDTH + FRAME_GAP;
  }

  const doc = { artboards, annotations, launch: { view: "canvas" } };
  if (out) writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

// ------------------------------------------------------------- static server
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve the build, stepping past a port another run has not released yet.
 *
 * Back-to-back runs collide on a fixed port and the second one dies with EADDRINUSE, which
 * reads as a broken render rather than as a socket in TIME_WAIT. It steps rather than waits,
 * and says which port it landed on.
 */
async function serveOnFreePort(root, first) {
  let last = null;
  for (let p = first; p < first + 6; p++) {
    try { return { server: await serve(root, p), port: p }; }
    catch (e) {
      last = e;
      if (e && e.code === "EADDRINUSE") continue;
      throw e;
    }
  }
  throw last;
}

function serve(root, port) {
  return new Promise((ok, no) => {
    const server = createServer((req, res) => {
      let p;
      try { p = join(root, decodeURIComponent(new URL(req.url, "http://localhost").pathname)); }
      catch { res.writeHead(400); res.end(); return; }
      const tryFiles = [p, join(p, "index.html"), `${p}/index.html`];
      for (const f of tryFiles) {
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
    server.on("error", no);
    server.listen(port, () => ok(server));
  });
}

// ----------------------------------------------------------------- the work
async function main() {
  const projectDir = resolve(positional[0] || ".");
  const outDir = resolve(projectDir, opt("--out", ".palate/explore"));
  const seedDir = join(outDir, "seed");
  const shotsDir = join(outDir, "shots");
  const port = Number(opt("--port", "8794"));
  const refsPath = opt("--refs", null);
  seedToClear = seedDir;

  if (!existsSync(join(projectDir, "src", "lib", "variants.ts"))) {
    die(`no ${join("src", "lib", "variants.ts")} under ${projectDir}. Not an Explore build; nothing rendered. NOT a pass.`);
  }
  const boards = parseRegistry(readFileSync(join(projectDir, "src/lib/variants.ts"), "utf8"))
    .sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
  if (!boards.length) die("no boards registered in src/lib/variants.ts. Register them first; nothing was rendered.");

  // Every registered board needs a page. A registry entry with no route is a link the client
  // clicks into a 404, which is worse than a board that was never offered.
  for (const b of boards) {
    const route = String(b.href || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!route) die(`board ${b.id} has no href. Nothing rendered.`);
    const page = join(projectDir, "src/pages", `${route}.astro`);
    if (!existsSync(page)) {
      die(`board ${b.id} registers ${b.href} and ${join("src/pages", `${route}.astro`)} does not exist. Nothing rendered.`);
    }
  }

  if (!flag("--no-build")) {
    const bin = join(projectDir, "node_modules/.bin/astro");
    if (!existsSync(bin)) die(`no ${bin}. Install the project's dependencies, or pass --no-build to read an existing dist/.`);
    try {
      // PUBLIC_EXPLORE_MODE=true, or the boards do not exist in the output.
      //
      // `SectionMark` and `ExploreSwitcher` render nothing without it, and `explore.astro`
      // renders an empty page. Measured on the scaffold fixture: the archived renders came back
      // with NO data-section-id at all, so gate-fidelity skipped with "its sections cannot be
      // identified" on a build that had done everything right. A board is an Explore-mode
      // artefact; building it in production mode is building something else.
      execFileSync(bin, ["build"], {
        cwd: projectDir,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, PUBLIC_EXPLORE_MODE: "true" },
      });
    } catch (e) {
      die(`astro build failed, so there is nothing to render:\n${(e.stderr || "").toString().trim().split("\n").slice(-8).join("\n")}`);
    }
  }

  // The Vercel adapter writes the static output under dist/client; a bare build writes dist.
  const distRoot = ["dist/client", "dist"].map((d) => join(projectDir, d)).find((d) => existsSync(join(d, "index.html")));
  if (!distRoot) die(`no built site under ${join(projectDir, "dist")}. Build it, or drop --no-build.`);

  for (const b of boards) {
    const route = String(b.href).replace(/^\/+/, "").replace(/\/+$/, "");
    if (!existsSync(join(distRoot, route, "index.html")) && !existsSync(join(distRoot, `${route}.html`))) {
      die(`board ${b.id} is registered at ${b.href} and is missing from the build (${join(route, "index.html")}). Nothing rendered.`);
    }
  }

  let refs = [];
  if (refsPath) {
    const p = resolve(projectDir, refsPath);
    if (!existsSync(p)) die(`--refs ${refsPath} does not exist. The calibration row cannot be drawn.`);
    try { refs = JSON.parse(readFileSync(p, "utf8")); } catch (e) { die(`--refs ${refsPath} is not readable JSON: ${e.message}`); }
    if (!Array.isArray(refs) || !refs.length) die(`--refs ${refsPath} holds no references. The calibration row cannot be drawn.`);
    refs = refs.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const r of refs) {
      if (!r.slug || !r.name || !r.position || !r.why || !r.screenshot) {
        die(`a calibration reference is missing one of slug, name, position, why, screenshot (${JSON.stringify(r).slice(0, 120)}).`);
      }
      const img = resolve(dirname(p), r.screenshot);
      if (!existsSync(img)) die(`the calibration screenshot for ${r.slug} is missing (${r.screenshot}).`);
      r.__file = img;
    }
  }

  let playwright;
  try { playwright = engineRequire("playwright"); }
  catch {
    die(`playwright is not installed (${join(ENGINE, "setup.sh")}). The boards are UNRENDERED, not clean.`);
  }
  let sharp;
  try { sharp = engineRequire("sharp"); }
  catch {
    die(`sharp is not installed (${join(ENGINE, "setup.sh")}). Images cannot be brought under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB, so nothing was written.`);
  }

  // A FAILURE LEAVES NO SEED. Half a set handed to a client reads as the whole set, and the
  // board that failed is the one they never see and never ask about. die() clears it.
  rmSync(seedDir, { recursive: true, force: true });
  mkdirSync(seedDir, { recursive: true });
  mkdirSync(shotsDir, { recursive: true });
  const failSeed = die;

  const served = await serveOnFreePort(distRoot, port).catch((e) => {
    die(`could not serve the build on ports ${port} to ${port + 5} (${e.code || e.message}). Pass --port to move it.`);
  });
  const server = served.server;
  const base = `http://127.0.0.1:${served.port}`;
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: FRAME_WIDTH, height: HERO_HEIGHT }, deviceScaleFactor: 1 });

  const rendered = [];
  const lines = [];
  let imageSeq = 0;

  try {
    for (const b of boards) {
      const route = String(b.href).replace(/^\/+/, "").replace(/\/+$/, "");
      const page = await ctx.newPage();
      const res = await page.goto(`${base}/${route}/`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => null);
      if (!res || !res.ok()) failSeed(`board ${b.id} did not load at /${route}/ (${res ? res.status() : "no response"}). Nothing written.`);
      await page.waitForTimeout(400);
      const scrolled = await settle(page);

      // --- what the artboard is made of, read from the rendered page ---------------------
      const harvest = await page.evaluate(() => {
        const css = [];
        // A CROSS-ORIGIN SHEET THROWS ON cssRules and is not a sheet we can inline, but it is
        // also not a sheet we may lose: a Google Fonts link is the one external host the canvas
        // allows, and the head is never serialised, so it has to be carried explicitly.
        const imports = [];
        const droppedSheets = [];
        const FONT_SHEET = /^https:\/\/fonts\.googleapis\.com\//;
        const addImport = (href) => { if (href && !imports.includes(href)) imports.push(href); };

        /**
         * An @import's target is a STYLESHEET, never an image.
         *
         * Collected as a background it was fetched, handed to sharp and refused the whole seed,
         * and that is the form Google's embed dialog offers beside the link. Same-origin
         * imports are followed and inlined; a Google Fonts one is carried as an import; anything
         * else cross-origin is dropped and named.
         */
        const collect = (sheet, depth) => {
          let rules = null;
          try { rules = sheet.cssRules; }
          catch {
            if (sheet.href && FONT_SHEET.test(sheet.href)) addImport(sheet.href);
            else if (sheet.href) droppedSheets.push(sheet.href);
            return;
          }
          for (const rule of rules) {
            const isImport = typeof rule.href === "string" && /^@import\b/i.test(rule.cssText || "");
            if (!isImport) { css.push(rule.cssText); continue; }
            let abs = rule.href;
            try { abs = new URL(rule.href, document.baseURI).toString(); } catch { /* as written */ }
            if (FONT_SHEET.test(abs)) { addImport(abs); continue; }
            if (depth < 3 && rule.styleSheet) { collect(rule.styleSheet, depth + 1); continue; }
            droppedSheets.push(abs);
          }
        };
        for (const sheet of document.styleSheets) collect(sheet, 0);

        for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
          if (l.href && FONT_SHEET.test(l.href)) addImport(l.href);
        }
        const images = [];
        for (const img of document.images) {
          const src = img.currentSrc || img.src;
          if (src) images.push(src);
        }
        // A HERO PHOTOGRAPH IS USUALLY A BACKGROUND, not an <img>, and `rule.cssText`
        // serialises its URL absolute, so it survived into the artboard as a link to the local
        // build server. The canvas has no egress, so it renders blank, with no refusal.
        // PAIRS, not just absolutes. `rule.cssText` keeps a root-relative url as written
        // (`/img/hero.jpg`), so a rewrite keyed on the absolute form finds nothing and the
        // artboard keeps a path that resolves to nowhere inside the canvas. The raw text is
        // what has to be replaced; the absolute form is what has to be fetched.
        const backgroundPairs = [];
        const readUrls = (text) => {
          for (const m of String(text || "").matchAll(/url\((["']?)([^)"']+)\1\)/g)) {
            const u = m[2];
            if (!u || u.startsWith("data:")) continue;
            // A FRAGMENT IS NOT A FILE. `filter: url(#grain)`, `clip-path: url(#c)` and
            // `mask: url(#m)` name an element in this very document, and resolving one against
            // the base URI produced the board's own page URL: fetched, handed to sharp, and the
            // whole seed refused. SVG filter grain is the canonical technique and the bold
            // mandate names grain by name, so it lands on the bold rungs first.
            if (u.startsWith("#")) continue;
            if (/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(u)) continue;   // faces are inlineFonts' work
            let abs = u;
            try { abs = new URL(u, document.baseURI).toString(); } catch { continue; }
            if (!backgroundPairs.some((pr) => pr.raw === u && pr.abs === abs)) backgroundPairs.push({ raw: u, abs });
          }
        };
        for (const el of document.querySelectorAll("*")) readUrls(getComputedStyle(el).backgroundImage);
        readUrls(css.join("\n"));
        const scripts = [];
        for (const s of document.querySelectorAll("script")) {
          scripts.push({ src: s.src || null, text: s.src ? "" : s.textContent || "", motion: s.hasAttribute("data-palate-motion") });
        }
        return {
          css: css.join("\n"),
          imports,
          droppedSheets: [...new Set(droppedSheets)],
          images: [...new Set(images)],
          backgrounds: [...new Set(backgroundPairs.map((pr) => pr.abs))],
          backgroundPairs,
          scripts,
          height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        };
      });

      // --- fonts: self-hosted faces inlined, Google Fonts left as a link ------------------
      const { css, fonts } = await inlineFonts(harvest.css, ctx, base);

      // --- the shots: rendered markup for the uniqueness gate, a hero still for fidelity ---
      //
      // THE ARCHIVED RENDER CARRIES ITS OWN STYLESHEET. Saving the markup alone was tried and
      // it is worthless a few minutes later: the render links `/_astro/<hash>.css`, Compose
      // rebuilds the site, the hash changes and the old file is gone, so the archived board
      // renders UNSTYLED. gate-fidelity then measured a page with no palette and no type scale
      // and reported both as "could not be compared" on a build that had done everything right,
      // and gate-uniqueness compared two pages whose only visible style was inline. The render
      // is self-contained, so it means the same thing on the day it is read as on the day it
      // was taken.
      const boardShots = join(shotsDir, b.id);
      mkdirSync(boardShots, { recursive: true });
      const live = await page.content();
      writeFileSync(join(boardShots, "rendered.html"), selfContained(live, css));
      await page.screenshot({ path: join(boardShots, "hero.png"), fullPage: false });

      // --- images: written beside the artboard, bare filenames, under the ceiling --------
      // Both kinds in one loop, deliberately: an <img> and a `background-image` are the same
      // problem to a canvas with no network, and two loops is how one of them gets forgotten.
      //
      // THEY ARE NOT EQUALLY LOAD-BEARING, THOUGH. An <img> is on this board and a client will
      // see it break, so a fetch that fails is a refusal. A url() from the shared stylesheet may
      // belong to another page entirely, and refusing every board over an asset no board shows
      // reads as a broken image rather than as the harvest over-reaching. Those are DROPPED and
      // NAMED. The refusal an operator can act on stays exactly where it was: an image that
      // fetches, decodes, and still will not come under the ceiling.
      const imageMap = {};
      const droppedUrls = [];
      const sources = [
        ...harvest.images.map((url) => ({ url, required: true })),
        ...harvest.backgrounds.map((url) => ({ url, required: false })),
      ];
      for (const { url, required } of sources) {
        if (imageMap[url] || droppedUrls.some((d) => d.url === url)) continue;
        let buf = null;
        let hint = "";
        const inline = decodeDataUri(url);
        if (inline) {
          // AN INLINE DATA URI IS AN IMAGE, and it is right here. Handing one to Playwright's
          // request context threw "Request path contains unescaped characters" and aborted the
          // whole seed, so a board carrying a single inline icon had no canvas at all, with a
          // message that read as a broken image rather than an unsupported source.
          buf = inline.buffer;
          hint = inline.ext;
        } else {
          try {
            const r = await ctx.request.get(url);
            if (!r.ok()) throw new Error(`HTTP ${r.status()}`);
            buf = Buffer.from(await r.body());
          } catch (e) {
            if (required) failSeed(`board ${b.id}: could not read the image ${url} (${e.message}). Nothing written.`);
            droppedUrls.push({ url, why: e.message });
            continue;
          }
        }
        let out = buf;
        let ext = ".jpg";
        if (hint === ".svg" || /\.svg(\?|$)/i.test(url) || buf.slice(0, 200).toString("utf8").includes("<svg")) {
          // An SVG is already small and lossless; re-encoding it as a photograph would be worse
          // in every way. It travels as-is or it is too big, and too big is a failure.
          ext = ".svg";
          if (out.length > MAX_IMAGE_BYTES) {
            failSeed(`board ${b.id}: ${short(url)} is an SVG of ${Math.round(out.length / 1024)} KB and cannot be downsampled under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB. Nothing written.`);
          }
        } else {
          let fit = null;
          try {
            fit = await fitUnder(buf, sharp);
          } catch (e) {
            // NOT AN IMAGE AT ALL. A url() can name a stylesheet, a page or a font we did not
            // recognise, and sharp refusing to decode it says the harvest reached too far, not
            // that the board is broken.
            if (required) failSeed(`board ${b.id}: ${short(url)} could not be re-encoded (${e.message}). Nothing written.`);
            droppedUrls.push({ url, why: "not a decodable image" });
            continue;
          }
          if (!fit.ok) {
            failSeed(`board ${b.id}: ${short(url)} will not come under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB (smallest was ${Math.round(fit.buffer.length / 1024)} KB at ${fit.width}px wide, quality ${fit.quality}). Replace it with a smaller or less detailed source. Nothing written.`);
          }
          out = fit.buffer;
        }
        const name = `${b.id}-img${++imageSeq}${ext}`;
        writeFileSync(join(seedDir, name), out);
        imageMap[url] = name;
      }
      for (const d of droppedUrls) {
        lines.push(`  ${b.id}: dropped ${short(d.url)} (${d.why}); the rule that named it now reads none`);
      }
      // SAY WHEN THE SCROLL DID NOT GET THERE. A page whose own script fights the scroll leaves
      // its reveals unfired, and a board flattened in that state looks like a design decision.
      if (scrolled && scrolled.deepest + 40 < scrolled.end - 900) {
        lines.push(`  ${b.id}: the settling scroll reached ${scrolled.deepest}px of ${scrolled.end}px; anything a reveal holds below that is captured UNSEEN`);
      }
      for (const href of harvest.droppedSheets || []) {
        lines.push(`  ${b.id}: dropped the cross-origin stylesheet ${href}; only fonts.googleapis.com travels`);
      }

      // --- the motion script, when it is self-contained and small ------------------------
      let motionScript = "";
      for (const s of harvest.scripts) {
        let text = s.text;
        if (s.src) {
          if (!s.src.startsWith(base)) continue; // third-party never travels
          try {
            const r = await ctx.request.get(s.src);
            text = r.ok() ? await r.text() : "";
          } catch { text = ""; }
        }
        if (!text) continue;
        if (Buffer.byteLength(text) > MAX_SCRIPT_BYTES) continue;
        // A module whose dependency cannot be fetched is dead weight in a canvas with no
        // network, and it looks like motion that simply did not fire.
        if (/(^|\n)\s*(import|export)\s/.test(text)) continue;
        const looksLikeMotion = s.motion || /motion|reveal|scrollTrigger|lenis|gsap/i.test(text);
        if (!looksLikeMotion) continue;
        motionScript = text;
        break;
      }

      // --- flatten: computed styles inline, THEN bare filenames and no scripts -----------
      //
      // THE ORDER IS THE WHOLE THING. This used to strip `link` and only then read computed
      // styles, which removed the build's bundled stylesheet (Tailwind, globals.css and the
      // brand tokens it imports) and wrote the BROWSER'S defaults onto every element it had
      // styled: Times at 32px, no padding, an empty --brand-accent. The helmet still carried
      // the real rules and the inline values overrode them, so the shipped example arrived
      // unstyled on the one surface the client picks from. Flatten while the page is still
      // dressed; strip afterwards, when nothing else will read a computed value.
      await inlineComputedStyles(page, PROPERTY_LIST);

      const droppedAbs = new Set(droppedUrls.map((d) => d.url));
      await page.evaluate(({ map, dropped }) => {
        for (const img of document.images) {
          const src = img.currentSrc || img.src;
          if (map[src]) img.setAttribute("src", map[src]);
          // srcset and <source> would override the bare filename with a URL that does not
          // resolve inside the canvas, which renders as a broken image and nothing else.
          img.removeAttribute("srcset");
          img.removeAttribute("sizes");
          img.removeAttribute("loading");
        }
        // The same rewrite for every url() the page carries inline. The helmet copy is done in
        // Node, below, over the collected CSS.
        for (const el of document.querySelectorAll("[style]")) {
          const st = el.getAttribute("style");
          if (!st || !st.includes("url(")) continue;
          el.setAttribute("style", st.replace(/url\((["']?)([^)"']+)\1\)/g, (whole, q, u) => {
            if (!u || u.startsWith("data:") || u.startsWith("#")) return whole;
            let abs = u;
            try { abs = new URL(u, document.baseURI).toString(); } catch { /* leave it */ }
            // A url nothing could fetch is REMOVED rather than left pointing at a dead path:
            // inside the canvas the difference is a blank box versus a broken-image icon.
            if (dropped.includes(abs)) return "none";
            // SINGLE QUOTES, deliberately. This lands in a `style` ATTRIBUTE, and the
            // serialiser escapes a double quote there as &quot;, which is not a URL any more.
            return map[abs] ? `url('${map[abs]}')` : whole;
          }));
        }
        // THE DIRECTION PICKER IS OPERATOR SCAFFOLDING. It is a fixed pill linking to
        // /boards/bN, which 404s inside the canvas, and a client can select it and restyle it
        // as though it were part of the design. The SectionMark badges STAY: they are how a
        // client points at a section by name, and the seed README says so.
        for (const el of document.querySelectorAll(".ev-switcher, source, script, link, noscript, template")) el.remove();
      }, { map: imageMap, dropped: [...droppedAbs] });
      const bodyHtml = await page.evaluate(() => document.body.innerHTML);

      const file = `B${b.ambition}.dc.html`;
      const artboard = toArtboard({
        html: bodyHtml,
        css: rewriteUrls(css, imageMap, harvest.backgroundPairs, droppedAbs),
        fonts,
        imports: harvest.imports,
        script: motionScript,
        name: `${b.id} ${b.name}`,
      });
      writeFileSync(join(seedDir, file), artboard);

      // The card image /explore renders. Copied rather than linked so a `public/` that is
      // cleaned between builds cannot empty the page that coaches the client.
      const pub = join(projectDir, "public", "_explore");
      mkdirSync(pub, { recursive: true });
      copyFileSync(join(boardShots, "hero.png"), join(pub, `${b.id}.png`));

      /**
       * MEASURE THE ARTBOARD, NOT THE PAGE IT CAME FROM.
       *
       * The height used to be `document.documentElement.scrollHeight` read on the LIVE page,
       * before the flatten. The flatten re-lays the page out: on a real five-board seed the
       * artboards rendered 26 to 42px taller than the frames canvas.json declared, almost all
       * of it the system strip, whose grid resolves differently once its computed track sizes
       * are written as fixed values. A frame neither scales nor crops and `x-dc` carries
       * `overflow: hidden`, so every board lost its last few pixels with nothing reporting it.
       * On that set the difference fell inside the notes panel's bottom padding and cost
       * nothing visible, which is exactly why it would go unnoticed.
       *
       * Opened from the file rather than served: the artboard's images are bare filenames
       * beside it and its CSS is in its own helmet, so a `file://` load is the same layout the
       * canvas draws, and it needs no second server.
       */
      await page.goto(`file://${join(seedDir, file)}`, { waitUntil: "load", timeout: 30000 }).catch(() => null);
      await page.waitForTimeout(150);
      const drawn = await page.evaluate(() => {
        const dc = document.querySelector("x-dc");
        if (!dc) return null;
        return Math.ceil(Math.max(dc.getBoundingClientRect().height, dc.scrollHeight));
      });
      // A measurement that failed is not a reason to write a wrong number quietly: fall back to
      // the live height and say the frame may clip.
      const height = drawn || harvest.height;
      if (!drawn) {
        lines.push(`  ${b.id}: the artboard's own height could not be measured, so the frame is the live page's ${harvest.height}px and may clip`);
      }

      rendered.push({ ...b, file, height });
      lines.push(
        `  ${b.id} rung ${b.ambition} ${b.name}: ${file} ${Math.round(artboard.length / 1024)} KB, ` +
        `hero.png ${Math.round(statSync(join(boardShots, "hero.png")).size / 1024)} KB, ` +
        `${Object.keys(imageMap).length} image(s), ${motionScript ? "motion inlined" : "no motion script"}, ` +
        `${height}px tall`,
      );
      await page.close();
    }

    // --- the calibration row ------------------------------------------------------------
    for (const r of refs) {
      let buf = readFileSync(r.__file);
      if (buf.length > MAX_IMAGE_BYTES || !/\.jpe?g$/i.test(r.__file)) {
        const fit = await fitUnder(buf, sharp).catch((e) => {
          failSeed(`the calibration screenshot for ${r.slug} could not be re-encoded (${e.message}). Nothing written.`);
        });
        if (!fit.ok) {
          failSeed(`the calibration screenshot for ${r.slug} will not come under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB (smallest was ${Math.round(fit.buffer.length / 1024)} KB at ${fit.width}px wide, quality ${fit.quality}). Nothing written.`);
        }
        buf = fit.buffer;
      }
      const img = `ref${r.position}.jpg`;
      writeFileSync(join(seedDir, img), buf);
      // /explore serves the same capture, so the calibration row exists for every tool and
      // not only for the canvas. Copied rather than linked: a `public/` cleaned between
      // builds would otherwise empty the row that asks the question.
      const pubRefs = join(projectDir, "public", "_explore");
      mkdirSync(pubRefs, { recursive: true });
      writeFileSync(join(pubRefs, img), buf);
      writeFileSync(join(seedDir, `Ref${r.position}.dc.html`), refArtboard(r, img));
      lines.push(`  reference ${r.position} ${r.slug}: Ref${r.position}.dc.html, ${img} ${Math.round(buf.length / 1024)} KB`);
    }

    writeCanvasJson({ boards: rendered, refs, out: join(seedDir, "canvas.json") });
    writeFileSync(join(seedDir, "README.md"), seedReadme(rendered, refs));
    recordShown(projectDir, rendered);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  process.stdout.write(`boards-render: ${rendered.length} board(s)${refs.length ? ` and ${refs.length} calibration reference(s)` : ""} written to ${seedDir}\n`);
  for (const l of lines) process.stdout.write(`${l}\n`);
  process.stdout.write(`  canvas.json, README.md; hero stills in ${shotsDir} and public/_explore/\n`);
  seedToClear = null;
  process.exit(0);
}

/**
 * Walk IMAGE_LADDER until the encode fits, and report the smallest attempt when none does.
 *
 * Returns the smallest buffer either way, so the refusal can say what it managed rather than
 * only that it failed: "112 KB at 640px wide, quality 38" tells the operator the source is a
 * photograph that needs replacing, where "too big" sends them to change a setting.
 */
export async function fitUnder(buf, sharp, limit = MAX_IMAGE_BYTES) {
  let smallest = null;
  for (const step of IMAGE_LADDER) {
    const out = await sharp(buf).resize({ width: step.width, withoutEnlargement: true }).jpeg({ quality: step.quality }).toBuffer();
    if (out.length <= limit) return { ok: true, buffer: out, ...step };
    if (!smallest || out.length < smallest.buffer.length) smallest = { ok: false, buffer: out, ...step };
  }
  return smallest;
}

/**
 * Decode a `data:` image URL, base64 or percent-encoded, and name its extension from its type.
 *
 * Both forms are ordinary: Google's own icons ship as base64 and an inline SVG usually arrives
 * as `data:image/svg+xml;utf8,<svg ...>`. Returns null for anything that is not a data URL, so
 * the caller's fetch path is untouched.
 */
export function decodeDataUri(url) {
  const m = /^data:([^;,]*)((?:;[^,]*)*),([\s\S]*)$/i.exec(String(url || ""));
  if (!m) return null;
  const mime = (m[1] || "").toLowerCase();
  const isBase64 = /;base64/i.test(m[2] || "");
  let buffer;
  try {
    buffer = isBase64 ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  } catch {
    // A payload we cannot decode is not an image; let the caller drop or refuse it as usual.
    return null;
  }
  const EXT = {
    "image/svg+xml": ".svg", "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
    "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif",
  };
  return { buffer, ext: EXT[mime] || "" };
}

/** A data URL in a message is a wall of characters; the reader needs the shape, not the payload. */
function short(url) {
  const u = String(url || "");
  return u.startsWith("data:") ? `${u.slice(0, 40)}... (${u.length} chars, inline)` : u;
}

/**
 * Point every url() at the file written beside the artboard.
 *
 * The in-page pass covers inline styles; this covers the collected stylesheet, where a hero
 * photograph set by a class lives. Absolute already, because `rule.cssText` serialises them
 * that way, which is exactly why they had to be rewritten rather than left alone.
 */
export function rewriteUrls(css, map, pairs = [], dropped = new Set()) {
  // Keyed on the url AS WRITTEN, because that is what is in the text. The pairs carry the
  // absolute form the fetch loop used, which is the only thing `map` knows about.
  const byRaw = new Map();
  const goneRaw = new Set();
  for (const { raw, abs } of pairs) {
    if (map[abs]) byRaw.set(raw, map[abs]);
    else if (dropped.has(abs)) goneRaw.add(raw);
  }
  return String(css || "").replace(/url\((["']?)([^)"']+)\1\)/g, (whole, q, u) => {
    if (!u || u.startsWith("data:") || u.startsWith("#")) return whole;
    // A url nothing could fetch is REMOVED, not left pointing at a dead path: inside a canvas
    // with no egress that is a blank box rather than a broken-image icon, and `none` is valid
    // wherever a url() is (background-image, mask-image, border-image-source, content).
    if (goneRaw.has(u) || dropped.has(u)) return "none";
    const name = byRaw.get(u) || map[u];
    return name ? `url("${name}")` : whole;
  });
}

/**
 * Scroll the page through, then back to the top, so scroll-driven state has actually happened.
 *
 * A board captured at scroll 0 archives every reveal in its UNSEEN state: an
 * IntersectionObserver has never fired, so anything below the fold sits at opacity 0 or
 * translated, and that is what lands in the artboard and in the archived render. The inlined
 * motion script cannot rescue it either, because anything on GSAP is excluded by the
 * self-contained rule, and GSAP ships in the template. The bold rungs are the ones told to use
 * scroll-as-timeline, so they are the ones that would flatten with the strip, the section and
 * the notes invisible.
 *
 * IT CAPTURES ONE-SHOT REVEALS ONLY, and that is the whole of what it claims. An observer that
 * un-reveals on exit, or a GSAP scrub tied to scroll position, is back in its unseen state by
 * the time the page returns to the top. Those are captured as they are at scroll 0, and the
 * printed line below says how far the scroll actually reached so the operator can tell.
 */
async function settle(page) {
  const reached = await page.evaluate(async () => {
    const step = Math.max(200, Math.round(window.innerHeight * 0.8));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const end = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    let deepest = 0;
    // BEHAVIOR "instant", never a bare scrollTo(x, y). The scaffold's own globals.css sets
    // `scroll-behavior: smooth`, so a bare call ANIMATES, and a loop that retargets every
    // 120ms never arrives: measured on a 3,973px board it reached about a quarter of the way
    // down and came back, so the reveal below it stayed at opacity 0 and I6 was inert on any
    // page tall enough to need it. A site running Lenis has the same shape.
    for (let y = 0, n = 0; y < end() && n < 60; y += step, n++) {
      window.scrollTo({ top: y, behavior: "instant" });
      await wait(120);
      deepest = Math.max(deepest, window.scrollY);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    await wait(250);
    return { deepest, end: end() };
  });
  await page.waitForTimeout(200);
  return reached;
}

/**
 * Replace a page's linked stylesheets with the collected CSS, inline.
 *
 * The archived render has to outlive the build it came from, and an `/_astro/<hash>.css` link
 * does not: the next build renames it. Everything else about the markup is left exactly as the
 * browser produced it, because this file is also the uniqueness gate's evidence.
 */
export function selfContained(html, css) {
  const stripped = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, "");
  const style = `<style data-palate-archived-css="1">${css}</style>`;
  return stripped.includes("</head>")
    ? stripped.replace("</head>", `${style}</head>`)
    : `${style}${stripped}`;
}

/**
 * Self-hosted faces become data URIs.
 *
 * It does NOT handle Google Fonts, and the comment here used to claim it did: a
 * fonts.googleapis.com sheet is cross-origin, so its rules never reach `css` at all. The
 * harvest collects those hrefs separately and `toArtboard` emits them as @import lines, which
 * is the one external host the canvas allows.
 */
async function inlineFonts(css, ctx, base) {
  const urls = [...new Set([...css.matchAll(/url\((["']?)([^)"']+)\1\)/g)].map((m) => m[2]))]
    .filter((u) => /\.(woff2?|ttf|otf)(\?|$)/i.test(u));
  let out = css;
  for (const u of urls) {
    const abs = u.startsWith("http") ? u : new URL(u, base + "/").toString();
    if (!abs.startsWith(base)) continue;
    try {
      const r = await ctx.request.get(abs);
      if (!r.ok()) continue;
      const buf = Buffer.from(await r.body());
      const mime = /\.woff2(\?|$)/i.test(abs) ? "font/woff2" : /\.woff(\?|$)/i.test(abs) ? "font/woff" : "font/ttf";
      out = out.split(u).join(`data:${mime};base64,${buf.toString("base64")}`);
    } catch { /* a face we cannot read stays a URL, and the canvas falls back to the stack */ }
  }
  return { css: out, fonts: "" };
}

/** One calibration reference: the capture, the name, and why it sits where it does. */
function refArtboard(r, img) {
  const html =
    `<div style="width:${REF_WIDTH}px;height:${REF_HEIGHT}px;background:#ffffff;color:#111111;` +
    `font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;flex-direction:column">` +
    `<img src="${escapeHtml(img)}" alt="${escapeHtml(r.name)}" style="width:${REF_WIDTH}px;height:450px;object-fit:cover;object-position:top;display:block">` +
    `<div style="padding:16px 20px;display:flex;flex-direction:column;gap:6px">` +
    `<p style="margin:0;font-size:17px;font-weight:600;line-height:1.2">${escapeHtml(r.name)}</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.45;color:#5c5c5c">${escapeHtml(r.why)}</p>` +
    `</div></div>`;
  const head = [
    `x-dc{display:block;width:${REF_WIDTH}px;overflow:hidden}`,
    "body{margin:0}",
    "a{color:#111111;text-decoration:underline}",
    "a:hover{color:#444444}",
    "img{max-width:100%}",
  ].join("\n");
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<script src=\"./support.js\"></script></head><body>" +
    `<x-dc><helmet><style>${head}</style></helmet>${html}</x-dc></body></html>`
  );
}

function seedReadme(boards, refs) {
  const rows = boards.map((b) => `- \`${b.file}\` - rung ${b.ambition} of ${boards.length}, ${b.name} (${b.id}), ${FRAME_WIDTH} by ${b.height}`);
  const refRows = refs.map((r) => `- \`Ref${r.position}.dc.html\` - ${r.name} (${r.slug}), ${REF_WIDTH} by ${REF_HEIGHT}`);
  return [
    "# Explore canvas seed",
    "",
    `Seed this directory as the canvas. Title it **Directions to choose from**.`,
    "",
    "## Artboards",
    ...(refRows.length ? ["", "Row 0, the calibration references:", ...refRows] : []),
    "",
    "Row 1, the ladder in order, restrained to bold:",
    ...rows,
    "",
    "## Files",
    "",
    "- `canvas.json` - the layout, the annotations and the launch view.",
    "- the `.jpg` / `.svg` files beside each artboard are its images, referenced by bare filename.",
    "",
    "The first artboard is `B1.dc.html`, not `Main.dc.html`. The canvas helper looks for a file",
    "of that name as the entry point and WARNS when it does not find one; the seed opens and",
    "works regardless, because `canvas.json` names the launch view. The warning is expected and",
    "is not a fault in the seed. The names are the rungs on purpose: `B1` through `BN` is what",
    "the client and the picker both call them.",
    "",
    "## The small labels in the corners",
    "",
    "Each section carries a short badge naming it (`b1-hero`, `b1-services`). They are pointing",
    "aids, so the client can say \"the b3 hero\" instead of \"the big one on the third board\", and",
    "they are not part of the design. Ignore them, or delete them on the canvas if they get in",
    "the way: nothing downstream reads them from here. The direction picker is NOT on the",
    "artboards, because its links go nowhere inside the canvas.",
    "",
    "The canvas is not the source of truth. Anything the client changes on it is feedback, read",
    "back with `palate-pick.mjs --canvas <extract-dir>` and honoured at Compose.",
    "",
  ].join("\n");
}

/**
 * Record what was shown and WHEN.
 *
 * `shown_at` is half of the only number this stage has ever been able to report: time to pick
 * is `picked_at - shown_at`, and without a stamp written at the moment of showing there is
 * nothing to subtract from. Written through manifest-merge so a concurrent hook write cannot
 * lose it.
 */
function recordShown(projectDir, boards) {
  const merge = join(HERE, "manifest-merge.mjs");
  const manifest = join(projectDir, "build-manifest.json");
  if (!existsSync(manifest) || !existsSync(merge)) return;
  const patch = {
    explore: {
      ran: true,
      shown_at: new Date().toISOString(),
      boards: boards.map((b) => ({ id: b.id, rung: b.ambition, donor: b.donor })),
    },
  };
  try {
    execFileSync(process.execPath, [merge, "--manifest", manifest, "--set", JSON.stringify(patch)], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch { /* the manifest is a record, never a gate on rendering */ }
}

/**
 * ONLY AS A CLI. The helpers above are imported by the test suite and by gate-fidelity, and a
 * module that runs its own main() on import turns `import { PROPERTY_LIST }` into a build.
 *
 * The entry-point test lives in `lib/invoked-directly.mjs` and is shared with every other CLI
 * in the plugin. It was this file that proved it has to compare REAL paths: through `/tmp`,
 * which macOS symlinks to `/private/tmp`, the guard was false, `main()` never ran, and the
 * script printed nothing and exited 0. That copy is gone rather than kept beside the shared
 * one, because two implementations of "am I the entry point" is how the tree ended up with
 * three wrong ones.
 */
if (invokedDirectly(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`boards-render: ${e && e.stack ? e.stack : e}\n`);
    process.exit(2);
  });
}
