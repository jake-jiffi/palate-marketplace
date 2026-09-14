#!/usr/bin/env node
/**
 * scripts/boards-render.mjs - validate, key, measure and archive the hand-drawn artboards.
 *
 * ========================== WHAT IT IS FOR ==========================
 *
 * Explore no longer builds anything. Each direction is a hand-authored Claude Design artboard
 * at `.palate/explore/seed/B<rung>.dc.html`: the WHOLE home page in that direction, navigation
 * to footer, composed from the website kit, with the planned motion written on it as text
 * because a still cannot show motion. Astro is written ONCE, at Compose, for the direction the
 * client picks.
 *
 * So this script's job changed from harvesting a rendered page into an artboard to holding the
 * artboards to the contract and measuring them:
 *
 *   1. every registered board has a file, and that file meets the canvas authoring contract,
 *   2. every element gets a stable `data-palate-k`, written back INTO the seed file so the
 *      published canvas and the archived copy align when `palate-pick.mjs --canvas` reads the
 *      client's edits back,
 *   3. the artboard is archived as `shots/<id>/rendered.html`, byte-identical to the seed,
 *   4. it is opened over `file://` at 1440 wide, measured (a frame neither scales nor crops, so
 *      a declared height that is wrong clips the bottom off a board with nothing reporting it)
 *      and shot for `/explore` and the fidelity gate.
 *
 * ================== WHAT IT REFUSES TO DO =========================
 *
 * There is NO network inside the canvas, so anything that cannot be resolved beside the
 * artboard is a refusal rather than a silently broken frame: a remote image, an image over
 * 70 KB, a stylesheet from anywhere but Google Fonts, a second `<script>`. It also refuses an
 * artboard that is not a whole page (no navigation, hero, cta or footer mark), one with no
 * written motion, and one whose blocks carry no classes, because the uniqueness gate signs
 * structure by class and an artboard styled only inline signs it blind.
 *
 * A REFUSAL NEVER DELETES THE SEED. The seed is the operator's own drawing work now, not this
 * script's output, and the old behaviour (wipe the directory so a stale set cannot be handed to
 * a client) would throw away hours of authoring over one bad image.
 *
 * Usage:
 *   node scripts/boards-render.mjs <projectDir> [--out .palate/explore]
 *                                  [--refs .palate/explore/refs.json]
 *                                  [--donors .palate/explore/donor-heroes.json | --no-donors]
 * Exit: 0 validated and measured, 2 could not (with the reason and the board named).
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, statSync, copyFileSync, rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { invokedDirectly } from "./lib/invoked-directly.mjs";
import { refuseLegacy } from "./lib/workflow-route.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "reference-capture");
// playwright and sharp live with the capture engine, exactly as verify-rendered and
// palate-assets resolve them. No new dependency, and one runtime to install.
const engineRequire = createRequire(new URL("./reference-capture/", import.meta.url));

/**
 * The properties the canvas property panel edits.
 *
 * Nothing here flattens a page into inline styles any more (there is no page: the artboard IS
 * the drawing), so this list no longer drives a pass in this file. It stays exported because it
 * is the published statement of what a viewer can change on the canvas, and the authoring
 * doctrine points at it when it says which properties to set inline on an artboard.
 */
export const PROPERTY_LIST = [
  "color", "background-color", "font-family", "font-size", "font-weight",
  "line-height", "letter-spacing", "padding", "margin", "border-radius", "gap",
  "display", "flex-direction", "align-items", "justify-content", "grid-template-columns",
];

const MAX_IMAGE_BYTES = 70 * 1024;
/**
 * The ceiling on a donor's WHOLE-PAGE capture, which is judge evidence and never a frame.
 *
 * The 70 KB canvas ceiling exists because a canvas has no egress and every frame is downloaded
 * by the person opening it. This file is opened by one subagent from local disk, so squeezing it
 * would only throw away the detail the page-ending comparison is about. The cap is here to stop
 * a pathological object filling a build directory, not to fit a canvas.
 *
 * SIXTEEN MEGABYTES BECAUSE THE LIBRARY WAS MEASURED. A sample of twelve references' own
 * `full.png` objects ran from 0.79 MB (anthropic) to 6.63 MB (stripe), with eight over 1.5 MB,
 * so the first ceiling would have dropped the page ending on most real ladders: the surface this
 * whole comparison exists to add, refused for being the size a full-page capture is.
 */
const MAX_DONOR_FULL_BYTES = 16 * 1024 * 1024;
/**
 * And its own clock. Ten seconds is right for the hero, a single frame an operator is waiting
 * on; a multi-megabyte capture on an ordinary link needs longer, and timing it out would record
 * "the library has no capture" about a link, which is a false thing to tell the next reader.
 */
const DONOR_FULL_TIMEOUT_MS = 30_000;
/**
 * The ladder a calibration screenshot is walked down to reach the ceiling: width first, then
 * quality.
 *
 * Quality alone was tried and it does not get there on a photographic capture. A 1440-wide
 * capture at quality 32 is both over the ceiling and ugly, where the same picture at 1000 wide
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
const FRAME_WIDTH = 1440;
const HERO_HEIGHT = 900;
const REF_WIDTH = 720;
const REF_HEIGHT = 580;
const ROW_GAP = 120;
const FRAME_GAP = 80;
/** The phone. A board drawn at any other width is a desktop board captioned "mobile". */
const MOBILE_WIDTH = 390;
/**
 * The columns every direction's row reads down.
 *
 * They are constants rather than a running offset because the point of a row is COMPARISON: a
 * client scanning two directions compares home with home and phone with phone, and a row whose
 * inner page slides left because that direction had no donor cannot be read against the row
 * above it.
 */
const COLUMNS = {
  board: 0,
  donor: FRAME_WIDTH + FRAME_GAP,                                       // 1520
  inner: FRAME_WIDTH + FRAME_GAP + REF_WIDTH + FRAME_GAP,               // 2320
  mobile: (FRAME_WIDTH + FRAME_GAP) * 2 + REF_WIDTH + FRAME_GAP,        // 3840
  sheet: (FRAME_WIDTH + FRAME_GAP) * 2 + REF_WIDTH + FRAME_GAP + MOBILE_WIDTH + FRAME_GAP, // 4310
};
/** Under this much visible copy, a sheet is a type specimen rather than the pieces as used. */
const SHEET_MIN_TEXT = 120;

/** The image types the canvas resolves from a bare filename beside the artboard. */
const IMG_OK = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
/** The only external origins the canvas will fetch: Google's stylesheet host and its font host. */
const GOOGLE_FONTS = /^(https?:)?\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/i;
/** The tags whose role a class has to name, so the uniqueness gate can read the structure. */
const BLOCK_TAGS = /^(section|div|header|footer|main|nav|article|aside|ul|ol|li|figure|h[1-6]|p|table|form)$/i;

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
// Only these flags take a value, so a positional is anything not a flag and not one of their
// values. `--port` is obsolete (nothing is served any more) and stays in the list ONLY so an
// old invocation does not read the port number as the project directory.
const VALUE_FLAGS = new Set(["--out", "--refs", "--donors", "--port"]);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) { if (VALUE_FLAGS.has(args[i])) i++; continue; }
  positional.push(args[i]);
}

/**
 * A refusal names the fault and leaves everything on disk.
 *
 * This used to remove the seed directory, on the argument that a seed which does not match the
 * registry must not exist. That was right when the seed was this script's own output and
 * regenerating it cost a minute. The seed is now the operator's hand-drawn artboards, so
 * deleting it over one oversized image would destroy the work rather than protect the client.
 */
function die(reason) {
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
  return objects(body).map((full) => {
    /**
     * THE NESTED PROVENANCE IS READ FIRST AND THEN CUT OUT.
     *
     * `pieces` carries a `donor:` per entry, and `field()` takes the first match anywhere in the
     * object, so an entry whose `pieces` sits above its own `donor:` line reports the
     * navigation's reference as the DIRECTION's. Every check about donors downstream (one
     * distinct donor per direction, the judge's pairing) would then be about the wrong slug,
     * and nothing would say so.
     */
    const { pieces, rest: o } = splitPieces(full);
    return {
    id: field(o, "id"),
    name: field(o, "name"),
    // The board IS this file. `href` is deprecated and kept only so an old registry parses.
    artboard: field(o, "artboard"),
    href: field(o, "href"),
    ambition: field(o, "ambition"),
    what: field(o, "what"),
    why: field(o, "why"),
    feeling: field(o, "feeling"),
    donor: field(o, "donor"),
    section: field(o, "section"),
    motion: field(o, "motion"),
    clip: field(o, "clip"),
    /**
     * THE OTHER THREE BOARDS OF THE DIRECTION. A direction is the home page, the inner page the
     * primary action lands on, the same home at 390, and the sheet of the kit pieces as used.
     * Null when the registry never declared them, which is a refusal rather than something to
     * derive from the rung: a derived name means a registry that declared nothing still passes
     * while the client is shown one board out of four.
     */
    presentation: presentationOf(o),
    /**
     * THE PER-PIECE PROVENANCE. Which kit variation this direction used for its navigation,
     * hero, closing band, enquiry form, footer and its own inner section, and the reference
     * each of those came from. It is what the detail sheet's captions print, and it is the
     * only place a client ever reads where a piece's craft came from. Null when the registry
     * declared none, which gate-explore refuses; nothing is derived from a board that
     * declared nothing.
     */
    pieces,
    };
  }).filter((v) => v.id);
}

