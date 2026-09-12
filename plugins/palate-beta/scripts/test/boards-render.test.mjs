/**
 * boards-render.test.mjs - the artboard contract, and the run that holds boards to it.
 *
 * Explore is drawn now, not built: a board is a hand-authored `.dc.html` artboard and this
 * script validates it, keys it, measures it and archives it. Everything it writes is consumed
 * by something that cannot report a fault. The canvas silently renders a broken image for a src
 * it cannot resolve, silently stops being editable when the skeleton is spelled differently,
 * and silently mis-frames an artboard whose declared height is wrong. So the assertions here
 * are about the FILE, not about the run finishing.
 *
 * The last blocks are the ones that matter most: a refusal must leave the seed alone. The seed
 * is the operator's own drawing work, so a script that deletes it over one oversized image
 * costs hours rather than a minute.
 *
 * Slow: it needs Playwright. scripts/test/run.sh skips it under --fast.
 * Run: node --test scripts/test/boards-render.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, statSync, symlinkSync, realpathSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createServer } from "node:http";
import { PROPERTY_LIST, parseRegistry, writeCanvasJson, toArtboard, validateArtboard, validateSheet, validateSheetCaptions, parseKitVariations, stampKeys, loadDonors } from "../boards-render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "scripts", "boards-render.mjs");

let TMP = null;
let SITE = null;
let SEED = null;
let ready = false;
let skipReason = "";

const BOARDS = [
  {
    id: "b1", name: "The Quiet Room", ambition: 1, section: "services", donor: "therapy-in-london",
    what: "One column, one photograph, and a great deal of air.",
    why: "The people arriving are anxious and have been dismissed once already.",
    feeling: "unhurried, private, adult",
    motion: "Nothing moves on load; a single slow fade carries the photograph in.",
    ctas: ["Book a first visit", "Ask a question"],
    pieces: {
      navigation: { variation: "NavSimple", donor: "aesop" },
      hero: { variation: "HeroTextImage", donor: "anthropic" },
      trust: { variation: "TrustRatings", donor: "lava-dental" },
      cta: { variation: "CtaClosing", donor: "parsley-health" },
      forms: { variation: "FormEnquiry", donor: "pilot-accounting" },
      footer: { variation: "FooterSimple", donor: "loom" },
      services: { variation: "BenefitCards", donor: "linear" },
    },
  },
  {
    id: "b2", name: "The Long Table", ambition: 2, section: "proof", donor: "the-modern-house",
    what: "A wide table of the work, read left to right.",
    why: "This buyer compares before they commit, so the comparison is the page.",
    feeling: "candid, unhurried",
    motion: "Rows settle into place as the table is scrolled, one after another.",
    ctas: ["See the work", "Start a project", "Ask about a fit"],
    pieces: {
      navigation: { variation: "NavDropdown", donor: "stripe" },
      hero: { variation: "HeroCentredPreview", donor: "linear" },
      trust: { variation: "TrustLogos", donor: "mercury" },
      cta: { variation: "CtaWithProof", donor: "vercel" },
      forms: { variation: "FormContact", donor: "basecamp" },
      footer: { variation: "FooterGrouped", donor: "glossier" },
      proof: { variation: "TestimonialGrid", donor: "aesop" },
    },
  },
];

/**
 * The registry: `artboard` required, no `href` (no route exists), and `presentation` naming the
 * other three artboards of the direction, because a direction is four boards now.
 */
function registryFor(boards) {
  const entries = boards.map((b) => `  {
    id: ${JSON.stringify(b.id)},
    name: ${JSON.stringify(b.name)},
    artboard: ${JSON.stringify(`B${b.ambition}.dc.html`)},
    presentation: {
      inner: ${JSON.stringify(`I${b.ambition}.dc.html`)},
      mobile: ${JSON.stringify(`M${b.ambition}.dc.html`)},
      sheet: ${JSON.stringify(`S${b.ambition}.dc.html`)},
    },
    ambition: ${b.ambition},
    what: ${JSON.stringify(b.what)},
    why: ${JSON.stringify(b.why)},
    feeling: ${JSON.stringify(b.feeling)},
    donor: ${JSON.stringify(b.donor)},
    section: ${JSON.stringify(b.section)},
    motion: ${JSON.stringify(b.motion)},
    ctas: ${JSON.stringify(b.ctas)},
    pieces: {
${Object.entries(b.pieces || {}).map(([k, v]) => `      ${k}: { variation: ${JSON.stringify(v.variation)}, donor: ${JSON.stringify(v.donor)} },`).join("\n")}
    },
  },`).join("\n");
  return `export interface Variant {
  id: string; name: string; artboard: string; href?: string; ambition: number; what: string;
  why: string; feeling: string; donor: string; section: string; motion: string; ctas: string[];
  presentation: { inner: string; mobile: string; sheet: string };
  pieces: Record<string, { variation: string; donor: string }>;
  clip?: string; lookAt?: string;
}
export const variants: Variant[] = [
${entries}
];
export const landingVariants: Variant[] = [];
export function byAmbition(list: Variant[]): Variant[] {
  return [...list].sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
}
`;
}

/**
 * A conforming artboard: the whole page in one direction, navigation to footer, with the motion
 * written on it and every block naming its role.
 *
 * Tall on purpose. The frame height is MEASURED, and a board that renders 150px tall could not
 * tell a real measurement from a default.
 */
function artboardFor(b) {
  return `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body>` +
    `<x-dc><helmet><style>` +
    `x-dc{display:block;width:1440px;overflow:hidden}body{margin:0;font-family:Georgia,serif}` +
    `a{color:#2f5d50;text-decoration:underline}a:hover{color:#1b382f}` +
    `.hero{min-height:620px;padding:80px;background:#f4f1ea}.band{padding:64px 80px}` +
    `</style></helmet>` +
    `<header class="nav band" data-section-id="${b.id}-navigation">` +
    `<a class="nav-logo" href="#">${b.name}</a><a class="nav-cta" href="#">${b.ctas[0]}</a></header>` +
    `<section class="hero" data-section-id="${b.id}-hero">` +
    `<h1 class="hero-title">${b.name}</h1><p class="hero-lede">${b.what}</p>` +
    `<img src="${b.id}-img1.png" alt="A fixture photograph"></section>` +
    `<section class="${b.section} band" data-section-id="${b.id}-${b.section}">` +
    `<h2 class="section-title">${b.section}</h2><ul class="list"><li class="row">One</li><li class="row">Two</li></ul></section>` +
    `<aside class="motion-note band" data-palate-motion="">${b.motion} It holds once it arrives, and nothing loops.</aside>` +
    `<section class="cta band" data-section-id="${b.id}-cta"><a class="cta-btn" href="#">${b.ctas[1]}</a></section>` +
    `<footer class="footer band" data-section-id="${b.id}-footer"><p class="footer-line">Ballina, New South Wales</p></footer>` +
    `</x-dc></body></html>`;
}

/**
 * The other three artboards of a direction. A direction is not one board any more: the client
 * signs off a home page, the inner page the primary action lands on, the same home at 390, and
 * the sheet of the kit pieces AS USED, with their states.
 *
 * All three are tall on purpose, for the same reason the home board is: the frame height is
 * MEASURED, and a board that renders 150px tall could not tell a measurement from a default.
 */
function innerFor(b) {
  return `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body>` +
    `<x-dc><helmet><style>` +
    `x-dc{display:block;width:1440px;overflow:hidden}body{margin:0;font-family:Georgia,serif}` +
    `a{color:#2f5d50;text-decoration:underline}a:hover{color:#1b382f}` +
    `.hero{min-height:520px;padding:80px}.band{padding:64px 80px}` +
    `</style></helmet>` +
    `<header class="nav band" data-section-id="${b.id}-inner-navigation">` +
    `<a class="nav-logo" href="#">${b.name}</a><a class="nav-cta" href="#">${b.ctas[0]}</a></header>` +
    `<section class="hero" data-section-id="${b.id}-inner-hero">` +
    `<h1 class="hero-title">The service page</h1><p class="hero-lede">${b.what}</p></section>` +
    `<section class="detail band" data-section-id="${b.id}-inner-detail">` +
    `<h2 class="section-title">What is included</h2><ul class="list"><li class="row">One</li><li class="row">Two</li></ul></section>` +
    `<section class="cta band" data-section-id="${b.id}-inner-cta"><a class="cta-btn" href="#">${b.ctas[1]}</a></section>` +
    `<footer class="footer band" data-section-id="${b.id}-inner-footer"><p class="footer-line">Ballina, New South Wales</p></footer>` +
    `</x-dc></body></html>`;
}

function mobileFor(b) {
  return `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body>` +
    `<x-dc><helmet><style>` +
    `x-dc{display:block;width:390px;overflow:hidden}body{margin:0;font-family:Georgia,serif}` +
    `a{color:#2f5d50;text-decoration:underline}a:hover{color:#1b382f}` +
    `.hero{min-height:480px;padding:24px}.band{padding:32px 24px}` +
    `</style></helmet>` +
    `<header class="nav band" data-section-id="${b.id}-navigation">` +
    `<a class="nav-logo" href="#">${b.name}</a><a class="nav-burger" href="#">Menu</a></header>` +
    `<section class="hero" data-section-id="${b.id}-hero">` +
    `<h1 class="hero-title">${b.name}</h1><p class="hero-lede">${b.what}</p></section>` +
    `<section class="${b.section} band" data-section-id="${b.id}-${b.section}">` +
    `<h2 class="section-title">${b.section}</h2><ul class="list"><li class="row">One</li></ul></section>` +
    `<section class="cta band" data-section-id="${b.id}-cta"><a class="cta-btn" href="#">${b.ctas[0]}</a></section>` +
    `<footer class="footer band" data-section-id="${b.id}-footer"><p class="footer-line">Ballina, New South Wales</p></footer>` +
    `</x-dc></body></html>`;
}

/** The eight blocks the sheet owes, each a real kit piece and variation, each with real copy. */
const SHEET_BLOCKS = [
  ["navigation:NavSimple:default", "The bar at rest: the name on the left, five destinations, and the one action pinned right."],
  ["navigation:NavMobileSheet:open", "The drawer open on a phone, with the same destinations and the quote action held at the bottom."],
  ["trust:TrustRatings:default", "Four and nine tenths from three hundred and twelve reviews, said plainly under the entrance."],
  ["benefits:BenefitCards:default", "One card: what the work is, what it costs to start, and how long a fitting takes."],
  ["forms:FormEnquiry:default", "The enquiry form filled in: name, suburb, phone, and what needs doing."],
  ["forms:FormEnquiry:error", "The same form with its errors shown: a phone number that is not a phone number, named on the field."],
  ["cta:CtaClosing:default", "The closing band: one line, one action, and the number to ring if a form is not wanted."],
  ["footer:FooterSimple:default", "The footer: the address, the hours, the licence number and the three legal links."],
];

/**
 * The provenance caption a real sheet carries under each block: the piece, the kit variation it
 * is, and the reference that variation's craft came from. It is the only place the DONOR of a
 * piece is ever written down where a client can read it, which is why boards-render checks it.
 */
function captionFor(b, mark) {
  const [piece, variation] = mark.split(":");
  // BY THE VARIATION FIRST, then by the piece id, exactly as the check resolves it: the card is
  // registered under the direction's own section key ("services"), and the drawer on a phone is
  // a second navigation variation the registry does not name.
  const prov = Object.values(b.pieces || {}).find((x) => x.variation === variation) || b.pieces?.[piece];
  if (!prov) return "";
  const name = piece[0].toUpperCase() + piece.slice(1);
  return `<p class="piece-from">${name}: ${variation}, drawn from ${prov.donor}.</p>`;
}

