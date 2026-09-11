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
import { PROPERTY_LIST, parseRegistry, writeCanvasJson, toArtboard, validateArtboard, stampKeys, loadDonors } from "../boards-render.mjs";

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
  },
  {
    id: "b2", name: "The Long Table", ambition: 2, section: "proof", donor: "the-modern-house",
    what: "A wide table of the work, read left to right.",
    why: "This buyer compares before they commit, so the comparison is the page.",
    feeling: "candid, unhurried",
    motion: "Rows settle into place as the table is scrolled, one after another.",
    ctas: ["See the work", "Start a project", "Ask about a fit"],
  },
];

/** The registry as Task 2 left it: `artboard` required, no `href`, because no route exists. */
function registryFor(boards) {
  const entries = boards.map((b) => `  {
    id: ${JSON.stringify(b.id)},
    name: ${JSON.stringify(b.name)},
    artboard: ${JSON.stringify(`B${b.ambition}.dc.html`)},
    ambition: ${b.ambition},
    what: ${JSON.stringify(b.what)},
    why: ${JSON.stringify(b.why)},
    feeling: ${JSON.stringify(b.feeling)},
    donor: ${JSON.stringify(b.donor)},
    section: ${JSON.stringify(b.section)},
    motion: ${JSON.stringify(b.motion)},
    ctas: ${JSON.stringify(b.ctas)},
  },`).join("\n");
  return `export interface Variant {
  id: string; name: string; artboard: string; href?: string; ambition: number; what: string;
  why: string; feeling: string; donor: string; section: string; motion: string; ctas: string[];
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

function drawSeed(boards) {
  mkdirSync(SEED, { recursive: true });
  for (const b of boards) {
    writeFileSync(join(SEED, `B${b.ambition}.dc.html`), artboardFor(b));
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

test("an artboard carries the skeleton the editor replaces, verbatim", () => {
  const a = toArtboard({ html: "<p>hi</p>", css: "p{color:red}", name: "b1 Test" });
  assert.ok(a.startsWith("<!doctype html>"));
  assert.ok(a.includes('<script src="./support.js"></script>'));
  assert.ok(a.includes("<x-dc><helmet><style>"));
  assert.ok(a.includes("</x-dc></body></html>"));
});

test("canvas.json puts the references on row 0 and the boards 120px below", () => {
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
  assert.equal(b2.x - (b1.x + b1.w), 80, "80px between frames in a row");
  assert.equal(b1.h, 2000, "the frame height is the measured height, never a guess");
  assert.equal(doc.launch.view, "canvas");
  assert.ok(doc.annotations.some((a) => a.id === "cal-q"), "the calibration question is annotated");
  for (const a of doc.annotations) assert.match(a.id, /^[A-Za-z0-9_-]{1,40}$/);
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

// ---------------------------------------------------------------- the real run
test("the artboards are validated, keyed, measured and archived", async (t) => {
  if (!ready) return t.skip(skipReason);
  const r = await run([SITE]);
  assert.equal(r.status, 0, `boards-render failed:\n${r.stderr}`);

  for (const f of ["B1.dc.html", "B2.dc.html", "canvas.json", "README.md"]) {
    assert.ok(existsSync(join(SEED, f)), `${f} is missing from the seed`);
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
  assert.deepEqual(canvas.artboards.map((a) => a.file), ["B1.dc.html", "B2.dc.html"]);
  const [f1, f2] = canvas.artboards;
  assert.equal(f1.w, 1440);
  assert.equal(f2.x - (f1.x + f1.w), 80, "80px between frames");
  assert.equal(f1.y, 0, "with no calibration row the boards are row 0");
  // A frame neither scales nor crops, so a height that is not the measured one clips the board.
  for (const f of canvas.artboards) assert.ok(f.h >= 200, `${f.file} declares ${f.h}px, which is not a measured board`);
  assert.equal(canvas.annotations.length, 2, "one annotation per board");
  assert.equal(canvas.launch.view, "canvas");
  assert.match(r.stdout, /artboard\(s\) validated, keyed, measured and archived/);
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
  assert.match(d1.title, /Donor for rung 1: Donor 1/);
  assert.equal(b2.x, 1440 + 80 + 720 + 80, "the next board was not stepped past the donor, so it sits under it");
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

    const canvas = JSON.parse(readFileSync(join(SEED, "canvas.json"), "utf8"));
    const b1 = canvas.artboards.find((a) => a.file === "B1.dc.html");
    const d1 = canvas.artboards.find((a) => a.file === "D1.dc.html");
    const b2 = canvas.artboards.find((a) => a.file === "B2.dc.html");
    assert.ok(d1, "the donor card never reached canvas.json");
    assert.equal(d1.x, 1440 + 80);
    assert.equal(d1.y, b1.y, "the donor is not on its board's row");
    assert.equal(b2.x, 1440 + 80 + 720 + 80, "the second board sits under the first board's donor");

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
