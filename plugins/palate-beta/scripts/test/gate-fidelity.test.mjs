/**
 * gate-fidelity.test.mjs - does the built home page actually carry the direction the client
 * picked?
 *
 * This is the one promise Explore makes that nothing has ever checked. A client picks rung 3,
 * Compose writes the home page, and whether the thing they chose survived the trip has until
 * now been a matter of the builder's own opinion at the moment they were most invested in the
 * answer. The interesting failure is not a wrong page, it is a plausible one: the same layout
 * in a slightly different accent, the same accent at a slightly different type scale, the
 * picked section quietly dropped.
 *
 * So the assertions are about the gate catching a plausible drift and refusing to claim
 * anything it did not measure.
 *
 * THE PICKED BOARD IS AN ARTBOARD, not something this suite builds with Astro any more
 * (Task 3). Its archived render (`shots/b1/rendered.html`) is written directly as a fixture,
 * self-contained CSS and a bare-filename image beside it, exactly the shape boards-render.mjs
 * now produces. boards-render.mjs is never invoked here.
 *
 * Slow: an npm install, an Astro build (for the home) and a browser. run.sh skips it under
 * --fast.
 * Run: node --test scripts/test/gate-fidelity.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "scripts", "gate-fidelity.mjs");
const PORT = 8791; // reserved for this suite
// The same engine gate-fidelity.mjs itself loads playwright from, so a screenshot taken here
// renders identically to one it would take.
const engineRequire = createRequire(new URL("../reference-capture/", import.meta.url));
let browser = null;

let TMP = null;
let SITE = null;
let ready = false;
let skipReason = "";

const REGISTRY = `export interface Variant {
  id: string; name: string; href: string; artboard: string; ambition: number; what: string;
  why: string; feeling: string; donor: string; section: string; motion: string; ctas: string[];
  clip?: string; lookAt?: string;
}
export const variants: Variant[] = [
  {
    id: "b1", name: "The Quiet Room", href: "/boards/b1", artboard: "B1.dc.html", ambition: 1,
    what: "One column, one photograph, and a great deal of air.",
    why: "The people arriving are anxious and have been dismissed once already.",
    feeling: "unhurried, private, adult",
    donor: "therapy-in-london", section: "services",
    motion: "Nothing moves on load; the photograph fades in once it is scrolled to.",
    ctas: ["Book a first visit", "Ask a question"],
  },
];
export const landingVariants: Variant[] = [];
export function byAmbition(list: Variant[]): Variant[] {
  return [...list].sort((a, b) => (a.ambition ?? 0) - (b.ambition ?? 0));
}
`;

/** The two sections the board shows, written once and used by both the board and the home. */
// THE MARKER GOES ON THE SECTION, which is what the doctrine tells Compose to do. It was on
// an inner span first, and that hid a real defect: the gate hid `[data-palate-section]` as
// Explore scaffolding, which on a real composed page hides every section of it. The built home
// then measured as setting no type at all and the gate failed an honest build.
/**
 * `badge` is the SectionMark, INSIDE the hero, in a face the design never chose. It is the
 * control for excluding scaffolding from the comparison: the board carries it and the composed
 * home never does, so a gate that measures it reports "missing ui-monospace" on an honest build.
 */
const HERO = (mark, badge = "", img = "") => `
<section class="relative px-6 py-24" style="background:#f7f5ee" ${mark}>${badge}
  <div class="mx-auto max-w-3xl">
    <h1 style="font-family:Georgia,serif;font-size:64px;line-height:1.08;color:#1c1b19">Quiet confidence, in a room that holds it</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:18px;line-height:1.6;color:#1c1b19">We look after the whole thing, slowly, and we tell you what we found. Nothing here asks anything of you before you have read a sentence, which is the point of the room.</p>
    <a href="/contact" style="display:inline-flex;min-height:44px;align-items:center;padding:12px 24px;background:ACCENT;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px">Book a first visit</a>
    ${img}
  </div>
</section>`;