function sheetFor(b, blocks = SHEET_BLOCKS) {
  const body = blocks.map(([mark, copy]) =>
    `<section class="piece band" data-kit-piece="${mark}"><h2 class="piece-title">${mark}</h2>` +
    captionFor(b, mark) +
    `<p class="piece-copy">${copy}</p></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body>` +
    `<x-dc><helmet><style>` +
    `x-dc{display:block;width:1440px;overflow:hidden}body{margin:0;font-family:Georgia,serif}` +
    `a{color:#2f5d50;text-decoration:underline}a:hover{color:#1b382f}` +
    `.band{padding:48px 80px}` +
    `</style></helmet>` +
    `<header class="sheet-head band"><h1 class="sheet-title">${b.name}: the pieces as used</h1></header>` +
    body +
    `</x-dc></body></html>`;
}

function drawSeed(boards) {
  mkdirSync(SEED, { recursive: true });
  for (const b of boards) {
    writeFileSync(join(SEED, `B${b.ambition}.dc.html`), artboardFor(b));
    writeFileSync(join(SEED, `I${b.ambition}.dc.html`), innerFor(b));
    writeFileSync(join(SEED, `M${b.ambition}.dc.html`), mobileFor(b));
    writeFileSync(join(SEED, `S${b.ambition}.dc.html`), sheetFor(b));
    writeFileSync(join(SEED, `${b.id}-img1.png`), pngFixture(80, 60));
  }
}

/** The pixel dimensions in a PNG's IHDR: the two numbers that say whether a still is the fold. */
async function pngSize(path) {
  const buf = readFileSync(path);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const run = async (args, opts = {}) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

before(() => {
  if (!existsSync(join(ROOT, "scripts/reference-capture/node_modules/playwright"))) {
    skipReason = "playwright is not installed (scripts/reference-capture/setup.sh); the artboards are UNMEASURED.";
    return;
  }
  TMP = mkdtempSync(join(tmpdir(), "boards-render-"));
  SITE = join(TMP, "site");
  SEED = join(SITE, ".palate/explore/seed");
  // NO SCAFFOLD, NO npm INSTALL, NO ASTRO BUILD. A board is an artboard; the only things this
  // script needs from a project are the registry and the drawn seed.
  mkdirSync(join(SITE, "src/lib"), { recursive: true });
  writeFileSync(join(SITE, "src/lib/variants.ts"), registryFor(BOARDS));
  drawSeed(BOARDS);
  ready = true;
});

after(() => { if (TMP && !process.env.BOARDS_RENDER_KEEP) rmSync(TMP, { recursive: true, force: true }); });
if (process.env.BOARDS_RENDER_KEEP) process.on("exit", () => console.log("KEPT " + TMP));

/** A real PNG: a soft gradient, which is how a website capture actually compresses. */
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

// ------------------------------------------------------------------ pure units
test("the property list is what the canvas panel edits", () => {
  for (const p of ["color", "background-color", "font-family", "font-size", "padding", "grid-template-columns"]) {
    assert.ok(PROPERTY_LIST.includes(p), `${p} is missing from PROPERTY_LIST`);
  }
});

test("the registry parser ignores the commented-out example", () => {
  const src = readFileSync(join(ROOT, "templates/astro-project/src/lib/variants.ts"), "utf8");
  assert.equal(parseRegistry(src).length, 0, "the shipped template registers nothing, and its example is a comment");
  assert.equal(parseRegistry(registryFor(BOARDS)).length, 2);
});

test("the registry parser returns each board's artboard file", () => {
  // The board IS the file. Without this the run falls back to a name derived from the rung, and
  // a registry naming anything else is obeyed by the picker and ignored here.
  const parsed = parseRegistry(registryFor(BOARDS));
  assert.deepEqual(parsed.map((v) => v.artboard), ["B1.dc.html", "B2.dc.html"]);
});

test("the registry parser returns the direction's other three artboards", () => {
  // A direction is FOUR boards. Without this the run can only guess the other three from the
  // rung, and a registry naming anything else is obeyed by the picker and ignored here.
  const [v] = parseRegistry(registryFor(BOARDS));
  assert.deepEqual(v.presentation, { inner: "I1.dc.html", mobile: "M1.dc.html", sheet: "S1.dc.html" });
  assert.equal(parseRegistry(registryFor(BOARDS))[1].presentation.sheet, "S2.dc.html");
});

test("the registry parser returns each direction's per-piece provenance", () => {
  // The per-piece provenance is what the detail sheet's captions print and what gate-explore
  // holds against the kit, so a parser that drops it leaves both checking nothing.
  const [v] = parseRegistry(registryFor(BOARDS));
  assert.deepEqual(v.pieces.navigation, { variation: "NavSimple", donor: "aesop" });
  assert.deepEqual(v.pieces.services, { variation: "BenefitCards", donor: "linear" });
  assert.equal(Object.keys(v.pieces).length, 7);
  // AND THE NESTED DONORS ARE NOT THE BOARD'S OWN. `pieces` carries a `donor:` per entry, so a
  // parser reading the first `donor:` in the object reports the navigation's reference as the
  // direction's, and every downstream check about donors is then about the wrong slug.
  assert.equal(v.donor, "therapy-in-london");
  // Written with `pieces` ABOVE the board's own donor, which is the order that exposes it.
  const above = `export const variants = [
  { id: "b9", name: "The Ledger", artboard: "B9.dc.html",
    pieces: { navigation: { variation: "NavSimple", donor: "aesop" } },
    ambition: 9, donor: "the-modern-house", section: "proof" },
];`;
  const [w] = parseRegistry(above);
  assert.equal(w.donor, "the-modern-house", "the navigation's reference was read as the direction's");
  assert.equal(w.pieces.navigation.donor, "aesop");
});

test("parseKitVariations reads the shipped kit: 17 pieces, 50 variations", () => {
  // The sheet's `data-kit-piece` marks are checked against THIS, so a parser that reads the kit
  // wrongly either refuses a correct sheet or accepts a variation that does not exist.
  const kit = parseKitVariations(readFileSync(join(ROOT, "templates/astro-project/src/lib/kit.ts"), "utf8"));
  assert.equal(kit.size, 17, `the kit parsed as ${kit.size} pieces`);
  let total = 0;
  for (const set of kit.values()) total += set.size;
  assert.equal(total, 50, `the kit parsed as ${total} variations`);
  assert.ok(kit.get("navigation").has("NavSimple"));
  assert.ok(kit.get("navigation").has("NavMobileSheet"));
  assert.ok(kit.get("forms").has("FormEnquiry"));
  assert.ok(kit.get("footer").has("FooterSimple"));
  // The piece ids are the pieces, not the variations: a parser that flattened them would find
  // "NavSimple" as a piece and every mark would validate against the wrong set.
  assert.ok(!kit.has("NavSimple"), "a variation id was read as a piece id");
});

test("an artboard carries the skeleton the editor replaces, verbatim", () => {
  const a = toArtboard({ html: "<p>hi</p>", css: "p{color:red}", name: "b1 Test" });
  assert.ok(a.startsWith("<!doctype html>"));
  assert.ok(a.includes('<script src="./support.js"></script>'));
  assert.ok(a.includes("<x-dc><helmet><style>"));
  assert.ok(a.includes("</x-dc></body></html>"));
});

/**
 * ONE ROW PER DIRECTION, and that is the change a client feels.
 *
 * Boards used to run left to right along a single row, so the canvas read as a strip of home
 * pages. A direction is four boards now (the home, the inner page, the phone, the sheet of the
 * pieces) beside the reference it is drawn from, and a row that carries all five reads as an
 * agency's sign-off spread. So a second direction starts a NEW row rather than sitting 80px to
 * the right of the first one's footer.
 */
test("canvas.json puts the references on row 0 and gives each direction its own row", () => {
  const doc = writeCanvasJson({
    boards: [
      { file: "B1.dc.html", id: "b1", ambition: 1, name: "One", h: 2000, feeling: "quiet", what: "A" },
      { file: "B2.dc.html", id: "b2", ambition: 2, name: "Two", h: 2400, feeling: "loud", what: "B" },
    ],
    refs: [{ position: 1, name: "Ref one", slug: "one", why: "restrained" }],
    out: null,
  });
  const refFrame = doc.artboards.find((a) => a.file === "Ref1.dc.html");
  const b1 = doc.artboards.find((a) => a.file === "B1.dc.html");
  const b2 = doc.artboards.find((a) => a.file === "B2.dc.html");
  assert.equal(refFrame.y, 0);
  assert.equal(b1.y, refFrame.h + 120, "120px between rows");
  assert.equal(b1.x, 0, "the home board leads its row");
  assert.equal(b2.x, 0, "the second direction starts its own row, rather than beside the first");
  assert.equal(b2.y, b1.y + b1.h + 120, "120px between direction rows, measured on the tallest frame");
  assert.equal(b1.h, 2000, "the frame height is the measured height, never a guess");
  assert.equal(doc.launch.view, "canvas");
  assert.ok(doc.annotations.some((a) => a.id === "cal-q"), "the calibration question is annotated");
  for (const a of doc.annotations) assert.match(a.id, /^[A-Za-z0-9_-]{1,40}$/);
});

test("a direction's row is B, its donor, the inner page, the phone and the sheet", () => {
  const doc = writeCanvasJson({
    boards: [
      { file: "B1.dc.html", id: "b1", ambition: 1, name: "One", h: 2000, feeling: "quiet", what: "A",
        presentation: { inner: "I1.dc.html", mobile: "M1.dc.html", sheet: "S1.dc.html" },
        innerH: 1800, mobileH: 3200, sheetH: 2600 },
      { file: "B2.dc.html", id: "b2", ambition: 2, name: "Two", h: 2400, feeling: "loud", what: "B",
        presentation: { inner: "I2.dc.html", mobile: "M2.dc.html", sheet: "S2.dc.html" },
        innerH: 1500, mobileH: 2900, sheetH: 2200 },
    ],
    donors: [donorFor(1)],
    out: null,
  });
  const at = (f) => doc.artboards.find((a) => a.file === f);
  // The x positions are the contract: every direction's row reads down the same columns, so a
  // client scanning two rows compares home with home and phone with phone.
  assert.equal(at("B1.dc.html").x, 0);
  assert.equal(at("D1.dc.html").x, 1520, "the donor does not sit beside its home board");
  assert.equal(at("I1.dc.html").x, 2320, "the inner page is not in the third column");
  assert.equal(at("M1.dc.html").x, 3840, "the phone is not in the fourth column");
  assert.equal(at("M1.dc.html").w, 390, "the phone frame is not 390 wide, so the canvas crops or gutters it");
  assert.equal(at("S1.dc.html").x, 4310, "the sheet is not in the last column");
  for (const f of ["D1.dc.html", "I1.dc.html", "M1.dc.html", "S1.dc.html"]) {
    assert.equal(at(f).y, at("B1.dc.html").y, `${f} is not on its direction's own row`);
  }
  assert.equal(at("I1.dc.html").h, 1800, "the inner frame declares something other than its measured height");
  assert.equal(at("M1.dc.html").h, 3200);
  assert.equal(at("S1.dc.html").h, 2600);
  // The row is as tall as its TALLEST frame, which here is the phone at 3200, not the home board.
  assert.equal(at("B2.dc.html").y, at("B1.dc.html").y + 3200 + 120,
    "the next row was not stepped past the tallest frame in this one, so two rows overlap");

  for (const id of ["inner-b1", "mobile-b1", "sheet-b1", "donor-b1", "board-b1"]) {
    assert.ok(doc.annotations.some((a) => a.id === id), `no ${id} annotation, so the frame is unlabelled`);
  }
  assert.match(doc.annotations.find((a) => a.id === "inner-b1").text, /primary service page/i);
  assert.match(doc.annotations.find((a) => a.id === "mobile-b1").text, /390/);
  assert.match(doc.annotations.find((a) => a.id === "sheet-b1").text, /navigation/i);
  // Client-facing again: the note under the home board says "direction", not "rung".
  assert.match(doc.annotations.find((a) => a.id === "board-b1").text, /direction 1 of 2/i);
  assert.doesNotMatch(doc.annotations.find((a) => a.id === "board-b1").text, /rung/i);
  for (const a of doc.annotations) assert.match(a.id, /^[A-Za-z0-9_-]{1,40}$/);
});

test("with no donor the other frames keep their columns", () => {
  // A missing donor must not shuffle the inner page into the donor's column: the row would then
  // read differently from the row above it, which is the one thing a comparison spread cannot do.
  const doc = writeCanvasJson({
    boards: [{ file: "B1.dc.html", id: "b1", ambition: 1, name: "One", h: 900, feeling: "quiet", what: "A",
      presentation: { inner: "I1.dc.html", mobile: "M1.dc.html", sheet: "S1.dc.html" },
      innerH: 900, mobileH: 900, sheetH: 900 }],
    donors: [],
    out: null,
  });
  const at = (f) => doc.artboards.find((a) => a.file === f);
  assert.equal(doc.artboards.some((a) => a.file.startsWith("D")), false, "a donor card was drawn with no donor");
  assert.equal(at("I1.dc.html").x, 2320);
  assert.equal(at("M1.dc.html").x, 3840);
  assert.equal(at("S1.dc.html").x, 4310);
});

// ------------------------------------------------------- the artboard contract
const GOOD = `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style>x-dc{display:block;width:1440px;overflow:hidden}a{color:#000}a:hover{color:#333}</style></helmet><header class="nav" data-section-id="b1-navigation"><a class="nav-logo" href="#">Eastcoast</a><a class="nav-cta" href="#">Ring</a></header><section class="hero" data-section-id="b1-hero"><h1 class="hero-title">Hogan Street</h1><img src="b1-img1.jpg" alt=""></section><section class="services" data-section-id="b1-services"><ul class="list"><li class="row">Doors</li></ul></section><aside class="motion-note" data-palate-motion="">On load the column rules draw down over 800ms on one curve, then hold; nothing loops.</aside><section class="cta" data-section-id="b1-cta"><a class="cta-btn" href="#">Book</a></section><footer class="footer" data-section-id="b1-footer"><p class="footer-line">Ballina</p></footer></x-dc></body></html>`;

const fixtureDirs = [];
function fixtureDirWith(sizes) {
  const dir = mkdtempSync(join(tmpdir(), "artboard-fixture-"));
  fixtureDirs.push(dir);
  for (const [name, bytes] of Object.entries(sizes)) writeFileSync(join(dir, name), Buffer.alloc(bytes, 0x41));
  return dir;
}
after(() => { for (const d of fixtureDirs) rmSync(d, { recursive: true, force: true }); });

test("a conforming artboard validates", () => {
  const r = validateArtboard(GOOD, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, true, r.problems.join("; "));
});

// THE FRAME WIDTH IS A CONTRACT, NOT A CONVENTION. The canvas neither scales nor crops a
// frame, so a board drawn at some other width is cropped or floats in a gutter on the canvas
// while every other check passes. The doctrine has always said 1440; nothing held it there.
test("an artboard with no 1440 frame rule is refused", () => {
  const r = validateArtboard(GOOD.replace("x-dc{display:block;width:1440px;overflow:hidden}", ""), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /1440/);
});

test("a frame rule at any other width is refused", () => {
  const r = validateArtboard(GOOD.replace("width:1440px", "width:1280px"), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /1440/);
});

// Spacing is a matter of taste in a stylesheet, so the check reads the rule rather than the
// spelling: refusing `x-dc { width: 1440px }` would be refusing a correct board.
test("the frame rule is read whitespace-tolerantly", () => {
  const r = validateArtboard(GOOD.replace("x-dc{display:block;width:1440px;overflow:hidden}", "x-dc {\n  display: block;\n  width: 1440px;\n  overflow: hidden;\n}\n"), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("a missing hero mark is named", () => {
  const r = validateArtboard(GOOD.replace(' data-section-id="b1-hero"', ""), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /b1-hero/);
});

test("a whole page is required: nav, cta and footer marks are each named when missing", () => {
  for (const piece of ["navigation", "cta", "footer"]) {
    const r = validateArtboard(GOOD.replace(` data-section-id="b1-${piece}"`, ""), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
    assert.equal(r.ok, false, piece);
    assert.match(r.problems.join("\n"), new RegExp(`b1-${piece}`));
  }
});

// A MARKED ROOT IS A SECTIONING ELEMENT. gate-fidelity scopes its whole comparison to the
// marked hero and hides everything else on the page, so a `<div>` carrying the mark measured as
// setting no type, no accent and no scale, and the skeleton check that tells a lifted hero from
// a rebuilt one stopped running without saying so.
test("a marked root on a div is refused, naming the tag", () => {
  const r = validateArtboard(
    GOOD.replace('<section class="hero" data-section-id="b1-hero">', '<div class="hero" data-section-id="b1-hero">')
      .replace("</section><section class=\"services\"", "</div><section class=\"services\""),
    { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) },
  );
  assert.equal(r.ok, false);
  const said = r.problems.join("\n");
  assert.match(said, /<div>/, `the refusal does not name the offending tag:\n${said}`);
  assert.match(said, /b1-hero/, `the refusal does not name the mark that sits on it:\n${said}`);
});

test("a header and a footer are sectioning elements too, so a whole board validates", () => {
  const r = validateArtboard(GOOD, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("data-srcset is not srcset, and a conforming board is not refused for carrying one", () => {
  const r = validateArtboard(
    GOOD.replace('<img src="b1-img1.jpg" alt="">', '<img src="b1-img1.jpg" data-srcset="handled by a loader" alt="">'),
    { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) },
  );
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("the registry's own inner section must be on the board", () => {
  const r = validateArtboard(GOOD, { id: "b1", section: "pricing", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /b1-pricing/);
});

test("the planned motion must be written on the board as text", () => {
  const r = validateArtboard(GOOD.replace(/<aside class="motion-note"[^>]*>[^<]*<\/aside>/, ""), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /motion/);
  const short = validateArtboard(GOOD.replace(/(<aside class="motion-note"[^>]*>)[^<]*/, "$1fades in"), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(short.ok, false);
  assert.match(short.problems.join("\n"), /motion/);
});

test("the hero is found by name, not by position (nav first is fine)", () => {
  // An artboard opens with its navigation, so a hero read as "the first mark" is never the hero.
  assert.match(GOOD, /data-section-id="b1-navigation"[\s\S]*data-section-id="b1-hero"/);
  const r = validateArtboard(GOOD, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("a remote image is refused", () => {
  // NAMED AS REMOTE, not as a path with slashes in it. The canvas has no egress, so a remote
  // src renders as a broken box and the correction is "put the file beside the artboard", which
  // is a different instruction from "you wrote a subdirectory".
  const r = validateArtboard(GOOD.replace("b1-img1.jpg", "https://example.com/x.jpg"), { id: "b1", section: "services", dir: fixtureDirWith({}) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /is remote or inline/i);
  const inline = validateArtboard(GOOD.replace("b1-img1.jpg", "data:image/png;base64,AAAA"), { id: "b1", section: "services", dir: fixtureDirWith({}) });
  assert.equal(inline.ok, false);
  assert.match(inline.problems.join("\n"), /is remote or inline/i);
  const nested = validateArtboard(GOOD.replace("b1-img1.jpg", "img/b1-img1.jpg"), { id: "b1", section: "services", dir: fixtureDirWith({}) });
  assert.equal(nested.ok, false);
  assert.match(nested.problems.join("\n"), /bare filename/i);
});

test("an image that is not beside the artboard is refused", () => {
  const r = validateArtboard(GOOD, { id: "b1", section: "services", dir: fixtureDirWith({}) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /not beside the artboard/);
});

test("an oversized image is refused at 70 KB", () => {
  const r = validateArtboard(GOOD, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 71 * 1024 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /70 KB/);
});

test("a second script tag is refused", () => {
  const r = validateArtboard(GOOD.replace("</x-dc>", "<script>alert(1)</script></x-dc>"), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /script/);
});

test("a stylesheet from anywhere but Google Fonts is refused", () => {
  const r = validateArtboard(
    GOOD.replace("</helmet>", '</helmet><link rel="stylesheet" href="https://cdn.example.com/x.css">'),
    { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) },
  );
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /Google Fonts/);
});

test("Google's own three-link embed validates, preconnects included", () => {
  // The standard snippet is a preconnect to fonts.googleapis.com, a crossorigin preconnect to
  // fonts.gstatic.com (where the face files actually come from) and the stylesheet. Refusing the
  // gstatic preconnect sent an operator looking for a fault in a board that was correct.
  const embed = '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Simula&display=swap">';
  const r = validateArtboard(GOOD.replace("</helmet>", `${embed}</helmet>`), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("a remote stylesheet is refused however its href is quoted", () => {
  // Matching only href="..." was a false accept: a single-quoted or bare href produced no match
  // and therefore no problem, on the one rule that says nothing else may be fetched.
  for (const href of ['"https://cdn.evil.com/x.css"', "'https://cdn.evil.com/x.css'", "https://cdn.evil.com/x.css"]) {
    const r = validateArtboard(
      GOOD.replace("</helmet>", `<link rel="stylesheet" href=${href}></helmet>`),
      { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) },
    );
    assert.equal(r.ok, false, `href=${href} was accepted`);
    assert.match(r.problems.join("\n"), /cdn\.evil\.com.*not Google Fonts/);
  }
});

test("a css background is held to the same rules as an img", () => {
  // A hero photograph is usually a background, not an <img>, so this was the commonest picture
  // on a board and the only one that was never checked for existence or for the ceiling.
  const withBg = (url) => GOOD.replace("a{color:#000}", `a{color:#000}.hero{background-image:url(${url})}`);
  const dir = fixtureDirWith({ "b1-img1.jpg": 1000, "hero.jpg": 1000, "big.jpg": 71 * 1024 });

  const rooted = validateArtboard(withBg("/img/hero.jpg"), { id: "b1", section: "services", dir });
  assert.equal(rooted.ok, false, "a root-relative background was accepted and renders blank");
  assert.match(rooted.problems.join("\n"), /bare filename/);

  const nested = validateArtboard(withBg("pics/hero.jpg"), { id: "b1", section: "services", dir });
  assert.equal(nested.ok, false, "a nested background path was accepted and renders blank");
  assert.match(nested.problems.join("\n"), /bare filename/);

  const missing = validateArtboard(withBg("gone.jpg"), { id: "b1", section: "services", dir });
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join("\n"), /not beside the artboard/);

  const oversized = validateArtboard(withBg("big.jpg"), { id: "b1", section: "services", dir });
  assert.equal(oversized.ok, false);
  assert.match(oversized.problems.join("\n"), /70 KB/);

  const good = validateArtboard(withBg("hero.jpg"), { id: "b1", section: "services", dir });
  assert.equal(good.ok, true, good.problems.join("; "));
});

test("a fragment url and a data URI are not files that have to exist", () => {
  // `filter: url(#grain)` names an element in this very document, and grain is a canonical
  // technique the bold rungs reach for. A face inlined as a data URI is already here.
  const r = validateArtboard(
    GOOD.replace("a{color:#000}", "a{color:#000}.hero{filter:url(#grain)}@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)}"),
    { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) },
  );
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("a file the canvas cannot resolve as an image is refused even when it is right there", () => {
  // It exists, it is small, and it is not a picture. The canvas renders a broken box for it and
  // says nothing, so the extension is checked rather than assumed from the filename being local.
  const dir = fixtureDirWith({ "b1-img1.jpg": 1000, "notes.txt": 200, "Simula.woff2": 4000 });
  const notAnImage = validateArtboard(GOOD.replace("b1-img1.jpg", "notes.txt"), { id: "b1", section: "services", dir });
  assert.equal(notAnImage.ok, false);
  assert.match(notAnImage.problems.join("\n"), /not an image type/);
  // A face beside the artboard is the same refusal: the contract says non-Google faces travel as
  // @font-face data URIs, because the canvas will not fetch a file it was not handed.
  const face = validateArtboard(
    GOOD.replace("a{color:#000}", "a{color:#000}@font-face{font-family:Simula;src:url(Simula.woff2)}"),
    { id: "b1", section: "services", dir },
  );
  assert.equal(face.ok, false);
  assert.match(face.problems.join("\n"), /not an image type|data URIs/);
});

test("a srcset is refused, because it overrides the bare filename", () => {
  const r = validateArtboard(
    GOOD.replace('<img src="b1-img1.jpg" alt="">', '<img src="b1-img1.jpg" srcset="https://cdn.example.com/x.jpg 2x" alt="">'),
    { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) },
  );
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /srcset/);
});

test("a remote css url() is refused and a Google Fonts one is not", () => {
  const remote = validateArtboard(
    GOOD.replace("a{color:#000}", "a{color:#000}.hero{background-image:url(https://cdn.example.com/h.jpg)}"),
    { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) },
  );
  assert.equal(remote.ok, false);
  assert.match(remote.problems.join("\n"), /is remote/);
  const fonts = validateArtboard(
    GOOD.replace("a{color:#000}", '@import url("https://fonts.googleapis.com/css2?family=Simula");a{color:#000}'),
    { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) },
  );
  assert.equal(fonts.ok, true, fonts.problems.join("; "));
});

test("a link hover state must be defined, because the canvas asks for one", () => {
  const r = validateArtboard(GOOD.replace("a:hover{color:#333}", ""), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /a:hover/);
});

test("the skeleton the editor replaces is required verbatim", () => {
  // An extra tag in the head is enough. The editor looks for this exact shape and a head it does
  // not recognise stops the artboard being editable with nothing saying so, which is why this is
  // checked as a whole string rather than as a set of parts.
  const extra = GOOD.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width">');
  const r = validateArtboard(extra, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /skeleton/);
  // And a support.js spelled differently, which is the way it actually goes wrong.
  const spelled = validateArtboard(GOOD.replace('<script src="./support.js"></script>', '<script src="support.js"></script>'), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(spelled.ok, false);
  assert.match(spelled.problems.join("\n"), /skeleton|support\.js/);
});

test("blind structure is refused: fewer than 60% of block elements carry a class", () => {
  const blind = GOOD.replace(/ class="[^"]*"/g, "");
  const r = validateArtboard(blind, { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /class/);
});

test("stampKeys gives every element a stable data-palate-k and is idempotent", () => {
  const once = stampKeys(GOOD);
  const twice = stampKeys(once);
  assert.equal(once, twice);
  const keys = [...once.matchAll(/data-palate-k="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 7, `only ${keys.length} elements were keyed`);
  assert.equal(new Set(keys).size, keys.length, "a key was repeated, which makes two elements the same element");
  assert.ok(!/<(html|head|body|x-dc|helmet|script|style|meta)\b[^>]*data-palate-k/.test(once),
    "the skeleton the editor replaces was keyed, which changes the shape it looks for");
});

test("a board that gains an element is keyed without repeating a key", () => {
  // THE COUNTER HAS TO START PAST THE HIGHEST KEY ALREADY THERE. Skipping keyed elements is not
  // enough: a board keyed k0..k8 that the client adds a paragraph to came back with a SECOND k0,
  // so two different elements carried one key and the read-back matched whichever it saw first.
  const once = stampKeys(GOOD);
  const before = [...once.matchAll(/data-palate-k="([^"]*)"/g)].map((m) => m[1]);
  const grown = once.replace("</footer>", '<p class="footer-extra">Added on the canvas</p></footer>');
  const twice = stampKeys(grown);
  const after = [...twice.matchAll(/data-palate-k="([^"]*)"/g)].map((m) => m[1]);

  assert.equal(after.length, before.length + 1, "the new element was not keyed");
  assert.equal(new Set(after).size, after.length, `a key was repeated: ${after.join(",")}`);
  assert.deepEqual(after.slice(0, before.length), before, "the keys the client's canvas was published with were renumbered");
  assert.match(/<p class="footer-extra"[^>]*data-palate-k="([^"]*)"/.exec(twice)[1], /^k\d+$/);
  assert.ok(!before.includes(/<p class="footer-extra"[^>]*data-palate-k="([^"]*)"/.exec(twice)[1]),
    "the added element reused a key that was already on the board");
});

test("a stamped artboard still validates, so the seed can be rewritten in place", () => {
  const r = validateArtboard(stampKeys(GOOD), { id: "b1", section: "services", dir: fixtureDirWith({ "b1-img1.jpg": 1000 }) });
  assert.equal(r.ok, true, r.problems.join("; "));
});

// ------------------------------------------------------ the other three kinds
/**
 * A DIRECTION IS FOUR BOARDS, and each kind is held to its own contract.
 *
 * The shared rules (skeleton, one script, images, links, class ratio, a:hover) are the same for
 * all four, because they are about what a canvas can render. What differs is the frame width,
 * which marks a board of that kind owes, and whether the motion has to be written on it: the
 * motion belongs to the home board, and repeating it on the mobile and the sheet would be three
 * copies of one plan drifting apart.
 */
const KIT = parseKitVariations(readFileSync(join(ROOT, "templates/astro-project/src/lib/kit.ts"), "utf8"));
const B = BOARDS[0];
const asInner = () => innerFor(B);
const asMobile = () => mobileFor(B);
const asSheet = (blocks) => sheetFor(B, blocks);
const val = (html, over = {}) => validateArtboard(html, { id: "b1", dir: fixtureDirWith({}), kit: KIT, ...over });

test("the inner page validates, and its four marks are each named when missing", () => {
  assert.equal(val(asInner(), { kind: "inner" }).ok, true, val(asInner(), { kind: "inner" }).problems.join("; "));
  for (const piece of ["navigation", "hero", "cta", "footer"]) {
    const r = val(asInner().replace(` data-section-id="b1-inner-${piece}"`, ""), { kind: "inner" });
    assert.equal(r.ok, false, piece);
    assert.match(r.problems.join("\n"), new RegExp(`b1-inner-${piece}`));
  }
});

test("the inner page is 1440 wide and needs no motion note of its own", () => {
  const narrow = val(asInner().replace("width:1440px", "width:390px"), { kind: "inner" });
  assert.equal(narrow.ok, false);
  assert.match(narrow.problems.join("\n"), /1440/);
  // The fixture carries no motion block at all, and it validated above. Stated here so a future
  // change that makes the motion note universal has to change a test that says why it is not.
  assert.ok(!/data-palate-motion/.test(asInner()), "the inner fixture carries a motion note, so this proves nothing");
});

test("the mobile board must be 390 wide, and 1440 is refused", () => {
  assert.equal(val(asMobile(), { kind: "mobile" }).ok, true, val(asMobile(), { kind: "mobile" }).problems.join("; "));
  // THE WHOLE POINT OF THE MOBILE BOARD IS ITS WIDTH. A frame neither scales nor crops, so a
  // "mobile" board drawn at 1440 is a second desktop board that the client signs off as a phone.
  const wide = val(asMobile().replace("width:390px", "width:1440px"), { kind: "mobile" });
  assert.equal(wide.ok, false, "a 1440-wide mobile board was accepted as the phone");
  assert.match(wide.problems.join("\n"), /390/);
});

test("the mobile board is the whole page too, and each missing mark is named", () => {
  for (const piece of ["navigation", "hero", "cta", "footer"]) {
    const r = val(asMobile().replace(` data-section-id="b1-${piece}"`, ""), { kind: "mobile" });
    assert.equal(r.ok, false, piece);
    assert.match(r.problems.join("\n"), new RegExp(`b1-${piece}`));
  }
});

test("the detail sheet validates when every piece it uses is a real kit variation", () => {
  const r = val(asSheet(), { kind: "sheet" });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(validateSheet(asSheet(), { id: "b1", kit: KIT }).ok, true);
});

test("a sheet missing any required block is refused, naming the block", () => {
  // The eight are the minimum because they are what a client signs off: how the navigation looks
  // closed AND open, what the footer carries, how the closing band asks, how the enquiry form
  // looks filled AND wrong, one card, one trust strip. A sheet of heroes proves none of it.
  const required = [
    ["navigation:NavSimple:default", /navigation.*default/],
    ["navigation:NavMobileSheet:open", /navigation.*open/],
    ["footer:FooterSimple:default", /footer/],
    ["cta:CtaClosing:default", /cta/],
    ["forms:FormEnquiry:default", /forms.*default/],
    ["forms:FormEnquiry:error", /forms.*error/],
    ["benefits:BenefitCards:default", /benefits|usecases|casestudies/],
    ["trust:TrustRatings:default", /trust/],
  ];
  for (const [mark, said] of required) {
    const r = val(asSheet(SHEET_BLOCKS.filter(([m]) => m !== mark)), { kind: "sheet" });
    assert.equal(r.ok, false, `a sheet with no ${mark} was accepted`);
    assert.match(r.problems.join("\n"), said, `the refusal does not name what is missing (${mark})`);
  }
});

test("a card from usecases or casestudies satisfies the card requirement", () => {
  for (const mark of ["usecases:UseCasesAudience:default", "casestudies:CaseCards:default"]) {
    const blocks = SHEET_BLOCKS.filter(([m]) => m !== "benefits:BenefitCards:default")
      .concat([[mark, "One story: the job, the constraint, the price and how long it took."]]);
    const r = val(asSheet(blocks), { kind: "sheet" });
    assert.equal(r.ok, true, `${mark} did not satisfy the card requirement: ${r.problems.join("; ")}`);
  }
});

test("a sheet naming a piece or a variation the kit does not have is refused, naming it", () => {
  const bogusPiece = SHEET_BLOCKS.concat([["carousel:SpinnyThing:default", "A carousel nobody asked for and no kit piece carries."]]);
  const p = val(asSheet(bogusPiece), { kind: "sheet" });
  assert.equal(p.ok, false, "a sheet showing a piece the kit does not have was accepted");
  assert.match(p.problems.join("\n"), /carousel/);

  const bogusVariation = SHEET_BLOCKS.map(([m, c]) => (m === "footer:FooterSimple:default" ? ["footer:FooterFancy:default", c] : [m, c]));
  const v = val(asSheet(bogusVariation), { kind: "sheet" });
  assert.equal(v.ok, false, "a sheet naming a variation that does not exist was accepted");
  assert.match(v.problems.join("\n"), /FooterFancy/);

  const malformed = SHEET_BLOCKS.concat([["justapiece", "A mark with no variation and no state."]]);
  const m = val(asSheet(malformed), { kind: "sheet" });
  assert.equal(m.ok, false, "a mark that is not piece:variation:state was accepted");
  assert.match(m.problems.join("\n"), /justapiece/);
});

test("a type specimen is refused as a sheet, and the rule is named", () => {
  // THE SHEET JAKE REJECTED ON 9 SEPTEMBER. Half of every board was an Ag ramp, swatches and a
  // button pair: the type DISPLAYED rather than USED, identical in layout across every direction.
  // A sheet with real blocks and no copy in them is that sheet with different markup.
  const specimen = asSheet(SHEET_BLOCKS.map(([m]) => [m, ""]))
    .replace(/<h2 class="piece-title">[^<]*<\/h2>/g, '<h2 class="piece-title">Ag</h2>')
    .replace(/<p class="piece-from">[^<]*<\/p>/g, "")
    .replace(/<h1 class="sheet-title">[^<]*<\/h1>/, '<h1 class="sheet-title">Aa</h1>');
  const r = val(specimen, { kind: "sheet" });
  assert.equal(r.ok, false, "a type specimen with no copy on it was accepted as the detail sheet");
  assert.match(r.problems.join("\n"), /120 characters|specimen/i);
});

test("a state the piece does not implement is refused, and default is implicit", () => {
  // A sheet claiming a state the kit does not build is the same promise as a variation that
  // does not exist: the client signs off a form error the build has no way to render.
  const bogus = SHEET_BLOCKS.map(([m, c]) => (m === "trust:TrustRatings:default" ? ["trust:TrustRatings:nonsense", c] : [m, c]));
  const r = val(asSheet(bogus), { kind: "sheet" });
  assert.equal(r.ok, false, "a state the kit does not declare was accepted");
  assert.match(r.problems.join("\n"), /nonsense/);
  // `default` is the resting state and no piece declares it, so it must never be refused: the
  // fixture is six blocks of :default and it validates.
  const kitStates = KIT.get("trust").get("TrustRatings");
  assert.ok(!kitStates.has("default"), "the kit declares default, so this proves nothing");
  assert.equal(val(asSheet(), { kind: "sheet" }).ok, true);
});

test("two data-kit-piece attributes on one tag are refused", () => {
  // The second one is invisible: a parser reading attributes takes the first and the block is
  // filed as one piece while its markup claims two, which is how a required block goes missing
  // on a sheet that says it is there.
  const doubled = asSheet().replace('data-kit-piece="cta:CtaClosing:default"',
    'data-kit-piece="cta:CtaClosing:default" data-kit-piece="footer:FooterSimple:default"');
  const r = val(doubled, { kind: "sheet" });
  assert.equal(r.ok, false, "a tag carrying two data-kit-piece attributes was accepted");
  assert.match(r.problems.join("\n"), /two data-kit-piece|more than one/i);
});

test("an annotation id stays inside the 40 characters a canvas id allows", () => {
  // `mobile-` is the longest prefix, so the id is what bounds the slice. A board id at the
  // limit produced a 41-character annotation id, which the canvas rejects and nothing said so.
  const longId = "b".repeat(60);
  const doc = writeCanvasJson({
    boards: [{ file: "B1.dc.html", id: longId, ambition: 1, name: "One", h: 900, feeling: "quiet", what: "A",
      presentation: { inner: "I1.dc.html", mobile: "M1.dc.html", sheet: "S1.dc.html" },
      innerH: 900, mobileH: 900, sheetH: 900 }],
    out: null,
  });
  assert.ok(doc.annotations.some((a) => a.id.startsWith("mobile-")), "no mobile annotation to measure");
  for (const a of doc.annotations) assert.match(a.id, /^[A-Za-z0-9_-]{1,40}$/, `${a.id} is ${a.id.length} characters`);
});

test("every required block's caption names its variation and the reference it came from", () => {
  // THE ONLY PLACE A PIECE'S DONOR IS EVER WRITTEN WHERE A CLIENT CAN READ IT. The sheet is what
  // gets signed off; a block with no provenance under it is a piece whose craft came from
  // wherever the author happened to be looking, and nobody can tell afterwards.
  const ok = validateSheetCaptions(asSheet(), { id: "b1", pieces: B.pieces });
  assert.equal(ok.ok, true, ok.problems.join("; "));

  const noDonor = asSheet().replace(", drawn from aesop.", ".");
  const r = validateSheetCaptions(noDonor, { id: "b1", pieces: B.pieces });
  assert.equal(r.ok, false, "a navigation block whose caption names no donor was accepted");
  assert.match(r.problems.join("\n"), /navigation/);
  assert.match(r.problems.join("\n"), /aesop/);

  // The variation half: a caption that says "the footer" and nothing else leaves the client
  // approving a footer whose kit variation is decided after the sign-off.
  const noVariation = asSheet()
    .replace('<h2 class="piece-title">footer:FooterSimple:default</h2>', '<h2 class="piece-title">The footer</h2>')
    .replace("Footer: FooterSimple, drawn from loom.", "Drawn from loom.");
  const f = validateSheetCaptions(noVariation, { id: "b1", pieces: B.pieces });
  assert.equal(f.ok, false, "a footer block whose caption names no variation was accepted");
  assert.match(f.problems.join("\n"), /FooterSimple/);
});

test("the card and the trust strip are checked too, not just the pieces named by their own id", () => {
  // THE TWO BLOCKS MOST LIKELY TO CARRY INVENTED COPY. The card is registered under the
  // direction's own section key ("services"), not under "benefits", so a lookup by piece id
  // found nothing for either of them and they were the two nobody checked.
  const noTrustDonor = asSheet().replace("Trust: TrustRatings, drawn from lava-dental.", "Trust: TrustRatings.");
  const t = validateSheetCaptions(noTrustDonor, { id: "b1", pieces: B.pieces });
  assert.equal(t.ok, false, "a trust strip whose caption names no donor was accepted");
  assert.match(t.problems.join("\n"), /trust:TrustRatings:default/);
  assert.match(t.problems.join("\n"), /lava-dental/);

  const noCardVariation = asSheet()
    .replace('<h2 class="piece-title">benefits:BenefitCards:default</h2>', '<h2 class="piece-title">One card</h2>')
    .replace("Benefits: BenefitCards, drawn from linear.", "Drawn from linear.");
  const c = validateSheetCaptions(noCardVariation, { id: "b1", pieces: B.pieces });
  assert.equal(c.ok, false, "a card whose caption names no kit variation was accepted");
  assert.match(c.problems.join("\n"), /benefits:BenefitCards:default/);
  assert.match(c.problems.join("\n"), /BenefitCards/);

  // AND ALL EIGHT REQUIRED BLOCKS ARE REACHED. A sheet with no provenance anywhere must produce
  // one finding per required block; a lookup that quietly resolves to nothing shows up here as a
  // smaller number rather than as a passing sheet.
  const bare = asSheet().replace(/<p class="piece-from">[^<]*<\/p>/g, '<p class="piece-from">NO PROVENANCE AT ALL HERE.</p>');
  const r = validateSheetCaptions(bare, { id: "b1", pieces: B.pieces });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 8, `only ${r.problems.length} of the eight required blocks were checked`);
});

test("the caption check reads the block it is under, not the sheet as a whole", () => {
  // A donor named once in a heading at the top would otherwise satisfy every block below it,
  // which is exactly the sheet that carries no provenance at all.
  const topOnly = asSheet().replace(", drawn from aesop.", ".")
    .replace('<h1 class="sheet-title">', '<h1 class="sheet-title">aesop NavSimple ');
  const r = validateSheetCaptions(topOnly, { id: "b1", pieces: B.pieces });
  assert.equal(r.ok, false, "a donor named in the sheet's heading stood in for the block's own caption");
});

test("a direction that declared no pieces is not refused by the caption check", () => {
  // gate-explore owns "this direction declared no provenance". Reporting the same absence here,
  // in different words, would make one fault read as two on every board.
  const r = validateSheetCaptions(asSheet(), { id: "b1", pieces: null });
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("the shared rules hold on every kind, so a broken image is refused on the sheet too", () => {
  const withImg = asSheet().replace("<header class=\"sheet-head", '<img src="https://example.com/x.jpg" alt=""><header class="sheet-head');
  const r = val(withImg, { kind: "sheet" });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /is remote or inline/i);
  const noHover = val(asMobile().replace("a:hover{color:#1b382f}", ""), { kind: "mobile" });
  assert.equal(noHover.ok, false);
  assert.match(noHover.problems.join("\n"), /a:hover/);
});

// ---------------------------------------------------------------- the real run
test("the artboards are validated, keyed, measured and archived", async (t) => {
  if (!ready) return t.skip(skipReason);
  const r = await run([SITE]);
  assert.equal(r.status, 0, `boards-render failed:\n${r.stderr}`);

  for (const f of ["B1.dc.html", "B2.dc.html", "canvas.json", "README.md"]) {
    assert.ok(existsSync(join(SEED, f)), `${f} is missing from the seed`);
  }

  // THE OTHER THREE BOARDS OF EACH DIRECTION, keyed, archived and shot like the home board.
  for (const b of BOARDS) {
    const shots = join(SITE, ".palate/explore/shots", b.id);
    for (const [kind, file] of [["inner", `I${b.ambition}.dc.html`], ["mobile", `M${b.ambition}.dc.html`], ["sheet", `S${b.ambition}.dc.html`]]) {
      const seedFile = readFileSync(join(SEED, file), "utf8");
      assert.match(seedFile, /data-palate-k=/, `${file} was never keyed, so the canvas read-back can only align by position`);
      const archived = readFileSync(join(shots, `${kind}.html`), "utf8");
      assert.equal(archived, seedFile, `${b.id}'s archived ${kind} is not the artboard the client sees`);
      for (const p of [join(shots, `${kind}.png`), join(SITE, "public/_explore", `${b.id}-${kind}.png`)]) {
        assert.ok(existsSync(p), `${p} is missing`);
        assert.ok(statSync(p).size > 1024, `${p} is ${statSync(p).size} bytes, which is not a rendered board`);
      }
    }
    // The phone still is 390 wide, or the client signs off a desktop board captioned "mobile".
    assert.equal((await pngSize(join(shots, "mobile.png"))).w, 390,
      `${b.id}'s mobile.png is not 390 wide, so it is the desktop board again`);
    // The inner still is the fold, like the home board's hero: it is what the judge compares.
    assert.equal((await pngSize(join(shots, "inner.png"))).h, 900, `${b.id}'s inner.png is not the 1440x900 entrance`);
    assert.equal((await pngSize(join(shots, "inner.png"))).w, 1440);
    // The sheet is the WHOLE sheet: a fold of it proves nothing about the states below it.
    assert.ok((await pngSize(join(shots, "sheet.png"))).h > 900, `${b.id}'s sheet.png is a fold, not the sheet`);
  }

  for (const b of BOARDS) {
    const file = `B${b.ambition}.dc.html`;
    const seedFile = readFileSync(join(SEED, file), "utf8");
    // THE KEYS ARE WRITTEN BACK INTO THE SEED, or the canvas the client is looking at and the
    // copy the read-back diffs against are two different documents.
    const keys = [...seedFile.matchAll(/data-palate-k="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(keys.length >= 7, `${file} carries ${keys.length} element keys, so the read-back can only align by position`);
    assert.equal(new Set(keys).size, keys.length, `${file} repeats an element key`);
    assert.ok(seedFile.startsWith("<!doctype html>"), `${file} lost its doctype`);
    assert.ok(seedFile.includes('<script src="./support.js"></script>'), `${file} lost the support line`);

    const shots = join(SITE, ".palate/explore/shots", b.id);
    const archived = readFileSync(join(shots, "rendered.html"), "utf8");
    assert.equal(archived, seedFile, `${b.id}'s archived render is not the artboard the client sees`);
    assert.match(archived, new RegExp(`data-section-id="${b.id}-hero"`),
      `${b.id}'s archived render carries no hero mark, so nothing downstream can identify its sections`);
    assert.match(archived, /data-palate-k=/, `${b.id}'s archived render is unkeyed`);
    // The archive travels with its pictures, or it renders broken the day it is read.
    assert.ok(existsSync(join(shots, `${b.id}-img1.png`)), `${b.id}'s archived render lost its image`);

    for (const p of [
      join(shots, "hero.png"), join(SITE, "public/_explore", `${b.id}.png`),
      join(shots, "full.png"), join(SITE, "public/_explore", `${b.id}-full.png`),
    ]) {
      assert.ok(existsSync(p), `${p} is missing`);
      assert.ok(statSync(p).size > 1024, `${p} is ${statSync(p).size} bytes, which is not a rendered board`);
    }
    // THE WHOLE BOARD IS A DIFFERENT PICTURE FROM THE TOP OF IT. /explore's link says it opens
    // the still at full size, and for the whole of the board format's life it opened the same
    // 1440x900 crop the card already showed. The fixture artboards are taller than the fold, so
    // a full-page shot that is not bigger than the hero shot is the hero shot under a new name.
    assert.ok(statSync(join(shots, "full.png")).size > statSync(join(shots, "hero.png")).size,
      `${b.id}'s full.png is no larger than its hero.png, so the whole-board still is the fold again`);
    const heroPx = await pngSize(join(shots, "hero.png"));
    const fullPx = await pngSize(join(shots, "full.png"));
    assert.equal(heroPx.h, 900, `${b.id}'s hero.png is ${heroPx.h}px tall; the fidelity gate reads it as the 1440x900 entrance`);
    assert.ok(fullPx.h > heroPx.h,
      `${b.id}'s full.png is ${fullPx.h}px tall against a ${heroPx.h}px hero, so it is not the whole board`);
  }

  const canvas = JSON.parse(readFileSync(join(SEED, "canvas.json"), "utf8"));
  assert.deepEqual(canvas.artboards.map((a) => a.file),
    ["B1.dc.html", "I1.dc.html", "M1.dc.html", "S1.dc.html", "B2.dc.html", "I2.dc.html", "M2.dc.html", "S2.dc.html"]);
  const f1 = canvas.artboards.find((a) => a.file === "B1.dc.html");
  const f2 = canvas.artboards.find((a) => a.file === "B2.dc.html");
  assert.equal(f1.w, 1440);
  assert.equal(f2.x, 0, "the second direction starts its own row");
  assert.ok(f2.y >= f1.y + f1.h + 120, "the second direction's row overlaps the first");
  assert.equal(f1.y, 0, "with no calibration row the first direction is row 0");
  // A frame neither scales nor crops, so a height that is not the measured one clips the board.
  for (const f of canvas.artboards) assert.ok(f.h >= 200, `${f.file} declares ${f.h}px, which is not a measured board`);
  assert.equal(canvas.annotations.length, 8, "each direction's four frames are each annotated");
  assert.equal(canvas.launch.view, "canvas");
  assert.match(r.stdout, /artboard\(s\) validated, keyed, measured and archived/);

  // THE SEED README IS THE ONE DOCUMENT THAT EXPLAINS THE SET TO WHOEVER SEEDS THE CANVAS, and
  // "direction" is the client's word for an Explore option, not "rung" or "ladder".
  const readme = readFileSync(join(SEED, "README.md"), "utf8");
  assert.match(readme, /direction 1 of 2, The Quiet Room/i, "the README does not name each board by its direction number");
  assert.doesNotMatch(readme, /rung|ladder/i, "the seed README says rung or ladder, which the client never reads");
});

test("the declared frame height is the height the artboard actually renders", async (t) => {
  if (!ready) return t.skip(skipReason);
  // THE FRAME NEITHER SCALES NOR CROPS, and `x-dc` carries `overflow: hidden`, so a frame
  // declared shorter than its content clips the bottom off the board with nothing reporting it.
  const canvas = JSON.parse(readFileSync(join(SEED, "canvas.json"), "utf8"));
  const { chromium } = await import(join(ROOT, "scripts/reference-capture/node_modules/playwright/index.mjs"));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const frame of canvas.artboards) {
      await page.goto(`file://${join(SEED, frame.file)}`, { waitUntil: "load" });
      await page.waitForTimeout(150);
      const rendered = await page.evaluate(() => {
        const dc = document.querySelector("x-dc");
        return dc ? Math.ceil(Math.max(dc.getBoundingClientRect().height, dc.scrollHeight)) : null;
      });
      assert.ok(rendered, `${frame.file} has no x-dc to measure`);
      assert.equal(frame.h, rendered, `${frame.file} declares ${frame.h}px and renders ${rendered}px; the canvas clips the difference`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
});

test("a second run leaves the seed byte-identical, so a board on a canvas is never renumbered", async (t) => {
  if (!ready) return t.skip(skipReason);
  const first = readFileSync(join(SEED, "B1.dc.html"));
  const r = await run([SITE]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(SEED, "B1.dc.html")), first,
    "a re-run rewrote the artboard, so the keys the client's canvas was published with no longer match");
});

test("it runs through a symlinked path, instead of exiting 0 having done nothing", async (t) => {
  if (!ready) return t.skip(skipReason);
  // FOUND BY A REAL SEED RUN, NOT BY THIS SUITE, and the suite could not have found it: every
  // other test here invokes the script by its real path. On macOS `/tmp` is a symlink to
  // `/private/tmp`, which is where every `mktemp -d` lands, so `main()` never ran: no stdout, no
  // stderr, exit 0, nothing written. An operator reads that as a run that did nothing.
  // unlink, not rm: on macOS rmSync on a symlink to a directory reports the TARGET's type and
  // refuses, which would have this test tear down the repo's own path if it ever followed.
  const link = join(TMP, "plugin-link");
  try { unlinkSync(link); } catch { /* not there yet */ }
  symlinkSync(realpathSync(ROOT), link);
  const linkedCli = join(link, "scripts", "boards-render.mjs");
  assert.notEqual(linkedCli, join(realpathSync(ROOT), "scripts", "boards-render.mjs"),
    "the symlink resolves to the same string, so this test is measuring nothing");

  rmSync(join(SEED, "canvas.json"), { force: true });
  const r = await promisify(execFile)(process.execPath, [linkedCli, SITE], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .then((o) => ({ status: 0, ...o }))
    .catch((e) => ({ status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }));

  assert.equal(r.status, 0, `through a symlink it failed:\n${r.stderr}`);
  assert.match(r.stdout, /artboard\(s\) validated/, "it exited 0 having printed nothing, which reads as a run that did nothing");
  assert.ok(existsSync(join(SEED, "canvas.json")), "nothing was written through the symlinked path");
  unlinkSync(link);
});

test("the calibration references land on row 0 with the question", async (t) => {
  if (!ready) return t.skip(skipReason);
  const refsDir = join(SITE, ".palate/explore");
  mkdirSync(join(refsDir, "refshots"), { recursive: true });
  const refs = [
    { slug: "aesop", name: "Aesop", position: 1, why: "Restrained: one photograph and a great deal of air.", screenshot: "refshots/aesop.png" },
    { slug: "leoleo", name: "Leo Leo", position: 2, why: "In the middle: confident type, quiet motion.", screenshot: "refshots/leoleo.png" },
    { slug: "utsubo", name: "Utsubo", position: 3, why: "Bold: the entrance is an interaction, not a banner.", screenshot: "refshots/utsubo.png" },
  ];
  for (const r of refs) writeFileSync(join(refsDir, r.screenshot), pngFixture(1440, 900));
  writeFileSync(join(refsDir, "refs.json"), JSON.stringify(refs, null, 2));

  const r = await run([SITE, "--refs", ".palate/explore/refs.json"]);
  assert.equal(r.status, 0, `boards-render with --refs failed:\n${r.stderr}`);

  for (const n of [1, 2, 3]) {
    const f = join(SEED, `Ref${n}.dc.html`);
    assert.ok(existsSync(f), `Ref${n}.dc.html is missing`);
    const a = readFileSync(f, "utf8");
    assert.ok(a.startsWith("<!doctype html>"));
    assert.ok(a.includes('<script src="./support.js"></script>'));
    assert.ok(a.includes("<x-dc><helmet><style>"));
    // The canvas rules require a and a:hover to be defined in the helmet.
    assert.match(a, /a\{[^}]*color:/, `Ref${n} does not define a link colour in the helmet`);
    assert.match(a, /a:hover\{[^}]*color:/, `Ref${n} does not define a:hover in the helmet`);
    const img = /<img\b[^>]*\bsrc="([^"]*)"/.exec(a);
    assert.ok(img, `Ref${n} carries no screenshot`);
    assert.ok(!/[/:]/.test(img[1]), `Ref${n} references ${img[1]}, which is not a bare filename`);
    assert.ok(existsSync(join(SEED, img[1])));
    assert.ok(statSync(join(SEED, img[1])).size <= 70 * 1024, `${img[1]} is over the 70 KB ceiling`);
    assert.ok(existsSync(join(SITE, "public/_explore", img[1])), `${img[1]} never reached /explore`);
  }
  assert.ok(readFileSync(join(SEED, "Ref1.dc.html"), "utf8").includes("one photograph and a great deal of air"),
    "the reference does not say why it sits where it does on the range");

  const canvas = JSON.parse(readFileSync(join(SEED, "canvas.json"), "utf8"));
  const row0 = canvas.artboards.filter((a) => a.y === 0);
  assert.equal(row0.length, 3, "the three references are not all on row 0");
  assert.equal(row0[1].x - (row0[0].x + row0[0].w), 80, "80px between the reference frames");
  const boardRow = canvas.artboards.filter((a) => a.file.startsWith("B"));
  assert.equal(boardRow[0].y, row0[0].h + 120, "the boards are not 120px below the references");
  const q = canvas.annotations.find((a) => a.id === "cal-q");
  assert.ok(q, "there is no calibration annotation");
  assert.ok(q.y < 0, "the calibration question is not above row 0");
  assert.match(q.text, /how bold you want to be/i);

  rmSync(join(refsDir, "refs.json"), { force: true });
});

test("a calibration reference missing its screenshot is refused", async (t) => {
  if (!ready) return t.skip(skipReason);
  const refsDir = join(SITE, ".palate/explore");
  writeFileSync(join(refsDir, "refs.json"), JSON.stringify([
    { slug: "aesop", name: "Aesop", position: 1, why: "Restrained.", screenshot: "refshots/gone.png" },
  ]));
  const r = await run([SITE, "--refs", ".palate/explore/refs.json"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /aesop/, "the refusal does not name the reference");
  rmSync(join(refsDir, "refs.json"), { force: true });
});

test("an image over the ceiling is refused, and the seed is left exactly as it was", async (t) => {
  if (!ready) return t.skip(skipReason);
  const img = join(SEED, "b1-img1.png");
  const original = readFileSync(img);
  const before = readFileSync(join(SEED, "B1.dc.html"));
  const over = pngFixture(1440, 900);
  assert.ok(over.length > 70 * 1024, "the fixture image is not actually over the ceiling");
  writeFileSync(img, over);

  const r = await run([SITE]);
  assert.equal(r.status, 2, "an image over the ceiling must exit 2");
  assert.match(r.stderr, /b1/, "the refusal does not name the board");
  assert.match(r.stderr, /70 KB/, "the refusal does not say what the ceiling is");
  assert.ok(existsSync(join(SEED, "B1.dc.html")), "the refusal deleted the operator's own artboard");
  assert.deepEqual(readFileSync(join(SEED, "B1.dc.html")), before, "the refusal rewrote an artboard it had refused");

  writeFileSync(img, original);
});

test("a registered artboard that does not exist is refused, naming the path, and the seed survives", async (t) => {
  if (!ready) return t.skip(skipReason);
  const three = [...BOARDS, {
    id: "b3", name: "The Loud Room", ambition: 3, section: "menu", donor: "utsubo",
    what: "A full-bleed type wall.", why: "This launch has to be seen from across a room.",
    feeling: "brash, certain", motion: "The wall scrubs with the scroll.",
    ctas: ["Get tickets", "See the line-up"],
  }];
  writeFileSync(join(SITE, "src/lib/variants.ts"), registryFor(three));

  const r = await run([SITE]);
  assert.equal(r.status, 2, "a board with no artboard must exit 2");
  assert.match(r.stderr, /b3/, "the refusal does not name the board");
  assert.match(r.stderr, /B3\.dc\.html/, "the refusal does not name the file the registry asked for");
  // THE SEED IS THE OPERATOR'S OWN WORK. It used to be wiped on every refusal, which was right
  // when this script wrote it and is destructive now that a person drew it.
  assert.ok(existsSync(join(SEED, "B1.dc.html")), "a refusal deleted the hand-drawn artboards");

  writeFileSync(join(SITE, "src/lib/variants.ts"), registryFor(BOARDS));
});

test("a direction whose detail sheet was never drawn is refused, naming the file and the kind", async (t) => {
  if (!ready) return t.skip(skipReason);
  // HALF A DIRECTION READS AS THE WHOLE ONE. A client handed a home page, an inner page and a
  // phone signs off a direction whose pieces and states nobody ever drew, and the sheet is the
  // half that says what the navigation does when it is open and what the form says when it is
  // wrong. So a missing one stops the run rather than shipping three boards out of four.
  const sheet = join(SEED, "S1.dc.html");
  const original = readFileSync(sheet, "utf8");
  rmSync(sheet, { force: true });
  try {
    const r = await run([SITE]);
    assert.equal(r.status, 2, "a direction with no detail sheet was drawn as though it were whole");
    assert.match(r.stderr, /S1\.dc\.html/, "the refusal does not name the file the registry asked for");
    assert.match(r.stderr, /sheet/, "the refusal does not name which of the four boards is missing");
    assert.ok(existsSync(join(SEED, "B1.dc.html")), "the refusal deleted the hand-drawn artboards");
  } finally {
    writeFileSync(sheet, original);
  }
});

test("a sheet whose caption drops the donor is refused, naming the piece and the reference", async (t) => {
  if (!ready) return t.skip(skipReason);
  // The registry knows each piece's donor and the sheet is where a client reads it. A caption
  // that says which variation it is and not where it came from looks complete and proves
  // nothing, so the run refuses it rather than shooting a sheet that cannot be traced.
  const sheet = join(SEED, "S1.dc.html");
  const original = readFileSync(sheet, "utf8");
  writeFileSync(sheet, original.replace(", drawn from pilot-accounting.", "."));
  try {
    const r = await run([SITE]);
    assert.equal(r.status, 2, "a sheet whose form block names no donor was drawn as though it were traceable");
    assert.match(r.stderr, /forms/, "the refusal does not name the piece");
    assert.match(r.stderr, /pilot-accounting/, "the refusal does not name the reference the caption owes");
    assert.ok(existsSync(join(SEED, "B1.dc.html")), "the refusal deleted the hand-drawn artboards");
  } finally {
    writeFileSync(sheet, original);
  }
});

test("a registry entry with no presentation is refused rather than guessed at", async (t) => {
  if (!ready) return t.skip(skipReason);
  // The other three boards could be derived from the rung, and deriving them would mean a
  // registry that never declared them passes while the client is shown one board out of four.
  const before = readFileSync(join(SITE, "src/lib/variants.ts"), "utf8");
  writeFileSync(join(SITE, "src/lib/variants.ts"), before.replace(/    presentation: \{[\s\S]*?\},\n/, ""));
  try {
    const r = await run([SITE]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /presentation/, "the refusal does not name the field that is missing");
  } finally {
    writeFileSync(join(SITE, "src/lib/variants.ts"), before);
  }
});

test("no registry at all is refused rather than passed over", async (t) => {
  if (!ready) return t.skip(skipReason);
  const empty = join(TMP, "not-an-explore-build");
  mkdirSync(empty, { recursive: true });
  const r = await run([empty]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /variants\.ts/);
  assert.match(r.stderr, /NOT a pass/);
});

// ------------------------------------------------------------------ the donor row
/**
 * THE DONOR SITS BESIDE ITS BOARD, or the rung's claim that it reproduces a library reference
 * is a bare slug in a registry nobody opens. These assertions are about the FILES and the
 * LAYOUT, because a donor card that is written but never paired lands at the same x as the
 * next board and covers it, and a canvas reports neither.
 */
const donorFor = (rung, over = {}) => ({
  rung,
  slug: `donor-${rung}`,
  name: `Donor ${rung}`,
  hero_url: `https://example.supabase.co/storage/v1/object/public/screenshots/donor-${rung}/desktop.png`,
  signature_move: `The entrance holds one photograph and one line, rung ${rung}.`,
  component_prompts: ["A hero of one photograph, one line and one action."],
  copy_voice: "Plain sentences, no adjectives, the price said out loud.",
  do_dont: ["Do not stack two calls to action in the entrance."],
  ...over,
});

function donorFile(entries) {
  const dir = mkdtempSync(join(tmpdir(), "donor-fixture-"));
  fixtureDirs.push(dir);
  writeFileSync(join(dir, "donor-heroes.json"), JSON.stringify(entries, null, 2));
  return dir;
}

test("a registered board with no donor entry is refused, naming the rung and the file", () => {
  const dir = donorFile([donorFor(1)]);
  assert.throws(
    () => loadDonors(dir, "donor-heroes.json", [{ id: "b1", ambition: 1 }, { id: "b2", ambition: 2 }]),
    (e) => /rung 2/.test(e.message) && /donor-heroes\.json/.test(e.message),
    "a board whose donor was never recorded passed as a silence",
  );
});

/**
 * The registry's donor and the row's donor are joined on the RUNG, so a mismatched slug used to
 * pass every gate: the canvas laid one reference's hero beside the board and captioned it with
 * the other's name, which is a false claim about published work shown to the client.
 */
test("a board whose registered donor is not the donor recorded at its rung is refused", () => {
  const dir = donorFile([donorFor(1), donorFor(2, { slug: "aesop" })]);
  assert.throws(
    () => loadDonors(dir, "donor-heroes.json", [
      { id: "b1", ambition: 1, donor: "donor-1" },
      { id: "b2", ambition: 2, donor: "linear" },
    ]),
    (e) => /b2/.test(e.message) && /linear/.test(e.message) && /aesop/.test(e.message) && /donor-heroes\.json/.test(e.message),
    "a board captioned with a reference it was not drawn from was accepted",
  );
});

test("a board whose registered donor matches the rung's entry is accepted", () => {
  const dir = donorFile([donorFor(1, { slug: "aesop" })]);
  assert.equal(loadDonors(dir, "donor-heroes.json", [{ id: "b1", ambition: 1, donor: "aesop" }]).length, 1);
});

test("a donor hero that is not https is refused", () => {
  const dir = donorFile([donorFor(1, { hero_url: "http://example.com/hero.png" })]);
  assert.throws(
    () => loadDonors(dir, "donor-heroes.json", [{ id: "b1", ambition: 1 }]),
    /https/,
  );
});

test("two donors for one rung are refused, naming the rung", () => {
  const dir = donorFile([donorFor(1), donorFor(1, { slug: "other" })]);
  assert.throws(
    () => loadDonors(dir, "donor-heroes.json", [{ id: "b1", ambition: 1 }]),
    /rung 1/,
  );
});

test("a donor missing any of its taste layers is refused, naming the field", () => {
  for (const field of ["slug", "name", "signature_move", "component_prompts", "copy_voice", "do_dont"]) {
    const entry = donorFor(1);
    delete entry[field];
    const dir = donorFile([entry]);
    assert.throws(
      () => loadDonors(dir, "donor-heroes.json", [{ id: "b1", ambition: 1 }]),
      new RegExp(field),
      `a donor with no ${field} was accepted, so the drawing brief has nothing to draw from`,
    );
  }
});

test("canvas.json lays each donor beside its own board, and steps the next board past it", () => {
  const boards = [
    { file: "B1.dc.html", id: "b1", ambition: 1, name: "One", h: 2000, feeling: "quiet", what: "A" },
    { file: "B2.dc.html", id: "b2", ambition: 2, name: "Two", h: 2400, feeling: "loud", what: "B" },
  ];
  const doc = writeCanvasJson({ boards, donors: [donorFor(1)], out: null });
  const b1 = doc.artboards.find((a) => a.file === "B1.dc.html");
  const b2 = doc.artboards.find((a) => a.file === "B2.dc.html");
  const d1 = doc.artboards.find((a) => a.file === "D1.dc.html");
  assert.ok(d1, "the donor card is not on the canvas at all");
  assert.equal(d1.x, b1.x + 1440 + 80, "the donor does not sit beside its board");
  assert.equal(d1.y, b1.y, "the donor is not on the board's own row");
  assert.equal(d1.w, 720);
  assert.equal(d1.h, 580);
  assert.match(d1.title, /Donor for direction 1: Donor 1/);
  // "Direction" is the client's word for an Explore option; "rung" is internal (the ledger,
  // the ladder module, gate-board-judge.mjs). The canvas title is what the client reads.
  assert.match(b1.title, /Direction 1 of 2: One/);
  assert.doesNotMatch(b1.title, /rung/i, "the board's canvas title says rung, which the client never reads");
  assert.equal(b2.x, 0, "the second direction starts its own row");
  assert.equal(b2.y, b1.y + b1.h + 120, "the second direction is not a row below the first");
  const note = doc.annotations.find((a) => a.id === "donor-b1");
  assert.ok(note, "the donor card carries no annotation saying what was drawn from it");
  assert.match(note.text, /Drawn from donor-1: The entrance holds one photograph/);
  for (const a of doc.annotations) assert.match(a.id, /^[A-Za-z0-9_-]{1,40}$/);
});

test("with no donors the layout is byte-identical to the one without the argument", () => {
  const boards = [
    { file: "B1.dc.html", id: "b1", ambition: 1, name: "One", h: 2000, feeling: "quiet", what: "A" },
    { file: "B2.dc.html", id: "b2", ambition: 2, name: "Two", h: 2400, feeling: "loud", what: "B" },
  ];
  const refs = [{ position: 1, name: "Ref one", slug: "one", why: "restrained" }];
  assert.equal(
    JSON.stringify(writeCanvasJson({ boards, refs, donors: [], out: null })),
    JSON.stringify(writeCanvasJson({ boards, refs, out: null })),
    "adding the donor argument moved a frame on a canvas that has no donors",
  );
});

/** A loopback server standing in for the public screenshot object, so nothing here is metered. */
async function serveHero(bytes) {
  const server = createServer((req, res) => {
    if (req.url === "/missing.png") { res.writeHead(404); res.end("gone"); return; }
    if (req.url === "/not-an-image.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end("<!doctype html><title>an error page under a png name</title>");
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(bytes);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

test("the donor hero is fetched, re-encoded and laid beside its board", async (t) => {
  if (!ready) return t.skip(skipReason);
  const { server, port } = await serveHero(pngFixture(1440, 900));
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  try {
    writeFileSync(donorsPath, JSON.stringify([
      donorFor(1, { slug: "therapy-in-london", name: "Therapy in London", hero_url: `http://127.0.0.1:${port}/hero.png` }),
      donorFor(2, { slug: "the-modern-house", name: "The Modern House", hero_url: `http://127.0.0.1:${port}/hero.png` }),
    ], null, 2));
    writeFileSync(join(SITE, "build-manifest.json"), JSON.stringify({ schema: 3, project: "." }));

    const r = await run([SITE]);
    assert.equal(r.status, 0, `boards-render with a donor row failed:\n${r.stderr}`);

    for (const [rung, id] of [[1, "b1"], [2, "b2"]]) {
      const card = join(SEED, `D${rung}.dc.html`);
      assert.ok(existsSync(card), `D${rung}.dc.html is missing, so the donor is not on the canvas`);
      const html = readFileSync(card, "utf8");
      assert.ok(html.startsWith("<!doctype html>"));
      assert.ok(html.includes('<script src="./support.js"></script>'), `D${rung} lost the support line`);
      assert.match(html, /a:hover\{[^}]*color:/, `D${rung} does not define a:hover in the helmet`);
      const img = /<img\b[^>]*\bsrc="([^"]*)"/.exec(html);
      assert.ok(img, `D${rung} carries no hero`);
      assert.equal(img[1], `d${rung}-hero.jpg`);
      const hero = join(SEED, `d${rung}-hero.jpg`);
      assert.ok(existsSync(hero), `d${rung}-hero.jpg was never written`);
      assert.ok(statSync(hero).size <= 70 * 1024, `d${rung}-hero.jpg is over the 70 KB canvas ceiling`);
      assert.ok(existsSync(join(SITE, ".palate/explore/shots", id, "donor.jpg")), `${id} has no archived donor hero`);
      assert.ok(existsSync(join(SITE, "public/_explore", `${id}-donor.jpg`)), `${id}'s donor never reached /explore`);
    }
    assert.match(readFileSync(join(SEED, "D2.dc.html"), "utf8"), /the-modern-house/,
      "the donor card does not name the reference it is");
    // The donor card's own text is drawn on the canvas the client works on, so it says
    // "Direction N", never "Rung N".
    const d1Html = readFileSync(join(SEED, "D1.dc.html"), "utf8");
    const d1Title = /<p[^>]*>([^<]*is drawn from[^<]*)<\/p>/.exec(d1Html);
    assert.ok(d1Title, "the donor card has no title line to check");
    assert.match(d1Title[1], /^Direction 1 is drawn from Therapy in London/);
    assert.doesNotMatch(d1Title[1], /Rung/i, "the donor card's title says Rung, which the client never reads");

    const canvas = JSON.parse(readFileSync(join(SEED, "canvas.json"), "utf8"));
    const b1 = canvas.artboards.find((a) => a.file === "B1.dc.html");
    const d1 = canvas.artboards.find((a) => a.file === "D1.dc.html");
    const b2 = canvas.artboards.find((a) => a.file === "B2.dc.html");
    assert.ok(d1, "the donor card never reached canvas.json");
    assert.equal(d1.x, 1440 + 80);
    assert.equal(d1.y, b1.y, "the donor is not on its board's row");
    assert.equal(b2.x, 0, "the second direction did not start its own row");
    assert.ok(b2.y > b1.y, "the second direction sits on the first one's row");

    // THE LINEAGE SEAM: the stop hook reads explore.shown[].donor_slug and nothing wrote it.
    const manifest = JSON.parse(readFileSync(join(SITE, "build-manifest.json"), "utf8"));
    assert.deepEqual(
      manifest.explore.shown.map((s) => [s.id, s.donor_slug, s.position]),
      [["b1", "therapy-in-london", 1], ["b2", "the-modern-house", 2]],
      "explore.shown does not carry each board's donor, so the lineage dies with the build",
    );
    assert.equal(manifest.explore.donor_row.skipped, false);
  } finally {
    server.close();
    rmSync(donorsPath, { force: true });
    rmSync(join(SITE, "build-manifest.json"), { force: true });
  }
});

test("a hero the fetch cannot get is refused, naming the URL, and the seed survives", async (t) => {
  if (!ready) return t.skip(skipReason);
  const { server, port } = await serveHero(pngFixture(400, 300));
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  const before = readFileSync(join(SEED, "B1.dc.html"));
  try {
    // Each fault names ITSELF, not merely the URL: a 404 and an error page served under a .png
    // name send an operator to two different places, and the first version of this test passed
    // with the status check removed because a 404 body also fails the magic-byte check.
    for (const [path, said] of [["missing.png", /HTTP 404/], ["not-an-image.png", /not a PNG, JPEG or WebP/]]) {
      writeFileSync(donorsPath, JSON.stringify([
        donorFor(1, { slug: "therapy-in-london", hero_url: `http://127.0.0.1:${port}/${path}` }),
        donorFor(2, { slug: "the-modern-house", hero_url: `http://127.0.0.1:${port}/hero.png` }),
      ], null, 2));
      const r = await run([SITE]);
      assert.equal(r.status, 2, `${path} was accepted as a donor hero`);
      assert.match(r.stderr, new RegExp(path), `the refusal does not name the URL it could not use (${path})`);
      assert.match(r.stderr, said, `the refusal does not say WHAT was wrong with ${path}`);
      assert.deepEqual(readFileSync(join(SEED, "B1.dc.html")), before, "the refusal rewrote the operator's artboard");
    }
  } finally {
    server.close();
    rmSync(donorsPath, { force: true });
  }
});

test("a board with no donor entry stops the run and leaves the drawn seed alone", async (t) => {
  if (!ready) return t.skip(skipReason);
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  writeFileSync(donorsPath, JSON.stringify([donorFor(1, { slug: "therapy-in-london", hero_url: "https://example.supabase.co/x/desktop.png" })]));
  const r = await run([SITE]);
  assert.equal(r.status, 2, "half a donor row was drawn as though it were the whole one");
  assert.match(r.stderr, /rung 2/, "the refusal does not name the rung with no donor");
  assert.match(r.stderr, /donor-heroes\.json/, "the refusal does not name the file that owes the entry");
  assert.ok(existsSync(join(SEED, "B1.dc.html")), "the refusal deleted the hand-drawn artboards");
  rmSync(donorsPath, { force: true });
});

test("--no-donors runs without the file and says so in the manifest", async (t) => {
  if (!ready) return t.skip(skipReason);
  writeFileSync(join(SITE, "build-manifest.json"), JSON.stringify({ schema: 3, project: "." }));
  const r = await run([SITE, "--no-donors"]);
  assert.equal(r.status, 0, `--no-donors failed:\n${r.stderr}`);
  const manifest = JSON.parse(readFileSync(join(SITE, "build-manifest.json"), "utf8"));
  assert.equal(manifest.explore.donor_row.skipped, true,
    "a run with no donor row is byte-identical to one with it, which is the fault this records");
  rmSync(join(SITE, "build-manifest.json"), { force: true });
});

// ------------------------------------------------- the donor's whole-page capture
/**
 * THE JUDGE READS THE PAGE ENDING TOO, and the donor's half of that comparison is the reference's
 * own full-page capture, which sits beside its desktop hero as a public object. It is fetched
 * here rather than in the gate because this is the one place that already knows the donor's URL,
 * and it is NEVER put on the canvas: it is judge evidence, so the 70 KB canvas ceiling does not
 * apply to it and it keeps whatever the library served.
 *
 * A donor with no full capture is NOT a refusal. Some references have none, which is nobody's
 * fault and no reason to stop an Explore; it is recorded as a sidecar so the gate can leave that
 * surface out and say why, instead of a silence the next reader takes for a clean bill.
 */
async function serveCaptures({ full = null, fullStatus = 200, slowFullFor = null, slowMs = 0 } = {}) {
  const hero = pngFixture(1440, 900);
  const server = createServer((req, res) => {
    if (req.url.endsWith("/full.png")) {
      if (fullStatus !== 200) { res.writeHead(fullStatus); res.end("gone"); return; }
      const send = () => {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(full ?? pngFixture(1440, 4000));
      };
      if (slowFullFor && req.url.includes(slowFullFor)) setTimeout(send, slowMs);
      else send();
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(hero);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

/**
 * EACH OF THESE TESTS OWNS ITS PRECONDITION. They used to inherit `shots/b1` and `shots/b2` from
 * tests that happened to run earlier in the file, which is exactly how the first-run ENOENT in
 * `writeDonorFull` hid: run alone they failed, run in order they passed, and the defect class
 * they exist to catch is a FIRST run.
 */
const freshShots = () => {
  for (const id of ["b1", "b2"]) rmSync(join(SITE, ".palate/explore/shots", id), { recursive: true, force: true });
};

const donorsWith = (port) => JSON.stringify([
  donorFor(1, { slug: "therapy-in-london", hero_url: `http://127.0.0.1:${port}/screenshots/therapy-in-london/desktop.png` }),
  donorFor(2, { slug: "the-modern-house", hero_url: `http://127.0.0.1:${port}/screenshots/the-modern-house/desktop.png` }),
], null, 2);

test("the donor's full-page capture is fetched beside its hero, for the page-ending comparison", async (t) => {
  if (!ready) return t.skip(skipReason);
  freshShots();
  const { server, port } = await serveCaptures();
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  try {
    writeFileSync(donorsPath, donorsWith(port));
    const r = await run([SITE]);
    assert.equal(r.status, 0, `boards-render failed:\n${r.stderr}`);
    for (const id of ["b1", "b2"]) {
      const full = join(SITE, ".palate/explore/shots", id, "donor-full.png");
      assert.ok(existsSync(full), `${id} has no donor full capture, so its page ending can be judged against nothing`);
      assert.ok(statSync(full).size > 0);
      assert.ok(!existsSync(join(SITE, ".palate/explore/shots", id, "donor-full.missing")),
        `${id} recorded the capture as missing and fetched it anyway`);
      // NEVER ON THE CANVAS. It is judge evidence, so it is not copied into the seed or /explore.
      assert.ok(!existsSync(join(SEED, `d${id === "b1" ? 1 : 2}-full.png`)), "the full capture was written into the canvas seed");
    }
    assert.match(r.stdout, /donor-full\.png/, "the run does not say it fetched the whole-page captures");
  } finally {
    server.close();
    rmSync(donorsPath, { force: true });
  }
});

test("a donor with no full capture is recorded, not refused, and the run finishes", async (t) => {
  if (!ready) return t.skip(skipReason);
  freshShots();
  const { server, port } = await serveCaptures({ fullStatus: 404 });
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  try {
    writeFileSync(donorsPath, donorsWith(port));
    const r = await run([SITE]);
    assert.equal(r.status, 0, `a reference with no full.png stopped the whole Explore:\n${r.stderr}`);
    for (const id of ["b1", "b2"]) {
      const dir = join(SITE, ".palate/explore/shots", id);
      assert.ok(!existsSync(join(dir, "donor-full.png")));
      const sidecar = join(dir, "donor-full.missing");
      assert.ok(existsSync(sidecar), `${id} recorded nothing about its missing capture, so the gate cannot say why`);
      assert.match(readFileSync(sidecar, "utf8"), /404/, "the sidecar does not say what went wrong");
    }
  } finally {
    server.close();
    rmSync(donorsPath, { force: true });
  }
});

test("a full capture over the ceiling is left behind with its reason, never written", async (t) => {
  if (!ready) return t.skip(skipReason);
  freshShots();
  // The magic bytes are real and the body is enormous, which is the shape that matters: the cap
  // is checked on what came back, before anything decodes it.
  const huge = Buffer.concat([pngFixture(8, 8), Buffer.alloc(17 * 1024 * 1024, 7)]);
  const { server, port } = await serveCaptures({ full: huge });
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  try {
    writeFileSync(donorsPath, donorsWith(port));
    const r = await run([SITE]);
    assert.equal(r.status, 0, `an oversized donor capture stopped the Explore:\n${r.stderr}`);
    const dir = join(SITE, ".palate/explore/shots", "b1");
    assert.ok(!existsSync(join(dir, "donor-full.png")), "a 17 MB capture was kept");
    assert.match(readFileSync(join(dir, "donor-full.missing"), "utf8"), /16 MB|too large|over/i);
  } finally {
    server.close();
    rmSync(donorsPath, { force: true });
  }
});

test("a stale missing-capture note is cleared when the capture is there next time", async (t) => {
  if (!ready) return t.skip(skipReason);
  freshShots();
  const dir = join(SITE, ".palate/explore/shots", "b1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "donor-full.missing"), "from a run when the library had none");
  const { server, port } = await serveCaptures();
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  try {
    writeFileSync(donorsPath, donorsWith(port));
    assert.equal((await run([SITE])).status, 0);
    assert.ok(existsSync(join(dir, "donor-full.png")));
    assert.ok(!existsSync(join(dir, "donor-full.missing")),
      "the note survived the fetch, so the gate skips a surface it has the evidence for");
  } finally {
    server.close();
    rmSync(donorsPath, { force: true });
  }
});

/**
 * THE CEILING HAD TO BE MEASURED, NOT REASONED ABOUT. The first version capped the donor's
 * whole-page capture at 1.5 MB, and a sample of twelve live references put eight of them over
 * it (stripe 6.6 MB, aesop 3.8 MB, loom 2.9 MB), so on a real ladder most directions would have
 * lost the page ending, which is the surface the task exists to add.
 */
test("a multi-megabyte capture, which is what the library actually serves, is kept", async (t) => {
  if (!ready) return t.skip(skipReason);
  freshShots();
  const big = Buffer.concat([pngFixture(1440, 900), Buffer.alloc(4 * 1024 * 1024, 3)]);
  const { server, port } = await serveCaptures({ full: big });
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  try {
    writeFileSync(donorsPath, donorsWith(port));
    const r = await run([SITE]);
    assert.equal(r.status, 0, `a 4 MB donor capture stopped the Explore:\n${r.stderr}`);
    const full = join(SITE, ".palate/explore/shots", "b1", "donor-full.png");
    assert.ok(existsSync(full), "a 4 MB capture was refused, so most real references lose their page ending");
    assert.ok(statSync(full).size > 4 * 1024 * 1024);
  } finally {
    server.close();
    rmSync(donorsPath, { force: true });
  }
});

/**
 * The hero's ten seconds is right for a frame an operator is waiting on. A whole-page capture is
 * megabytes, so the same clock turns an ordinary slow link into a recorded "did not answer" and
 * the page ending is dropped for a reason that has nothing to do with the library.
 */
test("the whole-page capture gets its own budget, past the hero's ten seconds", async (t) => {
  if (!ready) return t.skip(skipReason);
  freshShots();
  const { server, port } = await serveCaptures({ slowFullFor: "therapy-in-london", slowMs: 11500 });
  const donorsPath = join(SITE, ".palate/explore/donor-heroes.json");
  try {
    writeFileSync(donorsPath, donorsWith(port));
    const r = await run([SITE]);
    assert.equal(r.status, 0, r.stderr);
    const dir = join(SITE, ".palate/explore/shots", "b1");
    assert.ok(existsSync(join(dir, "donor-full.png")),
      "a capture that took over ten seconds was recorded as missing, on the hero's clock");
    assert.ok(!existsSync(join(dir, "donor-full.missing")));
  } finally {
    server.close();
    rmSync(donorsPath, { force: true });
  }
});