/**
 * `pieces: { navigation: { variation, donor }, ... }` as a plain object, and the rest of the
 * entry with that block CUT OUT.
 *
 * Both halves matter. `pieces` carries a `donor:` per entry and `field()` takes the first match
 * anywhere in the object, so whoever reads the entry's own `donor` has to read it from the rest.
 * Exported because gate-explore holds the same block against the kit manifest, and two parsers
 * reading one file differently is how a check passes on one surface and fails on the other.
 */
export function splitPieces(obj) {
  const body = blockAfterKey(obj, "pieces", "{", "}");
  if (!body) return { pieces: null, rest: obj };
  const rest = obj.replace(body, "");
  const out = {};
  for (const m of body.matchAll(/([A-Za-z_][\w-]*)\s*:\s*\{/g)) {
    const inner = blockAfterKey(body.slice(m.index), m[1], "{", "}");
    if (!inner) continue;
    const variation = field(inner, "variation");
    const donor = field(inner, "donor");
    out[m[1]] = { variation: typeof variation === "string" ? variation : null, donor: typeof donor === "string" ? donor : null };
  }
  return { pieces: Object.keys(out).length ? out : null, rest };
}

export function presentationOf(obj) {
  const body = blockAfterKey(obj, "presentation", "{", "}");
  if (!body) return null;
  const inner = field(body, "inner");
  const mobile = field(body, "mobile");
  const sheet = field(body, "sheet");
  return inner || mobile || sheet ? { inner, mobile, sheet } : null;
}

/**
 * The body of the `[...]` or `{...}` that follows a key, brace-matched and string-aware.
 *
 * The registry and the kit manifest are TypeScript, so nothing here can be read with one regex:
 * a variation's `needs: [...]` sits inside the array this is looking for the end of, and a
 * `when:` string can carry a brace. Same string handling as `arrayBody`, for the same reason.
 */
function blockAfterKey(src, key, open, close) {
  const m = new RegExp(`\\b${key}\\s*:\\s*\\${open}`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  const start = i;
  let depth = 1;
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
    if (c === open) depth++;
    else if (c === close) depth--;
    i++;
  }
  return depth === 0 ? src.slice(start, i - 1) : null;
}

/**
 * The kit manifest, read as `piece id -> the variation ids that belong to it`.
 *
 * The detail sheet marks every block `data-kit-piece="<piece>:<Variation>:<state>"`, and the
 * whole value of that mark is that it names something that EXISTS: a sheet showing a navigation
 * variation the kit does not carry is a promise the build cannot keep, and the client signs it
 * off. So the mark is checked against `src/lib/kit.ts` itself rather than against a list kept
 * here, which would be a second copy of the manifest drifting from the first.
 *
 * Exported because gate-explore checks the registry's own per-piece provenance against the same
 * manifest, and two parsers reading one file differently is how a check passes on one surface
 * and fails on the other.
 *
 * The inner value is a Map of variation id to the STATES that variation declares. It answers
 * `.has(variation)` exactly as a Set does, and it also answers "does this piece build that
 * state", which the detail sheet needs: a sheet claiming a state the kit cannot render is the
 * same broken promise as one naming a variation that does not exist. `default` is in nobody's
 * list, because it is the resting state every variation has.
 */
export function parseKitVariations(src) {
  const out = new Map();
  const body = arrayBody(stripComments(String(src || "")), "kit");
  if (!body) return out;
  for (const piece of objects(body)) {
    const id = field(piece, "id");
    if (!id) continue;
    const variations = new Map();
    const block = blockAfterKey(piece, "variations", "[", "]");
    if (block) {
      for (const v of objects(block)) {
        const vid = field(v, "id");
        if (!vid) continue;
        const states = blockAfterKey(v, "states", "[", "]") || "";
        variations.set(vid, new Set([...states.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]).filter(Boolean)));
      }
    }
    out.set(id, variations);
  }
  return out;
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
 * Hold one artboard to the canvas authoring contract, and name EVERY fault in one pass.
 *
 * It reports a list rather than the first problem because an operator redrawing a board wants
 * the whole set of corrections, not six runs. Pure string work, no DOM: this has to be callable
 * from a test and from the gates without a browser.
 *
 * The faults it exists to catch are the ones a canvas reports as nothing at all: a skeleton the
 * editor does not recognise silently stops the board being editable; a remote image renders as
 * a broken box; a board that is only a hero and one section looks like a direction until the
 * client asks what the footer does.
 */
/**
 * THE FOUR KINDS OF BOARD A DIRECTION IS MADE OF.
 *
 * The shared rules (skeleton, one script, images, links, class ratio, a:hover) are the same for
 * all four, because they are about what a canvas can render. Three things differ, and each is a
 * fault a canvas reports as nothing at all:
 *
 *   `width`  a frame neither scales nor crops, so a mobile board drawn at 1440 is a second
 *            desktop board that the client signs off as the phone;
 *   `prefix` the inner page's marks are `<id>-inner-<piece>`, so the fidelity gate can tell the
 *            inner entrance from the home one; the sheet has no section marks at all and is
 *            checked on its `data-kit-piece` blocks instead (`prefix: null`);
 *   `motion` the motion plan belongs to the home board. Repeating it on the phone and the sheet
 *            would be three copies of one plan, drifting.
 */
const KINDS = {
  home: { width: FRAME_WIDTH, prefix: "", motion: true, label: "home board" },
  inner: { width: FRAME_WIDTH, prefix: "inner-", motion: false, label: "inner page" },
  mobile: { width: MOBILE_WIDTH, prefix: "", motion: false, label: "mobile board" },
  sheet: { width: FRAME_WIDTH, prefix: null, motion: false, label: "detail sheet" },
};

/**
 * The blocks the detail sheet owes, whatever variation the direction chose.
 *
 * These eight are what a client is actually signing off: how the navigation looks closed AND
 * open, what the footer carries, how the closing band asks, how the enquiry form looks filled
 * AND wrong, one card, one trust strip. A sheet of entrances proves none of it, which is the
 * failure this list exists to stop.
 */
const SHEET_REQUIRED = [
  { pieces: ["navigation"], state: "default", say: "navigation:<Variation>:default, the bar at rest" },
  { pieces: ["navigation"], state: "open", say: "navigation:<Variation>:open, the menu open" },
  { pieces: ["footer"], state: "default", say: "footer:<Variation>:default" },
  { pieces: ["cta"], state: "default", say: "cta:<Variation>:default, the closing band" },
  { pieces: ["forms"], state: "default", say: "forms:<Variation>:default, the enquiry form filled in" },
  { pieces: ["forms"], state: "error", say: "forms:<Variation>:error, the same form with its errors shown" },
  { pieces: ["benefits", "usecases", "casestudies"], state: "default", say: "one card, from benefits, usecases or casestudies, at :default" },
  { pieces: ["trust"], state: "default", say: "trust:<Variation>:default, the trust strip" },
];

/**
 * The detail sheet's own contract: real kit pieces, in real variations, carrying real copy.
 *
 * Exported so the sheet can be held to this without the rest of the artboard rules, which is
 * what a caller wants when it is checking a sheet it did not read off disk.
 */
export function validateSheet(html, { id, kit } = {}) {
  const problems = [];
  if (!kit || !kit.size) {
    problems.push("the kit manifest (src/lib/kit.ts) could not be read, so no data-kit-piece mark on this sheet could be checked against a piece that exists");
    return { ok: false, problems };
  }

  /**
   * ONE MARK PER TAG. A second `data-kit-piece` on the same element is invisible: a reader takes
   * the first, so the block is filed as one piece while its markup claims two, and the required
   * block the second one named goes missing on a sheet that appears to carry it.
   */
  for (const tag of String(html).matchAll(/<[a-zA-Z][\w-]*((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const on = [...tag[1].matchAll(/\bdata-kit-piece="([^"]*)"/g)].map((m) => m[1]);
    if (on.length > 1) {
      problems.push(`one tag carries two data-kit-piece attributes (${on.join(" and ")}); a block is one piece, and only the first of them is ever read`);
    }
  }

  const marks = [...String(html).matchAll(/\bdata-kit-piece="([^"]*)"/g)].map((m) => m[1]);
  if (!marks.length) {
    problems.push(`the detail sheet carries no data-kit-piece blocks; every block on it is marked data-kit-piece="<piece>:<Variation>:<state>" so the sheet names the pieces the direction actually uses`);
  }
  const present = new Set();
  for (const raw of marks) {
    const parts = raw.split(":").map((s) => s.trim());
    if (parts.length !== 3 || parts.some((s) => !s)) {
      problems.push(`data-kit-piece="${raw}" is not <piece>:<Variation>:<state>, e.g. navigation:NavSimple:default`);
      continue;
    }
    const [piece, variation, state] = parts;
    if (!kit.has(piece)) {
      problems.push(`data-kit-piece="${raw}" names the piece "${piece}", which src/lib/kit.ts does not carry; the sheet shows the pieces the site is composed from, so a piece that does not exist is a promise the build cannot keep`);
      continue;
    }
    if (!kit.get(piece).has(variation)) {
      problems.push(`data-kit-piece="${raw}" names the variation "${variation}", which is not one of ${piece}'s in src/lib/kit.ts (${[...kit.get(piece).keys()].join(", ") || "none"})`);
      continue;
    }
    /**
     * AND THE STATE IS ONE THE PIECE ACTUALLY BUILDS.
     *
     * `default` is the resting state: every variation has it and none declares it, so it is
     * allowed everywhere. Anything else has to be in the variation's own `states`, because a
     * sheet showing a form error the kit cannot render is the same broken promise as a sheet
     * showing a variation that does not exist, and the client signs off both.
     */
    const states = kit.get(piece).get(variation);
    if (state !== "default" && states && !states.has(state)) {
      problems.push(`data-kit-piece="${raw}" claims the state "${state}", which ${variation} does not implement in src/lib/kit.ts (it builds ${[...states].join(", ") || "no state beyond default"})`);
      continue;
    }
    present.add(`${piece}:${state}`);
  }

  for (const need of SHEET_REQUIRED) {
    if (!need.pieces.some((p) => present.has(`${p}:${need.state}`))) {
      problems.push(`the detail sheet has no ${need.say}; without it the client signs off a direction whose ${need.pieces.join(" or ")} in that state nobody has drawn`);
    }
  }

  /**
   * AND IT IS THE PIECES AS USED, NEVER A TYPE SPECIMEN.
   *
   * Jake rejected exactly this on 9 September: half of every board was an Ag ramp, swatches and
   * a button pair, identical in layout across every direction, with the type DISPLAYED rather
   * than used. A sheet of correctly marked blocks with nothing written in them is that board
   * again in different markup, and every other rule here passes it.
   */
  const text = visibleText(html);
  if (text.length < SHEET_MIN_TEXT) {
    problems.push(`the detail sheet carries ${text.length} characters of visible copy, under the ${SHEET_MIN_TEXT} the rule asks for: it reads as a type specimen (a ramp, swatches, a button pair) rather than the pieces as used. Write the real copy, in the brand's voice, into every block`);
  }
  return { ok: problems.length === 0, problems };
}

/** What a reader sees: style, script and comments removed, tags stripped, whitespace collapsed. */
function visibleText(html) {
  return String(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Void elements, which never carry a subtree: a mark on one has no caption under it and the
 * scan must not run off looking for a closing tag that cannot exist.
 */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** Every `data-kit-piece` block on a sheet, with the visible text INSIDE that block. */
function kitBlocks(html) {
  const s = String(html);
  const out = [];
  const tagRe = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = tagRe.exec(s))) {
    const mark = /\bdata-kit-piece="([^"]*)"/.exec(m[2]);
    if (!mark) continue;
    const name = m[1].toLowerCase();
    const closed = VOID_TAGS.has(name) || /\/\s*$/.test(m[2]);
    const [piece, variation, state] = mark[1].split(":").map((x) => x.trim());
    out.push({ raw: mark[1], piece, variation, state, text: closed ? "" : visibleText(elementBody(s, name, tagRe.lastIndex)) });
  }
  return out;
}

/** The markup between an open tag and its own close, nesting counted. */
function elementBody(s, name, from) {
  const re = new RegExp(`<(/?)${name}\\b((?:"[^"]*"|'[^']*'|[^>"'])*)>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) {
      depth--;
      if (!depth) return s.slice(from, m.index);
    } else if (!/\/\s*$/.test(m[2])) depth++;
  }
  return s.slice(from);
}

/**
 * THE SHEET SAYS WHERE EACH PIECE CAME FROM, IN WORDS A CLIENT READS.
 *
 * The registry records each piece's kit variation and its donor, and the detail sheet is the one
 * artefact where a person ever sees that: "Navigation: NavSimple, drawn from aesop". A block with
 * no such line looks finished and proves nothing, and once the direction is signed off nobody can
 * say afterwards which reference the navigation's craft came from.
 *
 * The caption is checked INSIDE the block, never across the sheet, because a donor named once in
 * the heading at the top would otherwise satisfy every block below it, which is the sheet that
 * carries no provenance at all.
 *
 * It reads the BLOCK's own variation rather than the registry's, on purpose: the navigation
 * legitimately appears twice on a sheet, the bar at rest and the drawer on a phone, and those are
 * two different kit variations. What the registry owns is the DONOR, and gate-explore's check 10
 * is what holds the sheet's variations to the registry's.
 *
 * THE DONOR IS FOUND BY THE VARIATION FIRST, and only then by the piece id. The card the sheet
 * owes is registered under the direction's own `section` key, which is free text ("services"),
 * so a lookup by piece id finds nothing for `benefits:BenefitCards:default` and the two blocks
 * that carry the most invented copy, the card and the trust strip, would be the two nobody
 * checked. Matching the variation resolves `BenefitCards` to whichever key registered it.
 *
 * Silent when the registry declared no `pieces`: gate-explore owns that absence, and reporting it
 * here in different words would make one fault read as two on every direction.
 */
export function validateSheetCaptions(html, { id, pieces } = {}) {
  const problems = [];
  if (!pieces || !Object.keys(pieces).length) return { ok: true, problems };
  const blocks = kitBlocks(html);
  /** The registry entry that owns a block: by the variation it shows, else by its piece id. */
  const provFor = (b) =>
    Object.values(pieces).find((p) => p && p.variation && b.variation && p.variation === b.variation)
    || pieces[b.piece];
  for (const need of SHEET_REQUIRED) {
    for (const piece of need.pieces) {
      for (const b of blocks.filter((x) => x.piece === piece && x.state === need.state)) {
        const prov = provFor(b);
        if (!prov || !prov.donor) continue;
        const text = b.text.toLowerCase();
        const missing = [];
        if (b.variation && !text.includes(b.variation.toLowerCase())) missing.push(`the kit variation it is (${b.variation})`);
        if (!text.includes(prov.donor.toLowerCase())) missing.push(`the reference it was drawn from (${prov.donor})`);
        if (missing.length) {
          problems.push(
            `the block marked data-kit-piece="${b.raw}"${id ? ` on ${id}` : ""} does not name ${missing.join(" or ")}. ` +
            `Write the provenance into the block itself, e.g. "${piece[0].toUpperCase()}${piece.slice(1)}: ${b.variation || prov.variation}, drawn from ${prov.donor}". ` +
            "The sheet is the only place a client reads where a piece's craft came from.",
          );
        }
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

export function validateArtboard(html, { id, section, dir, kind = "home", kit = null }) {
  const problems = [];
  const spec = KINDS[kind];
  if (!spec) {
    return { ok: false, problems: [`${kind} is not a kind of board; the four are ${Object.keys(KINDS).join(", ")}`] };
  }
  const head = html.replace(/\s+/g, " ").replace(/> </g, "><").trim();
  if (!/^<!doctype html><html><head><meta charset="utf-8"><script src="\.\/support\.js"><\/script><\/head><body><x-dc><helmet><style>/i.test(head)) {
    problems.push('the skeleton must be exactly <!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style>...; the editor replaces support.js at render time and a different spelling silently breaks editing');
  }
  /**
   * THE FRAME IS 1440 WIDE, AND THAT IS A CONTRACT RATHER THAN A CONVENTION.
   *
   * A canvas frame neither scales nor crops, so a board drawn at 1280 or at 100% sits in a
   * gutter beside every other rung, or is cut off, while every other check on it passes. The
   * doctrine has said 1440 since the format existed and nothing held a board to it.
   *
   * It reads the rule, not its spelling: `x-dc { width: 1440px }` across four lines is a
   * correct board and refusing it would be refusing correctness.
   */
  const helmet = /<helmet>\s*<style>([\s\S]*?)<\/style>/i.exec(html);
  const helmetStyle = helmet ? helmet[1] : "";
  if (!new RegExp(`(^|[};\\s])x-dc\\s*\\{[^}]*\\bwidth\\s*:\\s*${spec.width}px`, "i").test(helmetStyle)) {
    problems.push(`the frame must be ${spec.width} wide: <helmet><style> needs an x-dc{display:block;width:${spec.width}px;overflow:hidden} rule. A canvas frame neither scales nor crops, so a board at any other width is cropped or sits in a gutter beside the boards next to it`);
  }

  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  if (scripts.length !== 1 || !/src="\.\/support\.js"/.test(scripts[0])) {
    problems.push(`exactly one <script> is allowed, ./support.js; found ${scripts.length}`);
  }

  /**
   * EVERY MARKED ROOT IS A SECTIONING ELEMENT, and that is a downstream contract rather than
   * taste. `gate-fidelity.mjs` scopes its whole comparison to the marked hero and hides
   * everything else, and its scaffolding sweep is written in terms of the tag. A `<div>`
   * carrying the mark measured as nothing at all, and the skeleton comparison that tells a
   * lifted hero from a rebuilt one silently stopped running. Refused here, where a board is
   * still being drawn, rather than at Compose, where it reads as a passing gate.
   */
  const marked = [...html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\bdata-section-id="([^"]+)"/g)];
  for (const [, tag, sid] of marked) {
    const t = tag.toLowerCase();
    if (t !== "section" && t !== "header" && t !== "footer") {
      problems.push(`data-section-id="${sid}" sits on a <${t}>; a marked root must be a <section>, <header> or <footer>, because the fidelity gate scopes its comparison to that element and measures nothing at all when it is a <${t}>`);
    }
  }
  const ids = [...html.matchAll(/data-section-id="([^"]+)"/g)].map((m) => m[1]);
  // A board is the WHOLE page in that direction, nav to footer, composed from the kit's pieces.
  // The sheet is the one exception: it is the pieces themselves, so it carries no page marks and
  // is held to its own contract below.
  if (spec.prefix !== null) {
    for (const piece of ["navigation", "hero", "cta", "footer"]) {
      if (!ids.includes(`${id}-${spec.prefix}${piece}`)) {
        problems.push(`no element carries data-section-id="${id}-${spec.prefix}${piece}"; the ${spec.label} is the whole page (navigation, hero, the inner sections, cta, footer), composed from the kit, never a hero plus one section`);
      }
    }
  }
  // The registry's `section` is the HOME board's inner section: it is what the client picks the
  // home page on. The inner page shows the service, and the phone shows the home stacked.
  if (kind === "home" && section && !ids.includes(`${id}-${section}`)) {
    problems.push(`no element carries data-section-id="${id}-${section}"; the registry says this board shows "${section}"`);
  }

  // The motion is written ON the board: a still cannot show it, and a side panel is not where
  // the client is looking when they judge the direction.
  if (spec.motion) {
    const motion = html.match(/<([a-z][a-z0-9]*)\b[^>]*\bdata-palate-motion\b[^>]*>([\s\S]*?)<\/\1>/i);
    const motionText = motion ? motion[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    if (motionText.length < 40) {
      problems.push(`the planned motion must be written on the board as text: one block with class="motion-note" data-palate-motion carrying what moves, when and how it feels (found ${motionText ? JSON.stringify(motionText) : "none"})`);
    }
  }

  if (kind === "sheet") problems.push(...validateSheet(html, { id, kit }).problems);

  /**
   * ONE RULE FOR EVERY PICTURE ON THE BOARD, whatever named it.
   *
   * An `<img src>` and a `background-image: url()` are the same problem to a canvas with no
   * egress, and they were not checked the same way: a url() was only tested for being remote, so
   * `url(/img/hero.jpg)` and `url(pics/hero.jpg)` passed validation and then rendered blank. A
   * hero photograph is usually a background, so that was the commonest picture on a board going
   * unchecked for existence and for the ceiling.
   */
  const asset = (label, src) => {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) {
      problems.push(`${label} ${src} is remote or inline; images are bare filenames beside the artboard`);
      return;
    }
    if (src.includes("/")) { problems.push(`${label} ${src} must be a bare filename beside the artboard`); return; }
    if (!IMG_OK.test(src)) { problems.push(`${label} ${src} is not an image type the canvas resolves; other faces travel as @font-face data URIs`); return; }
    const p = join(dir, src);
    if (!existsSync(p)) problems.push(`${label} ${src} is not beside the artboard`);
    else if (statSync(p).size > MAX_IMAGE_BYTES) {
      problems.push(`${src} is ${Math.round(statSync(p).size / 1024)} KB; the canvas needs every image under 70 KB`);
    }
  };

  for (const m of html.matchAll(/<img\b[^>]*\bsrc=("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
    const raw = m[1];
    if (!raw.startsWith('"')) { problems.push(`img src ${raw} must be double-quoted`); continue; }
    asset("img src", raw.slice(1, -1));
  }
  // A srcset overrides the bare src with a URL the canvas cannot fetch, so a board whose every
  // src is conforming still renders a broken image and nothing says why.
  // Anchored on a word boundary of its own: `data-srcset` is a lazy-loader's attribute and
  // overrides nothing, so an unanchored match refused a conforming board.
  if (/<[a-z][a-z0-9]*\b[^>]*(^|\s)srcset\s*=/i.test(html)) {
    problems.push("srcset is not allowed on an artboard; it overrides the bare filename with a URL the canvas cannot fetch");
  }

  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const u = m[2].trim();
    // A fragment names an element in this very document (`filter: url(#grain)`), and a data URI
    // is already here. Neither is a file that has to sit beside the artboard.
    if (!u || u.startsWith("#") || u.startsWith("data:")) continue;
    if (GOOGLE_FONTS.test(u)) continue;
    if (/^(https?:)?\/\//i.test(u)) { problems.push(`css url(${u}) is remote; only Google Fonts may be fetched`); continue; }
    asset("css url", u);
  }
  // Google's own embed is three links, and two of them are preconnects to fonts.gstatic.com,
  // which is where the face files actually come from. Refusing the standard snippet sent an
  // operator looking for a fault in a board that was correct.
  for (const m of html.matchAll(/<link\b[^>]*\bhref=("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
    const href = /^["']/.test(m[1]) ? m[1].slice(1, -1) : m[1];
    if (!GOOGLE_FONTS.test(href)) problems.push(`link ${href} is not Google Fonts; nothing else may be fetched`);
  }

  const blocks = [...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)].filter((m) => BLOCK_TAGS.test(m[1]));
  const withClass = blocks.filter((m) => /\bclass="[^"]*[a-z]/i.test(m[2]));
  if (blocks.length && withClass.length / blocks.length < 0.6) {
    problems.push(`only ${withClass.length} of ${blocks.length} block elements carry a class; name every block's role (hero, hero-title, list, row) or the uniqueness gate signs the structure blind`);
  }
  if (!/a\s*:\s*hover/.test(html)) problems.push("define a and a:hover in <helmet><style>");
  return { ok: problems.length === 0, problems };
}

/**
 * A STABLE KEY ON EVERY ELEMENT, so the read-back can tell a deletion from a shift.
 *
 * The canvas editor edits text and inline styles; it does not rewrite attributes. Without a key
 * the diff could only align by position, and deleting one paragraph reported every element
 * after it as an edit: measured on a real board, one deletion produced 167 "changes" and the
 * run then told Compose to honour all of them.
 *
 * It skips the skeleton the editor replaces, and it is idempotent because an element that
 * already carries a key is left exactly as it was. That matters: the seed file is rewritten in
 * place, so a second run must not renumber a board the client is already looking at.
 *
 * THE COUNTER STARTS PAST THE HIGHEST KEY ALREADY ON THE BOARD, not at zero. Skipping keyed
 * elements is not enough on its own: a board keyed k0..k8 that the client then adds a paragraph
 * to came back with a SECOND k0, so two different elements carried one key and the read-back
 * would report an edit on whichever it matched first.
 */
export function stampKeys(html) {
  let i = 0;
  for (const m of html.matchAll(/\bdata-palate-k="k(\d+)"/g)) i = Math.max(i, Number(m[1]) + 1);
  return html.replace(/<([a-z][a-z0-9-]*)\b([^>]*?)(\/?)>/gi, (whole, tag, attrs, slash) => {
    if (/^(html|head|meta|script|style|helmet|x-dc|body|link|title|br)$/i.test(tag)) return whole;
    if (/\bdata-palate-k=/.test(attrs)) return whole;
    return `<${tag}${attrs} data-palate-k="k${i++}"${slash}>`;
  });
}

/**
 * The artboard skeleton, in the shape the canvas editor requires.
 *
 * The support.js line is copied verbatim because the editor replaces it; changing its spelling
 * is how an artboard stops being editable with nothing saying so. Used for the calibration
 * references, and published as the shape `validateArtboard` holds a hand-drawn board to.
 */
export function toArtboard({ html, css, fonts = "", imports = [], script = "", name = "" }) {
  const head = [
    // @import MUST COME FIRST. CSS ignores an @import that follows any other rule, so a
    // Google Fonts sheet appended after the stylesheet is a sheet that never loads, silently.
    ...imports.map((href) => `@import url("${href}");`),
    fonts,
    css,
    // The frame is fixed at 1440, and a frame neither scales nor crops on the canvas.
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
 * Frames neither scale nor crop on the canvas, so w and h are the MEASURED size and nothing
 * here may round them. 80 px between frames in a row, 120 px between rows, per the canvas's
 * own layout rules.
 */
export function writeCanvasJson({ boards, refs = [], donors = [], out }) {
  if (out) refuseLegacy([out], "board canvas output");
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

  /**
   * ONE ROW PER DIRECTION, and the columns are fixed.
   *
   * Boards used to run left to right along a single row, which read as a strip of home pages. A
   * direction is four boards now, beside the reference it is drawn from, and the row that
   * carries all five is what an agency puts on the wall to get a direction signed off. The x
   * positions are constants rather than a running offset because the value of a row is
   * COMPARISON: a direction with no donor must not slide its inner page into the donor's column,
   * or the row cannot be read against the one above it.
   */
  let rowY = refs.length ? rowHeight + ROW_GAP : 0;
  // 33, not 34: a canvas annotation id is at most 40 characters and `mobile-` is the longest
  // prefix written here, so 7 + 33 is exactly the ceiling.
  const safeId = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 33);
  for (const b of boards) {
    const heights = [b.h || 0];
    const note = (prefix, x, y, text) => annotations.push({ id: `${prefix}-${safeId(b.id)}`, x, y, w: 420, text });

    artboards.push({
      file: b.file || `B${b.ambition}.dc.html`,
      x: COLUMNS.board,
      y: rowY,
      w: FRAME_WIDTH,
      h: b.h,
      title: `Direction ${b.ambition} of ${boards.length}: ${b.name}`,
    });
    note("board", COLUMNS.board, rowY + b.h + 24, `${b.name} - direction ${b.ambition} of ${boards.length}. ${b.feeling}. ${b.what}`);

    /**
     * THE DONOR SITS BESIDE ITS OWN BOARD, on the board's row. A donor card laid in another
     * direction's column lands on top of a frame, which a canvas reports as nothing at all: one
     * frame over another reads as a board that was never drawn.
     */
    const d = donors.find((x) => x && Number(x.rung) === Number(b.ambition));
    if (d) {
      artboards.push({
        file: `D${d.rung}.dc.html`,
        x: COLUMNS.donor,
        y: rowY,
        w: REF_WIDTH,
        h: REF_HEIGHT,
        title: `Donor for direction ${d.rung}: ${d.name}`,
      });
      note("donor", COLUMNS.donor, rowY + REF_HEIGHT + 24, `Drawn from ${d.slug}: ${d.signature_move}`);
      heights.push(REF_HEIGHT);
    }

    const p = b.presentation || {};
    const rest = [
      { key: "inner", file: p.inner, h: b.innerH, x: COLUMNS.inner, w: FRAME_WIDTH,
        title: `${b.name}: the inner page`, text: "The primary service page in this direction." },
      { key: "mobile", file: p.mobile, h: b.mobileH, x: COLUMNS.mobile, w: MOBILE_WIDTH,
        title: `${b.name}: the phone`, text: `At ${MOBILE_WIDTH}, the same page stacked.` },
      { key: "sheet", file: p.sheet, h: b.sheetH, x: COLUMNS.sheet, w: FRAME_WIDTH,
        title: `${b.name}: the pieces as used`,
        text: "The pieces as used: navigation, footer, CTA, form and their states." },
    ];
    for (const f of rest) {
      // A frame with no MEASURED height is not laid out at all. Declaring a guess would crop the
      // board, and a canvas reports a cropped frame as a board that was drawn badly.
      if (!f.file || !(f.h > 0)) continue;
      artboards.push({ file: f.file, x: f.x, y: rowY, w: f.w, h: f.h, title: f.title });
      note(f.key, f.x, rowY + f.h + 24, f.text);
      heights.push(f.h);
    }

    rowY += Math.max(...heights) + ROW_GAP;
  }

  const doc = { artboards, annotations, launch: { view: "canvas" } };
  if (out) writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

// ----------------------------------------------------------------- the work
async function main() {
  const projectDir = resolve(positional[0] || ".");
  const outDir = resolve(projectDir, opt("--out", ".palate/explore"));
  refuseLegacy([projectDir, outDir], "boards-render");
  const seedDir = join(outDir, "seed");
  const shotsDir = join(outDir, "shots");
  const refsPath = opt("--refs", null);
  /**
   * THE DONOR ROW IS ON BY DEFAULT WHEN ITS FILE EXISTS, and its absence is printed rather
   * than passed over. `--donors <path>` names it explicitly (and a named file that does not
   * exist is a refusal, because it was asked for); `--no-donors` is the deliberate skip, and
   * that skip is recorded in the manifest so a run with no donor row cannot be mistaken for a
   * run with one.
   */
  const donorsAsked = opt("--donors", null);
  const donorsPath = donorsAsked || join(".palate/explore", "donor-heroes.json");
  if (flag("--no-build")) {
    process.stderr.write("boards-render: --no-build is obsolete; boards are artboards and nothing is built here.\n");
  }

  const reg = join(projectDir, "src", "lib", "variants.ts");
  if (!existsSync(reg)) die(`no ${join("src", "lib", "variants.ts")} under ${projectDir}. Not an Explore build; nothing measured. NOT a pass.`);
  const boards = parseRegistry(readFileSync(reg, "utf8")).sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
  if (!boards.length) die("no boards registered in src/lib/variants.ts. Register them first; nothing was measured.");
  if (!existsSync(seedDir)) die(`no ${seedDir}. Draw the artboards first: a direction is four, .palate/explore/seed/{B,I,M,S}<rung>.dc.html, per registered board.`);

  // The kit manifest, which is what every `data-kit-piece` mark on a detail sheet is checked
  // against. The project's own copy first (a build may have added a piece), the plugin's
  // template as the fallback, and a refusal when neither parses: a sheet checked against an
  // empty manifest is a sheet checked against nothing.
  const kit = loadKit(projectDir);

  /**
   * The four files of every direction, resolved BEFORE anything else happens.
   *
   * Resolved once, up here, because `boardFiles` refuses a direction that declared no
   * presentation, and a refusal must never have to step over an open browser to exit.
   */
  const files = new Map(boards.map((b) => [b.id, boardFiles(b)]));

  // 1. EVERY registered direction has FOUR conforming artboards, and the set is refused on the
  //    first bad one. Half a set handed to a client reads as the whole set, and the board that
  //    was refused is the one they never see and never ask about.
  for (const b of boards) {
    for (const { kind, file } of files.get(b.id)) {
      const p = join(seedDir, file);
      if (!existsSync(p)) {
        die(`board ${b.id} registers ${file} as its ${KINDS[kind].label} and ${p} does not exist. A direction is four boards (the home page, the inner page, the phone and the detail sheet); three of them read to a client as the whole direction. Nothing measured.`);
      }
      const html = readFileSync(p, "utf8");
      const v = validateArtboard(html, { id: b.id, section: b.section, dir: seedDir, kind, kit });
      if (!v.ok) die(`artboard ${file} (${b.id}, the ${KINDS[kind].label}) does not meet the canvas contract:\n  - ${v.problems.join("\n  - ")}`);
      // AND THE SHEET SAYS WHERE EACH PIECE CAME FROM. The registry knows every piece's donor;
      // the sheet is where a person reads it, and a run that shoots an untraceable sheet hands a
      // client a direction nobody can account for afterwards.
      if (kind === "sheet") {
        const c = validateSheetCaptions(html, { id: b.id, pieces: b.pieces });
        if (!c.ok) die(`detail sheet ${file} (${b.id}) does not carry its provenance:\n  - ${c.problems.join("\n  - ")}`);
      }
    }
  }

  // The calibration row is written BEFORE the browser opens: it needs sharp and no page, and a
  // refusal here must not have to step over an open browser to exit.
  const refs = refsPath ? loadRefs(projectDir, refsPath) : [];
  const lines = [];
  if (refs.length) lines.push(...await writeRefs(refs, seedDir, projectDir));

  // The donor row goes the same way and for the same reason: it needs sharp and the network,
  // not a page, and a refusal here must not have to step over an open browser to exit.
  let donors = [];
  let donorRow = { skipped: true, reason: "--no-donors" };
  if (flag("--no-donors")) {
    lines.push("  donor row: skipped (--no-donors). The boards are shown without the references they reproduce.");
  } else if (!donorsAsked && !existsSync(resolve(projectDir, donorsPath))) {
    donorRow = { skipped: true, reason: "no donor-heroes.json" };
    lines.push(`  donor row: skipped, there is no ${donorsPath}. The surveyor writes it; without it no board sits beside the reference it reproduces.`);
  } else {
    try { donors = loadDonors(projectDir, donorsPath, boards); }
    catch (e) { die(`${e.message}`); }
    mkdirSync(shotsDir, { recursive: true });
    lines.push(...await writeDonors(donors, boards, seedDir, shotsDir, projectDir));
    donorRow = { skipped: false, count: donors.length, slugs: donors.map((d) => d.slug) };
  }

  let playwright;
  try { playwright = engineRequire("playwright"); }
  catch { die(`playwright is not installed (${join(ENGINE, "setup.sh")}). The boards are UNMEASURED, not clean.`); }

  mkdirSync(shotsDir, { recursive: true });
  const browser = await playwright.chromium.launch();
  const measured = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: FRAME_WIDTH, height: HERO_HEIGHT }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    // The phone gets its own context, at its own width: a 390-wide board shot through a
    // 1440-wide viewport is a 390-wide drawing in a 1050px field of page background, which is
    // not what anybody is being shown.
    const mobileCtx = await browser.newContext({ viewport: { width: MOBILE_WIDTH, height: 844 }, deviceScaleFactor: 1 });
    const mobilePage = await mobileCtx.newPage();
    const pub = join(projectDir, "public", "_explore");
    mkdirSync(pub, { recursive: true });

    for (const b of boards) {
      const boardShots = join(shotsDir, b.id);
      mkdirSync(boardShots, { recursive: true });
      const sizes = {};
      let file = null;

      for (const { kind, file: name } of files.get(b.id)) {
        const p = join(seedDir, name);
        if (kind === "home") file = name;

        // 2. Key the artboard IN PLACE, so the published canvas and the archived copy align on
        //    data-palate-k. Idempotent, so a re-run does not renumber a board already on a
        //    canvas, and every one of the four is keyed because the client may edit any of them.
        const stamped = stampKeys(readFileSync(p, "utf8"));
        writeFileSync(p, stamped);

        // 3. The archived render IS the artboard. It is already self-contained (its CSS is in
        //    its own helmet and its images are bare filenames beside it), which is what the old
        //    harvest had to work to reproduce, so the copy carries the images too. The home
        //    board archives as `rendered.html` because the fidelity gate reads that name.
        const archive = kind === "home" ? "rendered.html" : `${kind}.html`;
        writeFileSync(join(boardShots, archive), stamped);
        for (const img of [...stamped.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1])) {
          try { copyFileSync(join(seedDir, img), join(boardShots, img)); }
          catch { /* validated above; a copy that fails costs the archive its picture, not the run */ }
        }

        // 4. MEASURE THE ARTBOARD ITSELF, over file://, which is the same layout the canvas
        //    draws. A frame neither scales nor crops and `x-dc` carries `overflow: hidden`, so
        //    a declared height that is short clips the bottom off the board with nothing
        //    reporting it.
        const on = kind === "mobile" ? mobilePage : page;
        await on.goto(pathToFileURL(p).href, { waitUntil: "load", timeout: 30000 });
        await on.waitForTimeout(150);
        sizes[kind] = await on.evaluate(() => {
          const dc = document.querySelector("x-dc");
          return Math.ceil(dc ? Math.max(dc.getBoundingClientRect().height, dc.scrollHeight) : document.documentElement.scrollHeight);
        });

        if (kind === "home") {
          await on.screenshot({ path: join(boardShots, "hero.png"), fullPage: false });
          /**
           * AND THE WHOLE BOARD, because an artboard is the whole home page.
           *
           * `hero.png` is the top 900px and nothing else: it is what the fidelity gate compares
           * against the built hero, and it is the right size for a card. It is the WRONG thing
           * to open behind a link reading "the still at full size", which is what /explore
           * offered for the whole of a board's life. `full.png` is the board end to end.
           */
          await on.screenshot({ path: join(boardShots, "full.png"), fullPage: true });
          copyFileSync(join(boardShots, "hero.png"), join(pub, `${b.id}.png`));
          copyFileSync(join(boardShots, "full.png"), join(pub, `${b.id}-full.png`));
        } else {
          /**
           * THE INNER PAGE IS SHOT AS AN ENTRANCE, the phone and the sheet end to end.
           *
           * The inner still is compared against the built inner page by the judge, exactly as
           * `hero.png` is, so it has to be the same 1440x900 crop. The phone and the sheet are
           * evidence rather than comparisons: a fold of a detail sheet is the navigation and
           * nothing else, which is the half of the sheet that was never in doubt.
           */
          await on.screenshot({ path: join(boardShots, `${kind}.png`), fullPage: kind !== "inner" });
          copyFileSync(join(boardShots, `${kind}.png`), join(pub, `${b.id}-${kind}.png`));
        }
      }

      measured.push({ ...b, file, h: sizes.home, innerH: sizes.inner, mobileH: sizes.mobile, sheetH: sizes.sheet });
      lines.push(
        `  ${b.id} rung ${b.ambition} ${b.name}: ${file} ${sizes.home}px, ` +
        `${b.presentation.inner} ${sizes.inner}px, ${b.presentation.mobile} ${sizes.mobile}px at ${MOBILE_WIDTH}, ` +
        `${b.presentation.sheet} ${sizes.sheet}px; hero, full, inner, mobile and sheet stills written`,
      );
    }
  } finally {
    await browser.close().catch(() => {});
  }

  writeCanvasJson({ boards: measured, refs, donors, out: join(seedDir, "canvas.json") });
  writeFileSync(join(seedDir, "README.md"), seedReadme(measured, refs, donors));
  recordShown(projectDir, boards, donorRow);

  process.stdout.write(`boards-render: ${measured.length} direction(s), ${measured.length * 4} artboard(s) validated, keyed, measured and archived under ${outDir}\n`);
  for (const l of lines) process.stdout.write(`${l}\n`);
  process.stdout.write(`  canvas.json, README.md; stills in ${shotsDir} and public/_explore/ (<id>.png, <id>-full.png, <id>-inner.png, <id>-mobile.png, <id>-sheet.png)\n`);
}

/**
 * The four boards of one direction, in the order they are validated, keyed and shot.
 *
 * A missing `presentation` is a REFUSAL rather than a derivation. The other three names could be
 * derived from the rung, and deriving them would mean a registry that declared nothing still
 * passes while the client is shown one board out of four, which is the failure this whole
 * change exists to correct.
 */
function boardFiles(b) {
  const p = b.presentation || {};
  const missing = ["inner", "mobile", "sheet"].filter((k) => !p[k]);
  if (missing.length) {
    die(`board ${b.id} has no presentation.${missing.join(", presentation.")} in src/lib/variants.ts. A direction is four artboards: the home page, the inner page the primary action lands on, the home at ${MOBILE_WIDTH}, and the detail sheet of the kit pieces as used. Register them as presentation: { inner: "I${b.ambition}.dc.html", mobile: "M${b.ambition}.dc.html", sheet: "S${b.ambition}.dc.html" }. Nothing measured.`);
  }
  return [
    { kind: "home", file: b.artboard || `B${b.ambition}.dc.html` },
    { kind: "inner", file: p.inner },
    { kind: "mobile", file: p.mobile },
    { kind: "sheet", file: p.sheet },
  ];
}

/**
 * The kit manifest the detail sheets are checked against.
 *
 * The project's own copy first, because a build may legitimately have added a piece, and the
 * plugin's template as the fallback for a seed drawn before the site was scaffolded. Neither
 * parsing is a refusal: checking a sheet's marks against an empty manifest passes every mark,
 * which is the same silence as not checking at all.
 */
function loadKit(projectDir) {
  const candidates = [
    join(projectDir, "src", "lib", "kit.ts"),
    join(HERE, "..", "templates", "astro-project", "src", "lib", "kit.ts"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const kit = parseKitVariations(readFileSync(p, "utf8"));
    if (kit.size) return kit;
  }
  die(`the website kit manifest could not be read (looked for ${candidates.join(" and ")}). Every data-kit-piece mark on a detail sheet is checked against it, so without it the sheets are UNCHECKED rather than clean.`);
  return new Map();
}

/** The calibration references, validated before anything is written. */
function loadRefs(projectDir, refsPath) {
  const p = resolve(projectDir, refsPath);
  if (!existsSync(p)) die(`--refs ${refsPath} does not exist. The calibration row cannot be drawn.`);
  let refs;
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
  return refs;
}

/** Write the calibration row: one artboard and one capture per reference, both under the ceiling. */
async function writeRefs(refs, seedDir, projectDir) {
  let sharp;
  try { sharp = engineRequire("sharp"); }
  catch { die(`sharp is not installed (${join(ENGINE, "setup.sh")}). The calibration captures cannot be brought under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB, so nothing was written.`); }

  const lines = [];
  for (const r of refs) {
    let buf = readFileSync(r.__file);
    if (buf.length > MAX_IMAGE_BYTES || !/\.jpe?g$/i.test(r.__file)) {
      const fit = await fitUnder(buf, sharp).catch((e) => {
        die(`the calibration screenshot for ${r.slug} could not be re-encoded (${e.message}). Nothing written.`);
      });
      if (!fit.ok) {
        die(`the calibration screenshot for ${r.slug} will not come under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB (smallest was ${Math.round(fit.buffer.length / 1024)} KB at ${fit.width}px wide, quality ${fit.quality}). Nothing written.`);
      }
      buf = fit.buffer;
    }
    const img = `ref${r.position}.jpg`;
    writeFileSync(join(seedDir, img), buf);
    // /explore serves the same capture, so the calibration row exists for every tool and not
    // only for the canvas. Copied rather than linked: a `public/` cleaned between builds would
    // otherwise empty the row that asks the question.
    const pubRefs = join(projectDir, "public", "_explore");
    mkdirSync(pubRefs, { recursive: true });
    writeFileSync(join(pubRefs, img), buf);
    writeFileSync(join(seedDir, `Ref${r.position}.dc.html`), refArtboard(r, img));
    lines.push(`  reference ${r.position} ${r.slug}: Ref${r.position}.dc.html, ${img} ${Math.round(buf.length / 1024)} KB`);
  }
  return lines;
}

/**
 * The donor row, validated before a single byte is fetched.
 *
 * A rung's donor is the library reference the board REPRODUCES, and until now it was a bare
 * slug in a registry: its hero never reached the canvas, and its signature move, component
 * prompts and copy voice never reached the drawing. `.palate/explore/donor-heroes.json` is the
 * surveyor's record of all of it, written from the `refs_get_screenshot` response the survey
 * already paid for, so nothing here costs a metered call.
 *
 * IT THROWS RATHER THAN EXITING, so the suite can hold it to its own contract without spawning
 * a process; `main` turns the message into the file's usual refusal. A registered board with no
 * entry is a refusal and never a silence: half a donor row on a canvas reads as the whole one,
 * and the rung that is missing its reference is the one nobody asks about.
 */
export function loadDonors(projectDir, donorsPath, boards = []) {
  const p = resolve(projectDir, donorsPath);
  if (!existsSync(p)) throw new Error(`--donors ${donorsPath} does not exist. The donor row cannot be drawn.`);
  let donors;
  try { donors = JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { throw new Error(`--donors ${donorsPath} is not readable JSON: ${e.message}`); }
  if (!Array.isArray(donors) || !donors.length) {
    throw new Error(`--donors ${donorsPath} holds no donors. The donor row cannot be drawn.`);
  }

  const seen = new Map();
  for (const d of donors) {
    const where = JSON.stringify(d).slice(0, 120);
    if (!Number.isInteger(Number(d && d.rung))) throw new Error(`a donor has no whole-number rung (${where}).`);
    const rung = Number(d.rung);
    d.rung = rung;
    for (const f of ["slug", "name", "signature_move", "copy_voice", "hero_url"]) {
      if (!d[f] || typeof d[f] !== "string") throw new Error(`the donor for rung ${rung} has no ${f}; every field is what the board is drawn from.`);
    }
    for (const f of ["component_prompts", "do_dont"]) {
      if (!Array.isArray(d[f]) || !d[f].length) throw new Error(`the donor for rung ${rung} has no ${f}; the board is drawn from those lines, so an empty one is a board drawn from a slug.`);
    }
    /**
     * A reference screenshot is a PUBLIC OBJECT over https. http is allowed on loopback alone,
     * which is how the suite serves a fixture hero without reaching the library; anything else
     * over plain http is refused rather than fetched.
     */
    let url;
    try { url = new URL(d.hero_url); } catch { throw new Error(`the donor for rung ${rung} has an unreadable hero_url (${d.hero_url}).`); }
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error(`the donor for rung ${rung} (${d.slug}) has a hero_url that is not https (${d.hero_url}).`);
    }
    if (seen.has(rung)) throw new Error(`two donors claim rung ${rung} (${seen.get(rung)} and ${d.slug}); one rung reproduces one reference.`);
    seen.set(rung, d.slug);
  }

  /**
   * THE ROW IS MATCHED BY RUNG AND CHECKED BY SLUG.
   *
   * The registry names the donor a board REPRODUCES and this file names the donor a rung's card
   * SHOWS, and the two were only ever joined on the rung number. A registry entry reading
   * `donor: "linear"` at rung 2 beside a rung-2 entry for `aesop` passed every gate downstream:
   * the canvas then laid aesop's hero beside that board and captioned it "Drawn from linear",
   * which is a false claim about published work, made to the one person it is made to, with the
   * evidence for it sitting right there.
   */
  for (const b of boards) {
    const rung = Number(b.ambition);
    if (!seen.has(rung)) {
      throw new Error(`board ${b.id} is registered at rung ${b.ambition} and donor-heroes.json carries no entry for rung ${b.ambition}. Record its donor, or run with --no-donors; half a donor row reads as the whole one.`);
    }
    const named = seen.get(rung);
    if (b.donor && String(b.donor) !== named) {
      throw new Error(`board ${b.id} is registered with donor "${b.donor}" and ${donorsPath} carries "${named}" at rung ${rung}. The card beside that board would show ${named}'s hero captioned "Drawn from ${b.donor}". Name one reference in both.`);
    }
  }
  return donors.slice().sort((a, b) => a.rung - b.rung);
}

/**
 * Fetch one public hero, and refuse loudly on anything that is not a picture.
 *
 * Ten seconds, because this sits on the critical path of a run an operator is watching, and an
 * unbounded fetch of a host that accepts the connection and never answers hangs the whole seed
 * with nothing on screen. The body is checked by its MAGIC BYTES rather than by its
 * content-type: an error page served as image/png under a .png name is the way this actually
 * goes wrong, and it would otherwise be re-encoded into a broken frame.
 */
async function fetchHero(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  // The clock covers the BODY as well as the headers. A host that answers 200 and then dribbles
  // is the shape that hangs a run an operator is watching, and clearing the timer at the end of
  // the headers would leave the read unbounded.
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let buf;
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}; the donor hero is not there.`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${url} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
    throw e instanceof Error && /answered HTTP/.test(e.message) ? e : new Error(`${url} could not be fetched (${e.message}).`);
  } finally {
    clearTimeout(timer);
  }
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const webp = buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  if (!(png || jpeg || webp)) {
    throw new Error(`${url} answered ${buf.length} bytes that are not a PNG, JPEG or WebP; an error page under an image name is not a hero.`);
  }
  return buf;
}

/**
 * Write the donor row: one fetched, re-encoded hero and one card per rung, beside its board.
 *
 * The same ceiling as everything else on a canvas with no egress: 70 KB, walked down the
 * existing ladder. The still is copied into the archive and into `public/_explore/` as well,
 * so /explore can show the donor beside the board for every tool that cannot open a canvas.
 */
async function writeDonors(donors, boards, seedDir, shotsDir, projectDir) {
  let sharp;
  try { sharp = engineRequire("sharp"); }
  catch { die(`sharp is not installed (${join(ENGINE, "setup.sh")}). The donor heroes cannot be brought under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB, so nothing was written.`); }

  const lines = [];
  for (const d of donors) {
    /**
     * A donor no registered board claims is RECORDED and not drawn. The surveyor may legitimately
     * have written more donors than the ladder ended up with, and writing a card for one would
     * leave a file in the seed that `canvas.json` never lays out: an artboard nobody can reach,
     * which reads as a board that was dropped.
     */
    const board = boards.find((b) => Number(b.ambition) === d.rung);
    if (!board) {
      lines.push(`  donor rung ${d.rung} ${d.slug}: recorded, not drawn (no board is registered at rung ${d.rung})`);
      continue;
    }
    let buf;
    try { buf = await fetchHero(d.hero_url); }
    catch (e) { die(`the donor hero for rung ${d.rung} (${d.slug}): ${e.message} Nothing written.`); }

    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    if (!isJpeg || buf.length > MAX_IMAGE_BYTES) {
      const fit = await fitUnder(buf, sharp).catch((e) => {
        die(`the donor hero for rung ${d.rung} (${d.slug}) could not be re-encoded (${e.message}). Nothing written.`);
      });
      if (!fit.ok) {
        die(`the donor hero for rung ${d.rung} (${d.slug}) will not come under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB (smallest was ${Math.round(fit.buffer.length / 1024)} KB at ${fit.width}px wide, quality ${fit.quality}). Nothing written.`);
      }
      buf = fit.buffer;
    }

    const img = `d${d.rung}-hero.jpg`;
    writeFileSync(join(seedDir, img), buf);
    writeFileSync(join(seedDir, `D${d.rung}.dc.html`), donorArtboard({ ...d, img }));

    // The same picture reaches /explore and the archive, keyed on the BOARD's id, because that
    // is what the page and the fidelity trail both address a rung by.
    const boardShots = join(shotsDir, board.id);
    mkdirSync(boardShots, { recursive: true });
    await writeDonorFull(d, boardShots, lines);
    writeFileSync(join(boardShots, "donor.jpg"), buf);
    const pub = join(projectDir, "public", "_explore");
    mkdirSync(pub, { recursive: true });
    writeFileSync(join(pub, `${board.id}-donor.jpg`), buf);
    lines.push(`  donor rung ${d.rung} ${d.slug}: D${d.rung}.dc.html, ${img} ${Math.round(buf.length / 1024)} KB`);
  }
  return lines;
}

/**
 * Fetch the donor's whole-page capture beside its hero, for the page ending the judge compares.
 *
 * The library serves a reference's captures as public objects under one prefix, so the full-page
 * one is the desktop hero's own URL with the last segment swapped. A `hero_url` that does not
 * name a `desktop.png` is not guessed at: fetching the same URL twice under a different name
 * would put the entrance on disk as though it were the ending, and the judge would then be
 * comparing two heroes and reporting it as a verdict about two footers.
 *
 * NOTHING HERE IS FATAL. A reference with no full capture, a capture that is too large, a host
 * that will not answer: each leaves a sidecar saying so and the run carries on, because none of
 * them is the operator's doing and none of them makes the canvas wrong. The sidecar is what lets
 * the gate leave that surface out of its request AND say why, which a bare absence cannot.
 */
async function writeDonorFull(d, boardShots, lines) {
  // ITS OWN DIRECTORY, because this is the first thing written into it on a FIRST run and the
  // caller's mkdir used to come after. A render that throws ENOENT on a fresh project is the
  // one failure this function's "nothing here is fatal" rule cannot absorb.
  mkdirSync(boardShots, { recursive: true });
  const dest = join(boardShots, "donor-full.png");
  const note = join(boardShots, "donor-full.missing");
  const record = (why) => {
    rmSync(dest, { force: true });
    writeFileSync(note, `${why}\n`);
    lines.push(`  donor rung ${d.rung} ${d.slug}: no whole-page capture (${why}); its page ending is not judged`);
  };

  if (!/desktop\.png$/i.test(d.hero_url)) {
    record(`its hero_url does not name a desktop.png capture, so there is no full.png beside it`);
    return;
  }
  const url = d.hero_url.replace(/desktop\.png$/i, "full.png");
  let buf;
  try { buf = await fetchHero(url, DONOR_FULL_TIMEOUT_MS); }
  catch (e) { record(e.message.replace(/\s+$/, "")); return; }
  if (buf.length > MAX_DONOR_FULL_BYTES) {
    record(`${url} answered ${(buf.length / (1024 * 1024)).toFixed(1)} MB, over the 16 MB ceiling for judge evidence`);
    return;
  }
  /**
   * KEPT AS FETCHED, under a .png name whatever the container. It is decoded by content and
   * cropped by the gate, which writes the PNG the judge is actually shown; re-encoding it here
   * would cost a second decode of a large image to change nothing downstream.
   */
  rmSync(note, { force: true });
  writeFileSync(dest, buf);
  lines.push(`  donor rung ${d.rung} ${d.slug}: donor-full.png ${Math.round(buf.length / 1024)} KB (the page ending)`);
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
 * Kept exported for callers that read an authored artboard: a data URI is refused on a board
 * (images are files beside it), and naming what it actually was is how that refusal reads as a
 * correction rather than as a broken image.
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

/**
 * Point every url() at a file written beside the artboard.
 *
 * Nothing in this file harvests a page any more, so nothing here calls it. It stays exported
 * because it is the one implementation of "rewrite a stylesheet's urls to bare filenames" in
 * the tree, and the read-back and the archive tooling both reach for it.
 */
export function rewriteUrls(css, map, pairs = [], dropped = new Set()) {
  // Keyed on the url AS WRITTEN, because that is what is in the text. The pairs carry the
  // absolute form a fetch loop would have used, which is the only thing `map` knows about.
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
 * Replace a page's linked stylesheets with a collected stylesheet, inline.
 *
 * An artboard is self-contained by construction, so the archive no longer needs this. It stays
 * exported for anything archiving an ordinary built page, where an `/_astro/<hash>.css` link
 * does not outlive the next build: the hash changes, the old file is gone, and the archived
 * page renders unstyled with nothing reporting it.
 */
export function selfContained(html, css) {
  const stripped = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, "");
  const style = `<style data-palate-archived-css="1">${css}</style>`;
  return stripped.includes("</head>")
    ? stripped.replace("</head>", `${style}</head>`)
    : `${style}${stripped}`;
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

/**
 * One donor: the reference's own hero, its slug, and the single move the board reproduces.
 *
 * Deliberately the same 720 x 580 frame as a calibration reference, because it is the same kind
 * of object (a real site, shown as evidence) and a canvas row of mismatched frame heights reads
 * as a mistake. One line of text, not a paragraph: what the board took, said plainly enough
 * that the client can check the board against it.
 */
function donorArtboard({ rung, slug, name, signature_move, img }) {
  const html =
    `<div style="width:${REF_WIDTH}px;height:${REF_HEIGHT}px;background:#ffffff;color:#111111;` +
    `font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;flex-direction:column">` +
    `<img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" style="width:${REF_WIDTH}px;height:450px;object-fit:cover;object-position:top;display:block">` +
    `<div style="padding:16px 20px;display:flex;flex-direction:column;gap:6px">` +
    `<p style="margin:0;font-size:17px;font-weight:600;line-height:1.2">Direction ${escapeHtml(rung)} is drawn from ${escapeHtml(name)} (${escapeHtml(slug)})</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.45;color:#5c5c5c">${escapeHtml(signature_move)}</p>` +
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

function seedReadme(boards, refs, donors = []) {
  const rows = boards.flatMap((b) => [
    `- \`${b.file}\` - direction ${b.ambition} of ${boards.length}, ${b.name} (${b.id}), the home page, ${FRAME_WIDTH} by ${b.h}`,
    `  - \`${b.presentation?.inner}\` - the primary service page, ${FRAME_WIDTH} by ${b.innerH}`,
    `  - \`${b.presentation?.mobile}\` - the home page on a phone, ${MOBILE_WIDTH} by ${b.mobileH}`,
    `  - \`${b.presentation?.sheet}\` - the kit pieces as used, with their states, ${FRAME_WIDTH} by ${b.sheetH}`,
  ]);
  const refRows = refs.map((r) => `- \`Ref${r.position}.dc.html\` - ${r.name} (${r.slug}), ${REF_WIDTH} by ${REF_HEIGHT}`);
  const donorRows = donors.map((d) => `- \`D${d.rung}.dc.html\` - the donor direction ${d.rung} is drawn from, ${d.name} (${d.slug}), ${REF_WIDTH} by ${REF_HEIGHT}`);
  return [
    "# Explore canvas seed",
    "",
    "Seed this directory as the canvas. Title it **Directions to choose from**.",
    "",
    "## Artboards",
    ...(refRows.length ? ["", "Row 0, the calibration references:", ...refRows] : []),
    "",
    "One ROW per direction, most restrained to boldest. Each row is the home page, the",
  "reference it is drawn from, the inner page, the phone and the detail sheet:",
    ...rows,
    ...(donorRows.length ? ["", "Beside each board, the reference it reproduces:", ...donorRows] : []),
    "",
    "## Files",
    "",
    "- `canvas.json` - the layout, the annotations and the launch view.",
    "- the image files beside each artboard are its pictures, referenced by bare filename.",
    "",
    "## The artboards ARE the directions",
    "",
    "Each `B<n>.dc.html` is the whole home page in one direction, navigation to footer, drawn",
    "by hand against the survey and the locked brand tokens. There is no Astro behind a board and",
    "no route to open: these files are the source of truth for the pick. Astro is built once,",
    "after the client picks, for the chosen direction alone.",
    "",
    "Each board writes its planned motion on itself, in the `motion-note` block, because a board",
    "is a still and a direction whose motion is never written is chosen with its most expensive",
    "property unseen.",
    "",
    "The first artboard is `B1.dc.html`, not `Main.dc.html`. The canvas helper looks for a file",
    "of that name as the entry point and WARNS when it does not find one; the seed opens and",
    "works regardless, because `canvas.json` names the launch view. The warning is expected and",
    "is not a fault in the seed. The names are the direction numbers on purpose: `B1` through",
    "`BN` is what the client and the picker both call them.",
    "",
    "## What the client changes here",
    "",
    "Edits made on the canvas are read back with `palate-pick.mjs --canvas <extract-dir>`, keyed",
    "on the artboard's file name and the `data-palate-k` attribute this run stamped on every",
    "element, and honoured at Compose.",
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
function recordShown(projectDir, boards, donorRow = null) {
  const merge = join(HERE, "manifest-merge.mjs");
  const manifest = join(projectDir, "build-manifest.json");
  if (!existsSync(manifest) || !existsSync(merge)) return;
  const patch = {
    explore: {
      ran: true,
      shown_at: new Date().toISOString(),
      boards: boards.map((b) => ({ id: b.id, rung: b.ambition, donor: b.donor })),
      /**
       * THE LINEAGE SEAM. The Stop hook's `.palate/donors.json` is built from
       * `explore.shown[].donor_slug`, and nothing wrote `shown` at all, so every RUN SITE
       * command afterwards searched the library cold for craft this build already knew the
       * source of.
       */
      shown: boards.map((b) => ({ id: b.id, name: b.name, donor_slug: b.donor, position: b.ambition })),
      ...(donorRow ? { donor_row: donorRow } : {}),
    },
  };
  try {
    execFileSync(process.execPath, [merge, "--manifest", manifest, "--set", JSON.stringify(patch)], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch { /* the manifest is a record, never a gate on measuring */ }
}

/**
 * ONLY AS A CLI. The helpers above are imported by the test suite and by palate-pick, and a
 * module that runs its own main() on import turns `import { parseRegistry }` into a build.
 *
 * The entry-point test lives in `lib/invoked-directly.mjs` and is shared with every other CLI
 * in the plugin. It was this file that proved it has to compare REAL paths: through `/tmp`,
 * which macOS symlinks to `/private/tmp`, the guard was false, `main()` never ran, and the
 * script printed nothing and exited 0.
 */
if (invokedDirectly(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`boards-render: ${e && e.stack ? e.stack : e}\n`);
    process.exit(2);
  });
}