const SERVICES = (mark) => `
<section class="relative px-6 py-20" style="background:#f7f5ee" ${mark}>
  <div class="mx-auto max-w-5xl">
    <h2 style="font-family:Georgia,serif;font-size:32px;line-height:1.2;color:#1c1b19">What we look after</h2>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:18px;line-height:1.6;color:#1c1b19">Three things, done properly, and we will say so when a fourth is not worth your money at all. That is the whole of the offer and it does not change.</p>
  </div>
</section>`;

const BADGE = '<span data-palate-mark data-section-id="b1-hero" style="font-family:ui-monospace,monospace;font-size:10px;color:#ffffff;background:#000000">b1-hero</span>';

/**
 * The picked board's archived render, written directly as a fixture: exactly what
 * boards-render.mjs now produces from a `.dc.html` artboard (Task 3), not something this
 * suite builds. Self-contained CSS in its own helmet, a navigation header FIRST (BoardFrame's
 * own chrome, ahead of the hero, which is why the gate has to find the hero by name and not
 * by position), then the hero and the inner section under test, in the accent the client
 * picked (fixed at #2f5d50 throughout this file; the home's own accent is what each test
 * varies).
 */
/**
 * `heroWrap` re-roots the hero on another tag. A marked root is a sectioning element on a board
 * boards-render will accept, and this gate must still measure one that is not: the scaffolding
 * sweep hid `[data-section-id]:not(section)` with no exclusion for the hero itself, so a
 * div-rooted hero was the one element the whole comparison is scoped to, hidden.
 */
const asDiv = (markup) => markup.replace("<section ", "<div ").replace("</section>", "</div>");

function boardArtboard(heroWrap = (x) => x) {
  return "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<script src=\"./support.js\"></script></head><body><x-dc>" +
    "<helmet><style>a{color:#000}a:hover{color:#333}</style></helmet>" +
    "<header class=\"nav\" data-section-id=\"b1-navigation\"><a class=\"nav-logo\" href=\"#\">Eastcoast</a><a class=\"nav-cta\" href=\"#\">Ring</a></header>" +
    heroWrap(HERO('data-section-id="b1-hero"', BADGE, '<img src="b1-img1.jpg" alt="">')).replace("ACCENT", "#2f5d50") +
    SERVICES('data-section-id="b1-services"') +
    '<aside class="motion-note" data-palate-motion="">On load the column rules draw down over 800ms on one curve, then hold; nothing loops.</aside>' +
    '<section class="cta" data-section-id="b1-cta"><a class="cta-btn" href="#">Book</a></section>' +
    '<footer class="footer" data-section-id="b1-footer"><p class="footer-line">Ballina</p></footer>' +
    "</x-dc></body></html>";
}

/**
 * The archived shot, written directly: the fixture form of what boards-render.mjs leaves.
 *
 * `hero.png` is a REAL screenshot of the artboard's own markup, taken the same way
 * boards-render.mjs takes it (over file://, at 1440x900), not an unrelated synthetic image.
 * The gate's appearance-similarity check compares it against a screenshot of the BUILT HOME,
 * and the home renders the identical HERO() markup (same faces, same accent, same copy) once
 * an honest build lands, so a fixture that is not visually related to that would fail the
 * gate's own 0.85 floor on every honest build and the drift tests would prove nothing.
 */
async function writeBoardFixture(heroWrap = (x) => x) {
  const shotsDir = join(SITE, ".palate/explore/shots/b1");
  mkdirSync(shotsDir, { recursive: true });
  const renderedPath = join(shotsDir, "rendered.html");
  writeFileSync(renderedPath, boardArtboard(heroWrap));
  writeFileSync(join(shotsDir, "b1-img1.jpg"), Buffer.alloc(1024, 0xaa));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(pathToFileURL(renderedPath).href, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(shotsDir, "hero.png") });
  } finally {
    await page.close();
  }
}

/**
 * A minimal static file server, just enough to prove a relative image resolves when the
 * board's own directory is the origin, the exact thing this task changed gate-fidelity.mjs
 * to rely on (serving `shots/<id>/` itself rather than the build's `dist/`). Not a stand-in
 * for the gate's own server; a separate, independent check of the same fact.
 */
