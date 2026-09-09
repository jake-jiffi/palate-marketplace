/**
 * boards-render.test.mjs - the artboards, against a real build in a real browser.
 *
 * Everything this script writes is consumed by something that cannot report a fault. The canvas
 * silently renders a broken image for a src it cannot resolve, silently runs nothing for a
 * module whose import it cannot fetch, and silently mis-frames an artboard whose declared
 * height is wrong. So the assertions here are about the FILE, not about the run finishing:
 * the skeleton the editor requires, one script and no more, every image a bare filename that
 * exists and fits, and a canvas.json whose geometry matches what was rendered.
 *
 * The last block is the one that matters most: a registered board with no page must leave NO
 * seed directory. Half a set handed to a client reads as the whole set.
 *
 * Slow: an npm install, an astro build and a browser. scripts/test/run.sh skips it under
 * --fast. Run: node --test scripts/test/boards-render.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, statSync, readdirSync, symlinkSync, realpathSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { PROPERTY_LIST, parseRegistry, writeCanvasJson, toArtboard } from "../boards-render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "scripts", "boards-render.mjs");
const PORT = 8796; // reserved for this suite; 8791 and 8797 belong to the others

let TMP = null;
let SITE = null;
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

function registryFor(boards) {
  const entries = boards.map((b) => `  {
    id: ${JSON.stringify(b.id)},
    name: ${JSON.stringify(b.name)},
    href: ${JSON.stringify(`/boards/${b.id}`)},
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
  id: string; name: string; href: string; ambition: number; what: string; why: string;
  feeling: string; donor: string; section: string; motion: string; ctas: string[];
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

function boardPage(b) {
  return `---
import BoardFrame from "../../layouts/BoardFrame.astro";
import SectionMark from "../../components/SectionMark.astro";
import { variants } from "../../lib/variants";
const variant = variants.find((v) => v.id === ${JSON.stringify(b.id)});
---
{variant && (
  <BoardFrame variant={variant}>
    <Fragment slot="head">
      {/* A cross-origin stylesheet. Reading its rules throws, and the head is never
          serialised, so without explicit handling the faces a brand-creation Explore
          chose are simply absent from the artboard. */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fixture+Face:wght@400&display=swap" />
      {/* A REAL SAME-ORIGIN STYLESHEET, served from public/ rather than written inline.
          An inline style in an .astro template is raw text that Astro and Vite may hoist,
          resolve or drop, and two attempts at one produced a fixture that measured nothing.
          A linked file gives exactly what the harvest has to cope with: a CSSImportRule, a
          fragment url(), a class-set background and one that 404s. */}
      <link rel="stylesheet" href="/_fixture/extra.css" />
    </Fragment>
    <section slot="hero" class="bg-brand-bg relative px-6 py-24" style="background-image:url('/_fixture/bg.png');background-size:cover">
      <SectionMark id="${b.id}-hero" />
      <h1 class="font-display text-brand-text text-5xl">${b.name}</h1>
      <p class="text-brand-muted mt-6 max-w-xl">${b.what}</p>
      <img src="/_fixture/photo.png" alt="A fixture photograph" width="640" height="400" />
      {/* An inline icon, the commonest shape a data URI takes. document.images includes it, and
          Playwright's request context cannot fetch one, so it aborted the whole seed with a
          message about a broken image. */}
      <img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='7' fill='%232f5d50'/></svg>" alt="An inline icon" width="16" height="16" data-inline-icon />
      {/* Base64, with a prolog long enough that the root element is past the first 200 bytes:
          sniffing the payload cannot see it is an SVG, so only the declared media type can. */}
      <img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+PCEtLSBFeHBvcnRlZCBieSBhIGRyYXdpbmcgdG9vbCB0aGF0IHdyaXRlcyBhIGxvbmcgcHJvbG9nIGJlZm9yZSB0aGUgcm9vdCBlbGVtZW50LiBUaGlzIGlzIG9yZGluYXJ5LCBhbmQgaXQgaXMgd2hhdCBwdXRzIHRoZSByb290IGVsZW1lbnQgcGFzdCBhbnl0aGluZyBhIHBheWxvYWQgc25pZmYgcmVhZHMsIHdoaWNoIGlzIHdoeSB0aGUgZGVjbGFyZWQgbWVkaWEgdHlwZSBpcyB0aGUgb25seSB0aGluZyB0aGF0IGNhbiBuYW1lIHRoZSBleHRlbnNpb24uIC0tPjxzdmcgeG1sbnM9J2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJyB2aWV3Qm94PScwIDAgMTYgMTYnPjxyZWN0IHdpZHRoPScxNicgaGVpZ2h0PScxNicgZmlsbD0nIzFjMWIxOScvPjwvc3ZnPg==" alt="A second inline icon" width="16" height="16" data-inline-b64 />
      {/* A band the page never scrolls to, held at opacity 0 until a reveal fires. */}
      {/* url(#id): an SVG filter reference. It resolves to the page's own URL, so harvesting it
          as an image fetches HTML and refuses the whole seed. Grain is the canonical technique
          and the bold mandate names it. */}
      <svg width="0" height="0" style="position:absolute" aria-hidden="true">
        <filter id="fixture-grain"><feTurbulence baseFrequency="0.8" /></filter>
      </svg>
      <div class="fixture-grain" style="width:80px;height:80px;background:#2f5d50"></div>
      {/* A class-set background that IS an image: the helmet-CSS rewrite path, which the inline
          style above does not exercise. */}
      <div class="fixture-bg" style="width:200px;height:120px"></div>
      {/* And one that 404s, from a rule that may belong to another page entirely. */}
      <div class="fixture-missing" style="width:80px;height:80px"></div>
      <div class="fixture-notimage" style="width:80px;height:80px"></div>
      <p class="fixture-classy" data-classy>Styled only by the linked stylesheet.</p>
      <div style="height:1400px"></div>
      <p data-reveal class="reveal-band" style="opacity:0">The band a scroll reveal brings in.</p>
    </section>
    <section slot="section" class="bg-brand-bg relative px-6 py-20">
      <SectionMark id="${b.id}-${b.section}" />
      <h2 class="font-display text-brand-text text-3xl">${b.section}</h2>
      {/* A third-party tag IN THE BODY. Astro hoists its own scripts to the head, which the
          artboard never serialises, so without this the stripping assertions would be true by
          construction and would pass on a script-stripper that had been deleted. */}
      <script is:inline src="https://tracker.example.com/t.js"></script>
      {/* And the site's own motion, self-contained and declared, which SHOULD travel. It is a
          real IntersectionObserver, so the reveal only resolves if something actually scrolls
          the page before the harvest. */}
      <script is:inline data-palate-motion>
        const io = new IntersectionObserver((entries) => {
          for (const e of entries) if (e.isIntersecting) { e.target.style.opacity = "1"; e.target.setAttribute("data-revealed", "1"); }
        });
        document.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));
      </script>
    </section>
  </BoardFrame>
)}
`;
}

const run = async (args, opts = {}) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

before(async () => {
  if (!existsSync(join(ROOT, "scripts/reference-capture/node_modules/playwright"))) {
    skipReason = "playwright is not installed (scripts/reference-capture/setup.sh); the artboards are UNPROVEN.";
    return;
  }
  TMP = mkdtempSync(join(tmpdir(), "boards-render-"));
  SITE = join(TMP, "site");
  try {
    execFileSync("bash", ["-c",
      `set -e; export SCAFFOLD_TEMPLATE="${join(ROOT, "templates/astro-project")}"; ` +
      `. "${join(HERE, "lib/scaffold-site.sh")}"; scaffold_site "${SITE}" boardtest`,
    ], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (e) {
    skipReason = `the scaffold fixture could not be stood up: ${(e.stderr || e.message || "").toString().slice(-400)}`;
    return;
  }
  writeFileSync(join(SITE, "src/lib/variants.ts"), registryFor(BOARDS));
  mkdirSync(join(SITE, "src/pages/boards"), { recursive: true });
  rmSync(join(SITE, "src/pages/boards/b1.astro"), { force: true });
  for (const b of BOARDS) writeFileSync(join(SITE, `src/pages/boards/${b.id}.astro`), boardPage(b));
  // Real rasters the flattener has to carry into the seed directory: one as an <img>, one as
  // a CSS background, which is the shape a hero photograph usually takes.
  mkdirSync(join(SITE, "public/_fixture"), { recursive: true });
  writeFileSync(join(SITE, "public/_fixture/photo.png"), pngFixture(640, 400));
  writeFileSync(join(SITE, "public/_fixture/bg.png"), pngFixture(1440, 900));
  writeFileSync(join(SITE, "public/_fixture/tile.png"), pngFixture(320, 320));
  writeFileSync(join(SITE, "public/_fixture/notes.txt"), "not an image, and it answers 200\n");
  // The @import is FIRST because CSS ignores one that follows any other rule.
  writeFileSync(join(SITE, "public/_fixture/extra.css"), [
    '@import url("https://fonts.googleapis.com/css2?family=Fixture+Import&display=swap");',
    ".fixture-grain { filter: url(#fixture-grain); }",
    '.fixture-bg { background-image: url("/_fixture/tile.png"); background-size: cover; }',
    '.fixture-missing { background-image: url("/_fixture/gone.png"); }',
    // Fetches perfectly and is not an image. sharp refusing to decode it says the harvest
    // reached too far, not that the board is broken.
    '.fixture-notimage { background-image: url("/_fixture/notes.txt"); }',
    // Values no browser default and no inline style could produce, so an inline computed value
    // matching them proves the sheet was present when the flatten ran.
    '.fixture-classy { font-size: 27px; background-color: rgb(11, 22, 33); padding: 13px; }',
    "",
  ].join("\n"));
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
      { file: "B1.dc.html", id: "b1", ambition: 1, name: "One", height: 2000, feeling: "quiet", what: "A" },
      { file: "B2.dc.html", id: "b2", ambition: 2, name: "Two", height: 2400, feeling: "loud", what: "B" },
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
  assert.equal(b1.h, 2000, "the frame height is the rendered height, never a guess");
  assert.equal(doc.launch.view, "canvas");
  assert.ok(doc.annotations.some((a) => a.id === "cal-q"), "the calibration question is annotated");
  for (const a of doc.annotations) assert.match(a.id, /^[A-Za-z0-9_-]{1,40}$/);
});

// ---------------------------------------------------------------- the real run
test("two boards render to two artboards the canvas can open", async (t) => {
  if (!ready) return t.skip(skipReason);
  const r = await run([SITE, "--port", String(PORT)]);
  assert.equal(r.status, 0, `boards-render failed:\n${r.stderr}`);

  const seed = join(SITE, ".palate/explore/seed");
  for (const f of ["B1.dc.html", "B2.dc.html", "canvas.json", "README.md"]) {
    assert.ok(existsSync(join(seed, f)), `${f} is missing from the seed`);
  }

  for (const f of ["B1.dc.html", "B2.dc.html"]) {
    const a = readFileSync(join(seed, f), "utf8");
    assert.ok(a.startsWith("<!doctype html>"), `${f} does not open with the doctype`);
    assert.ok(a.includes('<script src="./support.js"></script>'), `${f} is missing the support line`);
    assert.ok(a.includes("<x-dc>"), `${f} has no x-dc root`);
    assert.ok(a.includes("<helmet><style>"), `${f} has no helmet`);

    // ONE script, or one plus an inlined motion script. Anything else is a third-party tag
    // that would silently fail inside a canvas with no network.
    const scripts = a.match(/<script\b/g) || [];
    assert.equal(scripts.length, 2, `${f} carries ${scripts.length} script tags; only support.js and the inlined motion script may travel`);
    assert.equal((a.match(/<script src=/g) || []).length, 1, `${f} carries an external script other than support.js`);
    assert.ok(!/tracker\.example\.com/.test(a), `${f} still carries a third-party tag, which cannot load inside a canvas with no network`);
    assert.ok(!/https:\/\/app\.humblytics\.com/.test(a), `${f} still carries the analytics tag`);
    assert.ok(a.includes('data-reveal'), `${f} dropped the site's own motion script, so the board is a still that says it moves`);

    // Every image is a bare filename that exists beside the artboard and fits.
    for (const m of a.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)) {
      const src = m[1];
      assert.ok(!/[/:]/.test(src), `${f} references ${src}, which is not a bare filename`);
      const p = join(seed, src);
      assert.ok(existsSync(p), `${f} references ${src}, which is not in the seed directory`);
      assert.ok(statSync(p).size <= 70 * 1024, `${src} is ${Math.round(statSync(p).size / 1024)} KB, over the 70 KB ceiling`);
    }
    assert.ok(!/\bsrcset=/.test(a), `${f} keeps a srcset, which overrides the bare filename with a URL the canvas cannot fetch`);

    // R2. AN INLINE DATA URI IS AN IMAGE, not an unfetchable URL. One of them aborted the whole
    // seed, so a board carrying a single inline icon had no canvas at all.
    const icon = /<img\b[^>]*\bdata-inline-icon\b[^>]*>/.exec(a);
    assert.ok(icon, `${f} lost the inline icon`);
    const iconSrc = /\bsrc="([^"]*)"/.exec(icon[0]);
    assert.ok(iconSrc && !/[/:]/.test(iconSrc[1]), `${f} kept the icon as a data URI or a path: ${iconSrc && iconSrc[1].slice(0, 40)}`);
    assert.match(iconSrc[1], /\.svg$/, "an SVG data URI was written with the wrong extension");
    assert.ok(existsSync(join(seed, iconSrc[1])), `${f} references ${iconSrc[1]}, which is not in the seed directory`);

    // The extension comes from the DECLARED media type, not from sniffing the payload: a long
    // prolog puts the root element past anything a sniff reads, and a vector written as a
    // photograph is a photograph from then on.
    const icon2 = /<img\b[^>]*\bdata-inline-b64\b[^>]*>/.exec(a);
    assert.ok(icon2, `${f} lost the base64 inline icon`);
    const icon2Src = /\bsrc="([^"]*)"/.exec(icon2[0]);
    assert.match(icon2Src[1], /\.svg$/, "a base64 SVG whose prolog hides its root element was written as a raster");
    assert.ok(existsSync(join(seed, icon2Src[1])));

    // The flattening actually happened: the panel has something to edit.
    assert.ok(/style="[^"]*font-size:/.test(a), `${f} has no inline font-size, so the property panel edits nothing`);
    assert.ok(/style="[^"]*color:/.test(a), `${f} has no inline colour`);

    // R1. THE FLATTEN HAPPENS WHILE THE STYLESHEETS ARE STILL THERE.
    //
    // The strip used to remove <link> and only then read computed styles, so every element
    // styled by the build's bundle (Tailwind utilities, globals.css, the brand tokens it
    // imports) had the BROWSER'S defaults written onto it: Times at 32px, no padding, an empty
    // --brand-accent. The artboard's own helmet still carried the real rules, and the inline
    // values overrode them. The shipped b1 example arrived unstyled on the one surface the
    // client picks from, and nine green tests never saw it because every fixture hero was
    // styled with inline attributes.
    const classy = /<p\b[^>]*\bdata-classy\b[^>]*>/.exec(a);
    assert.ok(classy, `${f} lost the class-styled paragraph`);
    assert.match(classy[0], /font-size:\s*27px/,
      `${f} flattened a class-styled element to the browser default instead of the stylesheet's value`);
    assert.match(classy[0], /background-color:\s*rgb\(11,\s*22,\s*33\)/,
      `${f} flattened a class-styled background to the browser default`);
    assert.match(classy[0], /padding:\s*13px/, `${f} flattened away a class-set padding`);

    // R3. EVERY ELEMENT CARRIES A STABLE KEY, which is what lets the read-back tell a deletion
    // from a shift. Without it the diff can only align by position, and deleting one paragraph
    // on the canvas reported every element after it as an edit: 167 of them on a real board,
    // with the run then telling Compose to honour all of them.
    const keys = [...a.matchAll(/data-palate-k="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(keys.length > 10, `${f} carries ${keys.length} element keys, so the read-back can only align by position`);
    assert.equal(new Set(keys).size, keys.length, `${f} repeats an element key, which makes two elements the same element`);

    // I3. A CSS BACKGROUND IMAGE IS AN IMAGE. A hero photograph is usually set as one, and
    // `rule.cssText` serialises its URL absolute, so it survived as a link to the local build
    // server: no egress in the canvas, no refusal either, and the hero renders blank on the one
    // surface the client picks from.
    // Google's two font hosts are the ONLY external origins the canvas allows, so they are the
    // only ones a url() may name. Everything else has to be a file beside the artboard.
    const remote = [...a.matchAll(/url\((["']?)(https?:\/\/[^)"']+)\1\)/g)]
      .map((m) => m[2])
      .filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
    assert.equal(remote.length, 0,
      `${f} points a url() at an origin the canvas cannot reach: ${remote.slice(0, 2).join(", ")}`);
    // A fragment names an element in this very document and is deliberately left as written,
    // so it is not a file that has to exist beside the artboard.
    const bgs = [...a.matchAll(/url\((["']?)([^)"']+)\1\)/g)]
      .map((m) => m[2])
      .filter((u) => !u.startsWith("data:") && !u.startsWith("#") && !/^https?:\/\//.test(u));
    assert.ok(bgs.length, `${f} carries no url() at all, so this assertion is measuring nothing`);
    for (const u of bgs) {
      assert.ok(!/[/:]/.test(u), `${f} references ${u} in a url(), which is not a bare filename`);
      assert.ok(existsSync(join(seed, u)), `${f} references ${u} in a url(), which is not in the seed directory`);
      assert.ok(statSync(join(seed, u)).size <= 70 * 1024, `${u} is over the 70 KB ceiling`);
    }

    // I4. THE GOOGLE FONTS SHEET IS CROSS-ORIGIN, so cssRules throws and the head is never
    // serialised. Without explicit handling the faces a brand-creation Explore chose are simply
    // absent, and the fidelity gate's own copy calls the faces the loudest thing a client picked.
    assert.match(a, /@import url\(["']?https:\/\/fonts\.googleapis\.com/,
      `${f} lost its Google Fonts stylesheet, so the artboard renders in a face nobody chose`);
    // Both forms reach the artboard: the <link> Google's embed dialog offers first, and the
    // @import form it offers beside it, which is what a component-scoped <style> reaches for.
    assert.match(a, /family=Fixture\+Face/, `${f} lost the Google Fonts <link> form`);
    assert.match(a, /family=Fixture\+Import/, `${f} lost the Google Fonts @import form`);

    // A FRAGMENT URL IS NOT AN IMAGE. `filter: url(#grain)` resolves against the page, so
    // harvesting it fetches the board's own HTML; it must survive untouched.
    assert.match(a, /url\((["']?)#fixture-grain\1\)/, `${f} rewrote or dropped an SVG filter reference`);

    // A url NOTHING COULD FETCH is removed, not left pointing at a dead path: inside a canvas
    // with no egress that is a blank box rather than a broken-image icon.
    assert.ok(!/gone\.png/.test(a), `${f} kept a url() that could not be fetched`);

    // A class-set background IS an image and takes the helmet-CSS rewrite path.
    assert.ok(/\.fixture-bg\{[^}]*background-image:\s*url\((["']?)b\d+-img\d+\.[a-z]+\1\)/.test(a.replace(/\s+/g, " ")) ||
      /fixture-bg[^}]*url\((["']?)b\d+-img/.test(a),
      `${f} left a class-set background pointing somewhere the canvas cannot fetch`);
    const helmetStyle = /<helmet><style>([\s\S]*?)<\/style>/.exec(a);
    assert.ok(helmetStyle, `${f} has no helmet style`);
    assert.match(helmetStyle[1].trimStart(), /^@import/,
      `${f} puts @import after other rules, where CSS ignores it`);

    // I5. THE DIRECTION PICKER IS OPERATOR SCAFFOLDING. Its links 404 inside the canvas and a
    // client can select and restyle it.
    // Keyed on the ELEMENT, not on any mention: the picker's own rules survive in the helmet
    // stylesheet, which is dead CSS rather than scaffolding a client can select and restyle.
    assert.ok(!/class="[^"]*\bev-(switcher|panel|pill)\b/.test(a), `${f} carries the direction picker`);
    assert.ok(!/<a\b[^>]*href="\/boards\//.test(a), `${f} carries a link to another board, which 404s inside the canvas`);

    // I6. A REVEAL HELD BELOW THE FOLD IS CAPTURED IN ITS UNSEEN STATE unless something scrolls
    // the page first. The bold rungs are the ones told to use scroll-as-timeline, so they are
    // the ones most likely to flatten with everything below the hero invisible.
    assert.match(a, /data-revealed="1"/,
      `${f} was captured before its scroll reveals fired, so it holds the unseen state`);
    assert.ok(!/data-reveal[^>]*style="[^"]*opacity:\s*0(;|")/.test(a),
      `${f} carries a reveal still at opacity 0`);
  }

  const canvas = JSON.parse(readFileSync(join(seed, "canvas.json"), "utf8"));
  assert.equal(canvas.artboards.length, 2);
  const [f1, f2] = canvas.artboards;
  assert.equal(f2.x - (f1.x + f1.w), 80, "80px between frames");
  assert.equal(f1.w, 1440);
  assert.ok(f1.h > 800, `the frame height reads ${f1.h}, which is not a rendered page`);
  assert.equal(canvas.annotations.length, 2, "one annotation per board");
  assert.equal(canvas.launch.view, "canvas");

  // The shots the fidelity gate and /explore read.
  for (const id of ["b1", "b2"]) {
    assert.ok(existsSync(join(SITE, ".palate/explore/shots", id, "rendered.html")));
    assert.ok(existsSync(join(SITE, ".palate/explore/shots", id, "hero.png")));
    assert.ok(existsSync(join(SITE, "public/_explore", `${id}.png`)));

    const archived = readFileSync(join(SITE, ".palate/explore/shots", id, "rendered.html"), "utf8");

    // The archived render is the fidelity gate's evidence and the uniqueness gate's, so it has
    // to hold the SEEN state too: a page captured at scroll 0 archives its reveals unfired.
    assert.match(archived, /data-revealed="1"/,
      `${id}'s archived render was taken before its scroll reveals fired`);

    // BUILT IN EXPLORE MODE, or the boards do not exist in the output. SectionMark renders
    // nothing without PUBLIC_EXPLORE_MODE, so the archived renders came back with no section
    // ids at all and gate-fidelity skipped with "its sections cannot be identified" on a build
    // that had done everything right. Found by running the whole loop, not by reading it.
    assert.match(archived, new RegExp(`data-section-id="${id}-hero"`),
      `${id}'s archived render carries no section id, so nothing downstream can identify its sections`);

    // SELF-CONTAINED, because it has to outlive the build it came from. The render links
    // /_astro/<hash>.css; Compose rebuilds, the hash changes, the old file is gone, and the
    // archived board renders UNSTYLED. gate-fidelity then measured a page with no palette and
    // no type scale and called both "could not be compared" on an honest build.
    assert.match(archived, /data-palate-archived-css/, `${id}'s archived render carries no stylesheet of its own`);
    assert.ok(!/<link\b[^>]*rel=["']stylesheet["']/i.test(archived),
      `${id}'s archived render still links a stylesheet, which the next build renames`);
  }
  assert.match(r.stdout, /B1\.dc\.html \d+ KB/, "the run does not report the artboard sizes");

  // A URL THAT CANNOT BE FETCHED IS DROPPED AND NAMED, never a refusal. A rule in a shared
  // stylesheet can point at an asset that belongs to another page; before this it refused every
  // board, with a message that read as a broken image rather than as the harvest over-reaching.
  assert.match(r.stdout + r.stderr, /gone\.png/,
    "a url that could not be fetched was dropped without saying which one");

  // AND A FRAGMENT IS NEVER FETCHED AT ALL. Resolved against the page it becomes the board's
  // own URL, so harvesting one costs a pointless request and prints a line naming the board
  // itself as an image that could not be read, which is the harvest over-reaching in public.
  assert.ok(!/dropped\s+\S*#fixture-grain/.test(`${r.stdout}\n${r.stderr}`),
    "an SVG filter reference was fetched as though it were an image");

  // A URL THAT FETCHES AND IS NOT AN IMAGE is dropped and named too. Before this it reached
  // sharp, threw, and refused the whole seed with a message about a broken image.
  assert.match(r.stdout + r.stderr, /notes\.txt.*not a decodable image/,
    "a url that fetched but is not an image was not dropped and named");
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

  const r = await run([SITE, "--port", String(PORT), "--no-build", "--refs", ".palate/explore/refs.json"]);
  assert.equal(r.status, 0, `boards-render with --refs failed:\n${r.stderr}`);

  const seed = join(SITE, ".palate/explore/seed");
  for (const n of [1, 2, 3]) {
    const f = join(seed, `Ref${n}.dc.html`);
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
    assert.ok(existsSync(join(seed, img[1])));
    assert.ok(statSync(join(seed, img[1])).size <= 70 * 1024, `${img[1]} is over the 70 KB ceiling`);
  }
  assert.ok(readFileSync(join(seed, "Ref1.dc.html"), "utf8").includes("one photograph and a great deal of air"),
    "the reference does not say why it sits where it does on the range");

  const canvas = JSON.parse(readFileSync(join(seed, "canvas.json"), "utf8"));
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

test("an SVG over the ceiling is refused rather than shipped broken", async (t) => {
  if (!ready) return t.skip(skipReason);
  // A RASTER ALMOST ALWAYS FITS. The ladder walks down to 640 wide at quality 38, and 1440x900
  // of pure per-pixel noise lands at 33 KB there, so a photograph cannot exercise the refusal.
  // An SVG can and does: it is already lossless, re-encoding a diagram as a photograph would be
  // worse in every way, so it travels whole or not at all. A 90 KB path-heavy logo is ordinary.
  const big = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    Array.from({ length: 2600 }, (_, i) => `<path d="M${i % 97}.${i % 7} ${i % 89}.${i % 3}l1.5 2.25 3.75-1.125z" fill="#2f5d50"/>`).join("") +
    `</svg>`;
  assert.ok(Buffer.byteLength(big) > 70 * 1024, "the fixture SVG is not actually over the ceiling");
  writeFileSync(join(SITE, "public/_fixture/big.svg"), big);
  const page = readFileSync(join(SITE, "src/pages/boards/b1.astro"), "utf8");
  writeFileSync(join(SITE, "src/pages/boards/b1.astro"),
    page.replace('src="/_fixture/photo.png"', 'src="/_fixture/big.svg"'));

  const rebuilt = await run([SITE, "--port", String(PORT)]);
  assert.equal(rebuilt.status, 2, "an SVG over the ceiling must exit 2");
  assert.match(rebuilt.stderr, /b1/, "the refusal does not name the board");
  assert.match(rebuilt.stderr, /cannot be downsampled under 70 KB/);
  assert.ok(!existsSync(join(SITE, ".palate/explore/seed")), "a seed was left behind");

  writeFileSync(join(SITE, "src/pages/boards/b1.astro"), page);
  rmSync(join(SITE, "public/_fixture/big.svg"), { force: true });
  // Put the seed back so the next test has one to destroy.
  const restored = await run([SITE, "--port", String(PORT)]);
  assert.equal(restored.status, 0, `the restore build failed:\n${restored.stderr}`);
});

test("a calibration reference missing its screenshot is refused", async (t) => {
  if (!ready) return t.skip(skipReason);
  const refsDir = join(SITE, ".palate/explore");
  writeFileSync(join(refsDir, "refs.json"), JSON.stringify([
    { slug: "aesop", name: "Aesop", position: 1, why: "Restrained.", screenshot: "refshots/gone.png" },
  ]));
  const r = await run([SITE, "--port", String(PORT), "--no-build", "--refs", ".palate/explore/refs.json"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /aesop/, "the refusal does not name the reference");
  rmSync(join(refsDir, "refs.json"), { force: true });
});

test("it renders through a symlinked path, instead of exiting 0 having done nothing", async (t) => {
  if (!ready) return t.skip(skipReason);
  // FOUND BY A REAL SEED RUN, NOT BY THIS SUITE, and the suite could not have found it: every
  // test here invokes the script by its real path. The guard compared `resolve(process.argv[1])`
  // with `fileURLToPath(import.meta.url)`, and `resolve` does not follow symlinks while Node's
  // module loader does. On macOS `/tmp` is a symlink to `/private/tmp`, which is where every
  // `mktemp -d` lands, so `main()` never ran: no stdout, no stderr, exit 0, no seed. An operator
  // reads that as a render that wrote nothing.
  // unlink, not rm: on macOS rmSync on a symlink to a directory reports the TARGET's type and
  // refuses, which would have this test tear down the repo's own path if it ever followed.
  const link = join(TMP, "plugin-link");
  try { unlinkSync(link); } catch { /* not there yet */ }
  symlinkSync(realpathSync(ROOT), link);
  const linkedCli = join(link, "scripts", "boards-render.mjs");
  assert.notEqual(linkedCli, join(realpathSync(ROOT), "scripts", "boards-render.mjs"),
    "the symlink resolves to the same string, so this test is measuring nothing");

  rmSync(join(SITE, ".palate/explore/seed"), { recursive: true, force: true });
  const r = await promisify(execFile)(process.execPath, [linkedCli, SITE, "--port", String(PORT), "--no-build"], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  }).then((o) => ({ status: 0, ...o })).catch((e) => ({ status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }));

  assert.equal(r.status, 0, `through a symlink it failed:\n${r.stderr}`);
  assert.match(r.stdout, /board\(s\) written/, "it exited 0 having printed nothing, which reads as a render that wrote nothing");
  assert.ok(existsSync(join(SITE, ".palate/explore/seed/B1.dc.html")), "no seed was written through the symlinked path");
  unlinkSync(link);
});

test("the declared frame height is the height the artboard actually renders", async (t) => {
  if (!ready) return t.skip(skipReason);
  // THE FRAME NEITHER SCALES NOR CROPS, and `x-dc` carries `overflow: hidden`, so a frame
  // declared shorter than its content clips the bottom off every board with nothing reporting
  // it. The height used to be read from the LIVE page before the flatten, and the flatten
  // re-lays the page out: measured on a real five-board seed the artboards rendered 26 to 42px
  // taller than their frames, almost all of it the system strip.
  const seeded = await run([SITE, "--port", String(PORT), "--no-build"]);
  assert.equal(seeded.status, 0, seeded.stderr);
  const seed = join(SITE, ".palate/explore/seed");
  const canvas = JSON.parse(readFileSync(join(seed, "canvas.json"), "utf8"));

  const { chromium } = await import(join(ROOT, "scripts/reference-capture/node_modules/playwright/index.mjs"));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    let sawADifference = false;
    for (const frame of canvas.artboards.filter((a) => a.file.startsWith("B"))) {
      await page.goto(`file://${join(seed, frame.file)}`, { waitUntil: "load" });
      await page.waitForTimeout(200);
      const rendered = await page.evaluate(() => {
        const dc = document.querySelector("x-dc");
        return dc ? Math.ceil(Math.max(dc.getBoundingClientRect().height, dc.scrollHeight)) : null;
      });
      assert.ok(rendered, `${frame.file} has no x-dc to measure`);
      assert.equal(frame.h, rendered,
        `${frame.file} declares ${frame.h}px and renders ${rendered}px; the canvas clips the difference`);

    }
    // The fixture has to exercise the defect or this test proves nothing. The board pages are
    // built pages; open one and compare the height a pre-flatten read would have recorded.
    const distRoot = ["dist/client", "dist"].map((d) => join(SITE, d)).find((d) => existsSync(join(d, "index.html")));
    await page.goto(`file://${join(distRoot, "boards/b1/index.html")}`, { waitUntil: "load" });
    await page.waitForTimeout(200);
    const liveHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    const b1 = canvas.artboards.find((a) => a.file === "B1.dc.html");
    if (liveHeight !== b1.h) sawADifference = true;
    assert.ok(sawADifference,
      `the flatten no longer changes this fixture's layout (live ${liveHeight}, artboard ${b1.h}), so this test measures nothing; give a board an element whose layout the flatten moves`);
  } finally {
    await browser.close().catch(() => {});
  }
});

test("a registered board with no page leaves NO seed behind", async (t) => {
  if (!ready) return t.skip(skipReason);
  const seed = join(SITE, ".palate/explore/seed");
  // Its own setup, not the previous test's leftovers: every refusal clears the seed, so
  // whether one is on disk here depends on which tests ran before this one.
  const seeded = await run([SITE, "--port", String(PORT)]);
  assert.equal(seeded.status, 0, `the setup render failed:\n${seeded.stderr}`);
  assert.ok(existsSync(seed), "the setup render wrote no seed");

  const three = [...BOARDS, {
    id: "b3", name: "The Loud Room", ambition: 3, section: "menu", donor: "utsubo",
    what: "A full-bleed type wall.", why: "This launch has to be seen from across a room.",
    feeling: "brash, certain", motion: "The wall scrubs with the scroll.",
    ctas: ["Get tickets", "See the line-up"],
  }];
  writeFileSync(join(SITE, "src/lib/variants.ts"), registryFor(three));

  const r = await run([SITE, "--port", String(PORT), "--no-build"]);
  assert.equal(r.status, 2, "a board with no page must exit 2");
  assert.match(r.stderr, /b3/, "the failure does not name the board");
  assert.ok(!existsSync(seed), "a partial seed was left on disk, and half a set reads as the whole set");

  writeFileSync(join(SITE, "src/lib/variants.ts"), registryFor(BOARDS));
});