const CONTENT_TYPES = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
function serveStatic(root) {
  return new Promise((ok, no) => {
    const server = createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, "http://l").pathname); }
      catch { res.writeHead(400); res.end(); return; }
      const p = join(root, pathname === "/" ? "rendered.html" : pathname);
      try {
        const data = readFileSync(p);
        res.writeHead(200, { "Content-Type": CONTENT_TYPES[p.slice(p.lastIndexOf("."))] || "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.on("error", no);
    server.listen(0, () => ok(server));
  });
}

/**
 * A THIRD SECTION, IN A FACE THE BOARD NEVER SET, sitting inside the top 900px.
 *
 * It is the control for the scoping. The comparison used to be "everything above the fold",
 * which is not symmetric: below the board's hero sits the system strip and below the home's
 * sits the next real section. This block makes that asymmetry visible in the unit suite, where
 * before it only showed up on a real end-to-end run: scoped to the hero it is correctly
 * ignored, and through a 900px window it arrives as a face the client never picked.
 */
const BELOW = `
<section class="relative px-6 py-4" style="background:#f7f5ee;font-family:'Courier New',monospace">
  <p style="font-family:'Courier New',monospace;font-size:15px;line-height:1.6;color:#1c1b19">A band the board never had, in a face the board never set, close enough to the top of the page to sit inside any fold-shaped window somebody might reach for.</p>
</section>`;

const homePage = (accent, heroWrap = (x) => x) => `---
import BaseLayout from "../layouts/BaseLayout.astro";
import { business } from "../lib/business";
---
<BaseLayout title={business.name}>
  <Fragment set:html={${JSON.stringify(heroWrap(HERO('data-palate-section="b1-hero"')))}.replace("ACCENT", ${JSON.stringify(accent)})} />
  <Fragment set:html={${JSON.stringify(BELOW)}} />
  <Fragment set:html={${JSON.stringify(SERVICES('data-palate-section="b1-services"'))}} />
</BaseLayout>
`;

const run = async (args, env = {}, execOpts = {}) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, ...args], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env }, ...execOpts,
    });
    return { status: 0, stdout, stderr, killed: false };
  } catch (e) {
    // `killed` and `signal` are set when execFile's own `timeout` option had to intervene,
    // which is how a hung gate (a browser or a server left open, keeping the event loop alive)
    // is told apart from one that exited on its own with a non-zero code.
    return { status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "", killed: Boolean(e.killed), signal: e.signal ?? null };
  }
};

/** Is this port free to bind right now? Used to prove a server the gate opened was closed. */
function portIsFree(port) {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.listen(port, () => probe.close(() => resolveFree(true)));
  });
}

const build = () => execFileSync(join(SITE, "node_modules/.bin/astro"), ["build"], {
  cwd: SITE, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PUBLIC_EXPLORE_MODE: "true" },
});

function writeManifest(picks) {
  writeFileSync(join(SITE, "build-manifest.json"), JSON.stringify({
    schema: 3, project: SITE, mcp_calls: [],
    explore: { ran: true, shown_at: new Date(Date.now() - 90_000).toISOString(), picks },
  }, null, 2));
}

before(async () => {
  if (!existsSync(join(ROOT, "scripts/reference-capture/node_modules/playwright"))) {
    skipReason = "playwright is not installed (scripts/reference-capture/setup.sh); fidelity is UNPROVEN.";
    return;
  }
  const { chromium } = engineRequire("playwright");
  browser = await chromium.launch();
  TMP = mkdtempSync(join(tmpdir(), "gate-fidelity-"));
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
  writeFileSync(join(SITE, "src/lib/variants.ts"), REGISTRY);
  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#2f5d50"));
  writeManifest([]);
  // The picked board's archived render, written directly (never boards-render.mjs; see the
  // file header).
  await writeBoardFixture();
  ready = true;
});

after(async () => {
  if (browser) await browser.close().catch(() => {});
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

test("no picks is a refusal, never a pass", async (t) => {
  if (!ready) return t.skip(skipReason);
  writeManifest([]);
  const r = await run([SITE, "--port", String(PORT)]);
  assert.equal(r.status, 2, "a build with no picks must exit 2");
  assert.match(r.stderr, /no picks recorded/);
});

test("an honest build passes, and says what it could not measure", async (t) => {
  if (!ready) return t.skip(skipReason);
  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#2f5d50"));
  build();
  writeManifest([{ surface: "hero", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() }]);
  const r = await run([SITE, "--port", String(PORT)]);
  assert.equal(r.status, 0, `an honest build should pass:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /b1-hero/, "the gate does not say which section it matched");

  // THE APPEARANCE HEAD IS TRIED, AND WHATEVER HAPPENS IS SAID.
  //
  // It used to be skipped unless PALATE_TASTE=1 was exported, which is not the head's own
  // consent gate: taste-local asks for consent only when the model is NOT CACHED and says so
  // ("once the model is cached the gate is moot"). So an operator who had already run
  // setup.sh --with-taste still got UNMEASURED, on every run, from a check that could have run.
  // The gate now calls it and reports either a number or the head's own reason for refusing.
  const sim = /appearance similarity ([^\n]*)/.exec(`${r.stdout}\n${r.stderr}`);
  assert.ok(sim, "the gate says nothing at all about the appearance similarity");
  assert.ok(!/PALATE_TASTE|opt-in/.test(sim[1]),
    `the similarity is gated on an environment variable rather than on whether the head can load: ${sim[1]}`);
  assert.ok(/^[0-9]/.test(sim[1]) || /UNMEASURED/.test(sim[1]),
    `the similarity is neither a number nor a stated refusal: ${sim[1]}`);
});

test("the hero is found by name when the board opens with navigation", async (t) => {
  if (!ready) return t.skip(skipReason);
  // Fixture assumption this case exists to protect: the artboard's FIRST data-section-id is
  // its navigation, not its hero.
  const rendered = readFileSync(join(SITE, ".palate/explore/shots/b1/rendered.html"), "utf8");
  assert.match(rendered, /data-section-id="b1-navigation"[\s\S]*data-section-id="b1-hero"/,
    "fixture setup is wrong: navigation must precede the hero in the archived render");
  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#2f5d50"));
  build();
  writeManifest([{ surface: "hero", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() }]);
  const r = await run([SITE, "--port", String(PORT)]);
  assert.equal(r.status, 0, `an honest build with navigation opening the board should pass:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /hero b1-hero/, "the gate names the navigation, not the hero, as the picked hero");
});

test("a hero marked on a div is measured, and its structure is still compared", async (t) => {
  if (!ready) return t.skip(skipReason);
  // THE SCAFFOLDING SWEEP USED TO HIDE THE HERO ITSELF. `[data-section-id]:not(section)` is
  // aimed at the SectionMark badge inside a hero, and it matches a hero root that is a `<div>`
  // (or a `<header>`), so the one element the comparison is scoped to was set to
  // `visibility: hidden` and the board measured as setting no type and no accent at all: an
  // honest build then failed on "the board sets [nothing]". The second half is quieter still:
  // `sectionMarkup` walked back to the nearest `<section`, which on a div-rooted hero returns
  // the previous section or nothing, and a null there skips the skeleton comparison in silence.
  await writeBoardFixture(asDiv);
  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#2f5d50", asDiv));
  build();
  writeManifest([{ surface: "hero", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() }]);
  const r = await run([SITE, "--port", String(PORT)]);
  const said = `${r.stdout}\n${r.stderr}`;
  assert.doesNotMatch(said, /the board sets \[nothing\]/,
    `the div-rooted hero was hidden, so the board measured as setting nothing:\n${said}`);
  assert.equal(r.status, 0, `an honest build whose hero root is a div should pass:\n${said}`);
  assert.match(r.stdout, /hero b1-hero/, "the gate does not name the div-rooted hero it scoped to");
  // The skeleton check RAN, rather than returning null and passing over itself.
  assert.match(r.stdout, /matches the board's structure at/,
    `the section skeleton comparison was skipped on a div-rooted hero:\n${said}`);

  await writeBoardFixture();
  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#2f5d50"));
  build();
});

test("the board's own image resolves when its own directory is the origin", async (t) => {
  if (!ready) return t.skip(skipReason);
  // The point of serving the board from `shots/<id>/` rather than `dist/` (this task): the
  // hero's bare-filename image resolves against its OWN directory, not the build's. Proven
  // independently of the CLI, over a plain static server rooted at that exact directory.
  const shotsDir = join(SITE, ".palate/explore/shots/b1");
  const server = await serveStatic(shotsDir);
  const { port } = server.address();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failed = [];
  const responses = [];
  page.on("requestfailed", (req) => failed.push(req.url()));
  page.on("response", (res) => responses.push({ url: res.url(), status: res.status() }));
  try {
    await page.goto(`http://127.0.0.1:${port}/rendered.html`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(200);
  } finally {
    await page.close();
    server.close();
  }
  assert.ok(!failed.some((u) => u.includes("b1-img1.jpg")),
    `the board's own image failed at the network level when served from its own directory: ${failed.join(", ") || "(none)"}`);
  const imgResponse = responses.find((r) => r.url.includes("b1-img1.jpg"));
  assert.ok(imgResponse, "no request was ever made for the board's own image (the fixture is missing the <img> reference)");
  assert.equal(imgResponse.status, 200,
    `the board's own image did not resolve (status ${imgResponse.status}) when served from its own directory`);
});

test("an accent moved past deltaE 6 fails, naming both hexes", async (t) => {
  if (!ready) return t.skip(skipReason);
  // Still a green, still a plausible build, and far enough that a reader would see it.
  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#1f7fd0"));
  build();
  writeManifest([{ surface: "hero", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() }]);
  const r = await run([SITE, "--port", String(PORT)]);
  assert.equal(r.status, 1, `a changed accent should fail:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /#2f5d50/, "the failure does not name the picked accent");
  assert.match(r.stderr, /#1f7fd0/i, "the failure does not name the built accent");
  assert.match(r.stderr, /deltaE/i);
});

test("the picked section going missing fails, naming it", async (t) => {
  if (!ready) return t.skip(skipReason);
  writeFileSync(join(SITE, "src/pages/index.astro"),
    homePage("#2f5d50").replace(/<Fragment set:html=\{JSON[\s\S]*$/, "").replace(/\n$/, "") + "\n");
  // Rebuild with only the hero, which is the drift that matters: the client picked a section
  // and the built page does not have it.
  const only = `---
import BaseLayout from "../layouts/BaseLayout.astro";
import { business } from "../lib/business";
---
<BaseLayout title={business.name}>
  <Fragment set:html={${JSON.stringify(HERO('data-palate-section="b1-hero"').replace("ACCENT", "#2f5d50"))}} />
</BaseLayout>
`;
  writeFileSync(join(SITE, "src/pages/index.astro"), only);
  build();
  writeManifest([
    { surface: "hero", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() },
    { surface: "section", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() },
  ]);
  const r = await run([SITE, "--port", String(PORT)]);
  assert.equal(r.status, 1, `a missing picked section should fail:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /b1-services/, "the failure does not name the missing section");

  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#2f5d50"));
  build();
});

test("--serve reaches the comparison even with no dist directory", async (t) => {
  if (!ready) return t.skip(skipReason);
  writeManifest([{ surface: "hero", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() }]);
  // No build at all for this case: the board is an artboard and no longer needs one, so the
  // OLD skip text ("a build is required even with --serve") must never appear again once a
  // --serve URL is given. It is fine for the run to still fail, since the url below serves
  // nothing real; what matters is which reason it fails for.
  rmSync(join(SITE, "dist"), { recursive: true, force: true });
  const r = await run([SITE, "--port", String(PORT), "--serve", "http://127.0.0.1:1/nowhere"]);
  // The dist skip must never fire once --serve is given, whatever it happens to say: assert
  // the POSITIVE (it reached the comparison and failed only because the served URL answers
  // nothing) rather than one literal old phrase, or a reworded dist-skip message would slip
  // this assertion unnoticed.
  assert.doesNotMatch(r.stderr, /no built site under/,
    `--serve with no dist directory hit the dist skip instead of reaching the comparison:\n${r.stderr}`);
  assert.match(r.stderr, /the built home did not load at/,
    `--serve with no dist directory should reach the home-load attempt, not stop earlier:\n${r.stderr}`);
  assert.equal(r.status, 2, `an unreachable --serve URL should still be a refusal:\n${r.stdout}\n${r.stderr}`);

  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#2f5d50"));
  build();
});

test("a mid-run refusal (--serve to a dead port, no dist) exits cleanly with no hang", async (t) => {
  if (!ready) return t.skip(skipReason);
  // This is the exact shape the Important review finding was about: the home-did-not-load
  // check fires AFTER the browser and the board's own HTTP server are already open (the board
  // has to be served first to read its hero section, before the home is even reached). Calling
  // process.exit(2) from there skips the `finally` that closes them. Nothing listens on port 1
  // (a privileged port), so the connection refuses immediately rather than timing out slowly.
  //
  // Measured directly (a standalone repro of this exact scenario, run against BOTH the fixed
  // code and process.exit(2) restored, polling `ps` for this suite's own chromium subprocess):
  // on this platform Playwright's chromium is launched over a debugging PIPE, and it exits on
  // its own within about a second of that pipe closing, whichever way the parent died. So an OS
  // process-listing check cannot tell the two implementations apart here: it would pass either
  // way and give false confidence. What IS deterministic, and is asserted directly below, is
  // that `cannotCheckMidRun` itself no longer calls `process.exit()`; that is the actual
  // behaviour the mutation check restores and this suite protects. This test keeps the
  // behavioural checks that ARE meaningful: the process does not hang, the exit code and
  // message are right, and the board's own server (owned by this same process) is not left
  // listening.
  writeManifest([{ surface: "hero", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() }]);
  rmSync(join(SITE, "dist"), { recursive: true, force: true });
  const r = await run(
    [SITE, "--port", String(PORT), "--serve", "http://127.0.0.1:1/nowhere"],
    {},
    { timeout: 30000 },
  );
  assert.equal(r.killed, false,
    `the gate had to be force-killed after 30s, which means it never exited on its own:\n${r.stdout}\n${r.stderr}`);
  assert.equal(r.status, 2, `an unreachable --serve URL with no dist should still be a refusal:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^gate-fidelity: skipped \(/m,
    `the mid-run refusal did not print in cannotCheck's own shape:\n${r.stderr}`);
  assert.match(r.stderr, /gate-fidelity: NOT a pass\./, `the mid-run refusal is missing its "NOT a pass" line:\n${r.stderr}`);

  const free = await portIsFree(PORT);
  assert.ok(free, `port ${PORT} is still held after the gate exited, so its board server was leaked`);

  writeFileSync(join(SITE, "src/pages/index.astro"), homePage("#2f5d50"));
  build();
});

test("cannotCheckMidRun never calls process.exit (the leak the previous test is about)", () => {
  // The deterministic half of the same guard: `process.exit(2)` terminates synchronously and
  // skips whatever `finally` clause it is called from, which is exactly the bug this task fixed
  // for the two refusals that fire once the browser and the board's server are already open.
  // Read directly from source rather than inferred from a process-listing side effect, because
  // (per the note above) the observable side effect does not reliably survive this platform's
  // browser-teardown behaviour, while the source contract does not depend on any platform at all.
  const src = readFileSync(join(ROOT, "scripts/gate-fidelity.mjs"), "utf8");
  const at = src.indexOf("const cannotCheckMidRun");
  assert.ok(at >= 0, "cannotCheckMidRun is missing from gate-fidelity.mjs");
  const after = src.slice(at);
  const end = after.search(/\n(const|let|function|class)\s/);
  const body = end >= 0 ? after.slice(0, end) : after;
  assert.doesNotMatch(body, /process\.exit\(/,
    `cannotCheckMidRun calls process.exit(), which would skip the finally that closes the browser and both servers:\n${body}`);
});

test("no built home is a refusal with the reason, never a pass", async (t) => {
  if (!ready) return t.skip(skipReason);
  writeManifest([{ surface: "hero", variant_id: "b1", rung: 1, position: 1, picked_at: new Date().toISOString() }]);
  const r = await run([join(TMP, "not-a-site"), "--port", String(PORT)]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /NOT a pass/);
});
