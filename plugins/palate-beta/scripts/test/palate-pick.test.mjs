/**
 * palate-pick.test.mjs - the record of what the client chose, and what they changed.
 *
 * This is the only place the Explore stage has ever been able to produce a number. Before it,
 * "which rung do clients pick" and "how long does it take them" were both unanswerable, and a
 * stage that cannot be measured cannot be argued about. So the assertions are about the RECORD
 * being complete and honest: the rung, its position on the ladder, the timestamp that makes
 * time-to-pick subtractable, and a refusal on every input that would put a fiction in it.
 *
 * The canvas half matters for a different reason. What a client changes on the canvas is
 * feedback, and feedback that is not written down is feedback Compose will not honour. A diff
 * that silently found nothing looks exactly like a client who changed nothing.
 *
 * Run: node --test scripts/test/palate-pick.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "scripts", "palate-pick.mjs");

const REGISTRY = `export interface Variant { id: string; }
export const variants: Variant[] = [
  { id: "b1", name: "The Quiet Room", href: "/boards/b1", ambition: 1, what: "A", why: "B",
    feeling: "quiet", donor: "aesop", section: "services", motion: "One fade.", ctas: ["Book"] },
  { id: "b2", name: "The Long Table", href: "/boards/b2", ambition: 2, what: "C", why: "D",
    feeling: "candid", donor: "leoleo", section: "proof", motion: "Rows settle.", ctas: ["See"] },
  { id: "b3", name: "The Loud Room", href: "/boards/b3", ambition: 3, what: "E", why: "F",
    feeling: "brash", donor: "utsubo", section: "menu", motion: "The wall scrubs.", ctas: ["Go"] },
  { id: "b4", name: "The Signal", href: "/boards/b4", ambition: 4, what: "G", why: "H",
    feeling: "urgent", donor: "spline", section: "proof", motion: "It pulses.", ctas: ["Now"] },
  { id: "b5", name: "The Flood", href: "/boards/b5", ambition: 5, what: "I", why: "J",
    feeling: "overwhelming", donor: "oddcommon", section: "menu", motion: "It floods.", ctas: ["Enter"] },
];
export const landingVariants: Variant[] = [];
`;

// Relative to now, not a literal date: a fixed stamp makes "picked_at is after shown_at" a
// test of the machine's clock rather than of the code.
const SHOWN = new Date(Date.now() - 90_000).toISOString();

function project() {
  const dir = mkdtempSync(join(tmpdir(), "palate-pick-"));
  mkdirSync(join(dir, "src/lib"), { recursive: true });
  mkdirSync(join(dir, ".palate/explore/seed"), { recursive: true });
  writeFileSync(join(dir, "src/lib/variants.ts"), REGISTRY);
  writeFileSync(join(dir, "build-manifest.json"), JSON.stringify({
    schema: 3, project: dir, mcp_calls: [],
    explore: {
      ran: true,
      shown_at: SHOWN,
      // What boards-render recorded when the set went out. It is the only record of the ladder
      // that survives Compose clearing the registry.
      boards: [
        { id: "b1", rung: 1, donor: "aesop" }, { id: "b2", rung: 2, donor: "leoleo" },
        { id: "b3", rung: 3, donor: "utsubo" }, { id: "b4", rung: 4, donor: "spline" },
        { id: "b5", rung: 5, donor: "oddcommon" },
      ],
    },
  }, null, 2));
  return dir;
}

const manifestOf = (dir) => JSON.parse(readFileSync(join(dir, "build-manifest.json"), "utf8"));

const run = async (args) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

/**
 * THE PROOF IS NOW A MEASUREMENT, so the tests that exercise it need a page that really moves
 * and a page that really does not. Two fixtures served from this process, on a loopback port,
 * because the probe drives a browser and a browser will not read a string.
 */
const MOVING_PAGE = `<!doctype html><meta charset="utf-8"><title>Moving</title>
<style>
  body { margin: 0; }
  header { position: sticky; top: 0; height: 120px; background: #222; }
  header.small { height: 60px; }
  section { min-height: 1400px; }
  .pulse { width: 80px; height: 80px; background: #e2553d; animation: slide 1s infinite alternate; }
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(120px); } }
</style>
<header id="top">Header</header>
<section id="one">
  <img id="para" width="400" height="300" alt="a still"
       src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
  <div class="pulse"></div>
</section>
<section id="two"><p>More copy.</p></section>
<script>
  addEventListener("scroll", () => {
    document.getElementById("para").style.transform = "translateY(" + (scrollY * 0.4) + "px)";
    document.getElementById("top").classList.toggle("small", scrollY > 100);
  });
</script>`;

const STILL_PAGE = `<!doctype html><meta charset="utf-8"><title>Still</title>
<style>body { margin: 0; } header { height: 120px; background: #222; } section { min-height: 1400px; }</style>
<header id="top">Header</header>
<section id="one"><img id="para" width="400" height="300" alt="a still"
  src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></section>
<section id="two"><p>More copy.</p></section>`;

async function serve(html) {
  const s = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((ok) => s.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${s.address().port}/`, close: () => new Promise((ok) => s.close(ok)) };
}

// The probe needs the capture engine's browser. Where it is not installed the measured half of
// these assertions cannot run, and skipping loudly is the honest outcome: a suite that quietly
// passes without the instrument is how a dead check survives.
let hasBrowser = true;
try { createRequire(join(ROOT, "scripts", "reference-capture", "index.mjs"))("playwright"); }
catch { hasBrowser = false; }

// A URL nobody is listening on, for the calls whose subject is the RECORD rather than the
// measurement: they pass --proof-unmeasured, which is the flag for a page the probe cannot
// reach.
const UNREACHABLE = "https://palate-fixture.vercel.app/";
const NO_PROBE = ["--proof-unmeasured", "the preview is behind a tunnel this machine cannot open"];

test("a hero pick is recorded with its rung, its position and when", async () => {
  const dir = project();
  const r = await run([dir, "--hero", "b3"]);
  assert.equal(r.status, 0, r.stderr);
  const picks = manifestOf(dir).explore.picks;
  assert.equal(picks.length, 1);
  assert.equal(picks[0].surface, "hero");
  assert.equal(picks[0].variant_id, "b3");
  assert.equal(picks[0].rung, 3);
  assert.equal(picks[0].position, 0.6, "position is the rung divided by the count, so 3 of 5 is 0.6");
  assert.ok(Date.parse(picks[0].picked_at) > Date.parse(SHOWN), "picked_at is not a real timestamp after shown_at");
  // The only number this stage has ever produced.
  assert.match(r.stdout, /time to pick/i);
  rmSync(dir, { recursive: true, force: true });
});

test("a section pick sits beside the hero pick, not on top of it", async () => {
  const dir = project();
  await run([dir, "--hero", "b3"]);
  const r = await run([dir, "--section", "b5"]);
  assert.equal(r.status, 0, r.stderr);
  const picks = manifestOf(dir).explore.picks;
  assert.equal(picks.length, 2);
  assert.deepEqual(picks.map((p) => p.surface).sort(), ["hero", "section"]);
  assert.equal(picks.find((p) => p.surface === "section").rung, 5);
  rmSync(dir, { recursive: true, force: true });
});

test("an id that is not registered is refused", async () => {
  const dir = project();
  const r = await run([dir, "--hero", "b9"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /b9/);
  assert.match(r.stderr, /b1, b2, b3, b4, b5/, "the refusal does not say what IS registered");
  assert.equal(manifestOf(dir).explore.picks, undefined, "a refused pick was written anyway");
  rmSync(dir, { recursive: true, force: true });
});

test("a rung outside the ladder is refused rather than recorded", async () => {
  const dir = project();
  writeFileSync(join(dir, "src/lib/variants.ts"), REGISTRY.replace("ambition: 3,", "ambition: 9,"));
  const r = await run([dir, "--hero", "b3"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rung 9/);
  rmSync(dir, { recursive: true, force: true });
});

test("a second hero pick needs --replace, and says so", async () => {
  const dir = project();
  await run([dir, "--hero", "b3"]);
  const r = await run([dir, "--hero", "b1"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--replace/);
  assert.equal(manifestOf(dir).explore.picks[0].variant_id, "b3", "the original pick was overwritten");

  const ok = await run([dir, "--hero", "b1", "--replace"]);
  assert.equal(ok.status, 0, ok.stderr);
  const picks = manifestOf(dir).explore.picks;
  assert.equal(picks.filter((p) => p.surface === "hero").length, 1, "--replace left two hero picks");
  assert.equal(picks[0].variant_id, "b1");
  rmSync(dir, { recursive: true, force: true });
});

test("the calibration answer, the CTA, a note and a second pass are all recorded", async () => {
  const dir = project();
  const r = await run([dir, "--hero", "b3", "--intensity", "3", "--cta", "Book a table", "--note", "Warmer photography", "--second-pass"]);
  assert.equal(r.status, 0, r.stderr);
  const m = manifestOf(dir);
  assert.equal(m.commission.intensity_asked, 3);
  assert.equal(m.explore.cta, "Book a table");
  assert.equal(m.explore.second_passes, 1);
  assert.equal(m.explore.notes.length, 1);
  assert.equal(m.explore.notes[0].note, "Warmer photography");
  assert.equal(m.explore.notes[0].surface, "hero");

  const again = await run([dir, "--second-pass"]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(manifestOf(dir).explore.second_passes, 2, "second_passes counts, it does not latch");
  rmSync(dir, { recursive: true, force: true });
});

test("the motion proof is a command, not a JSON edit", async (t) => {
  if (!hasBrowser) return t.skip("the capture engine's browser is not installed, so nothing can be measured");
  const dir = project();
  const site = await serve(MOVING_PAGE);
  try {
    const r = await run([dir, "--proof", site.url]);
    assert.equal(r.status, 0, r.stderr);
    const proof = manifestOf(dir).explore.proof;
    assert.equal(proof.url, site.url);
    assert.ok(Date.parse(proof.verified_at) > 0, "the proof carries no timestamp");
    // THE MEASUREMENT IS THE RECORD. A proof that is a URL and a timestamp is the agent's word,
    // and on a real build that word was wrong by an order of magnitude.
    assert.ok(proof.measured, "the proof carries no measurement");
    assert.ok(proof.measured.animated >= 1, `the page loops and the record says animated ${proof.measured.animated}`);
    assert.ok(Math.max(0, ...proof.measured.parallax.map((x) => x.ratio)) > 0.3,
      `the hero moves at 0.4 of the scroll and the record says ${JSON.stringify(proof.measured.parallax)}`);
    // The done gate reads exactly this to decide whether there is a composed home to measure, so
    // a model that cannot write it leaves the fidelity gate skipped on every real build.
    assert.match(r.stdout, /motion proof/i);
  } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a page where nothing measurably moves is refused, not recorded", async (t) => {
  if (!hasBrowser) return t.skip("the capture engine's browser is not installed, so nothing can be measured");
  const dir = project();
  const site = await serve(STILL_PAGE);
  try {
    const r = await run([dir, "--proof", site.url]);
    assert.equal(r.status, 1, `a still page must be refused:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /nothing measurable moves/);
    assert.equal(manifestOf(dir).explore.proof, undefined, "a refused proof was recorded anyway");
  } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

/**
 * THE FLOOR HAS FOUR CLAUSES AND THREE OF THEM WERE NEVER EXERCISED. A refusal condition whose
 * clauses are only ever tested together is a refusal condition where any one of them could be
 * inverted, missing or always-true and every test would still pass. These two pages each move in
 * exactly ONE of the four ways, so each recording proves its own clause carries weight.
 */
const PARALLAX_ONLY = `<!doctype html><meta charset="utf-8"><title>Parallax only</title>
<style>body { margin: 0; } header { height: 90px; background: #222; } section { min-height: 1400px; }</style>
<header>Header</header>
<section id="one"><div id="layer"><img id="para" width="400" height="300" alt="a still"
  src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></section>
<section id="two"><p>More copy.</p></section>
<script>
  addEventListener("scroll", () => {
    document.getElementById("layer").style.transform = "translateY(" + (scrollY * 0.35) + "px)";
  });
</script>`;

const HEADER_ONLY = `<!doctype html><meta charset="utf-8"><title>Header only</title>
<style>
  body { margin: 0; }
  header { position: sticky; top: 0; height: 120px; background: #222; }
  header.small { height: 56px; }
  section { min-height: 1400px; }
</style>
<header id="top">Header</header>
<section id="one"><p>Copy.</p></section>
<section id="two"><p>More copy.</p></section>
<script>
  addEventListener("scroll", () => {
    document.getElementById("top").classList.toggle("small", scrollY > 100);
  });
</script>`;

test("a page whose only motion is a parallax is recorded, not refused", async (t) => {
  if (!hasBrowser) return t.skip("the capture engine's browser is not installed, so nothing can be measured");
  const dir = project();
  const site = await serve(PARALLAX_ONLY);
  try {
    const r = await run([dir, "--proof", site.url]);
    assert.equal(r.status, 0, `a real parallax is motion:\n${r.stdout}${r.stderr}`);
    const measured = manifestOf(dir).explore.proof.measured;
    assert.equal(measured.animated, 0, "this fixture is meant to move in one way only");
    assert.equal(measured.running, 0, "this fixture is meant to move in one way only");
    assert.ok(Math.max(0, ...measured.parallax.map((x) => x.ratio)) >= 0.05,
      `the parallax is the only thing keeping this page off the floor: ${JSON.stringify(measured.parallax)}`);
  } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a page whose only motion is the header is recorded, not refused", async (t) => {
  if (!hasBrowser) return t.skip("the capture engine's browser is not installed, so nothing can be measured");
  const dir = project();
  const site = await serve(HEADER_ONLY);
  try {
    const r = await run([dir, "--proof", site.url]);
    assert.equal(r.status, 0, `a header that moves out of the way is motion:\n${r.stdout}${r.stderr}`);
    const measured = manifestOf(dir).explore.proof.measured;
    assert.equal(measured.animated, 0, "this fixture is meant to move in one way only");
    assert.equal(measured.running, 0, "this fixture is meant to move in one way only");
    assert.notEqual(measured.header.before, measured.header.after,
      `the header is the only thing keeping this page off the floor: ${JSON.stringify(measured.header)}`);
  } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

/**
 * A page too short to scroll is the one case where the probe cannot answer about parallax, and
 * the first fix turned that into a page that could never be refused at all: a wholly static
 * short page recorded a motion proof. The withheld reading is not evidence of stillness AND it
 * is not a licence either. So on a short page the parallax clause is simply not part of the
 * floor, and the other three still are.
 */
const SHORT_STATIC = `<!doctype html><meta charset="utf-8"><title>Short</title>
<style>body { margin: 0; } section { height: 460px; }</style>
<section id="one"><img id="para" width="200" height="150" alt="a still"
  src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></section>`;

const SHORT_MOVING = `<!doctype html><meta charset="utf-8"><title>Short, moving</title>
<style>
  body { margin: 0; } section { height: 460px; }
  .pulse { width: 80px; height: 80px; background: #e2553d; animation: slide 1s infinite alternate; }
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(120px); } }
</style>
<section id="one"><div class="pulse"></div></section>`;

test("a short page where nothing else moves is still refused", async (t) => {
  if (!hasBrowser) return t.skip("the capture engine's browser is not installed, so nothing can be measured");
  const dir = project();
  const site = await serve(SHORT_STATIC);
  try {
    const r = await run([dir, "--proof", site.url]);
    assert.equal(r.status, 1, `a static page is a static page, short or not:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /too short/, `the refusal has to say why the parallax was not measured: ${r.stderr}`);
    assert.match(r.stderr, /--proof-unmeasured/, "the refusal does not name the way through");
    assert.equal(manifestOf(dir).explore.proof, undefined, "a refused proof was recorded anyway");
  } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a short page that does move is recorded on the motion it has", async (t) => {
  if (!hasBrowser) return t.skip("the capture engine's browser is not installed, so nothing can be measured");
  const dir = project();
  const site = await serve(SHORT_MOVING);
  try {
    const r = await run([dir, "--proof", site.url]);
    assert.equal(r.status, 0, `a short page with a running animation moves:\n${r.stdout}${r.stderr}`);
    const measured = manifestOf(dir).explore.proof.measured;
    assert.equal(measured.short_page, true, "this fixture is meant to be too short to scroll");
    assert.deepEqual(measured.parallax, [], "the parallax reading is withheld on a short page");
    assert.ok(measured.animated >= 1);
  } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a preview the probe cannot reach is refused until the reason is given", async (t) => {
  if (!hasBrowser) return t.skip("the capture engine's browser is not installed, so nothing can be measured");
  const dir = project();
  // Nothing listens on port 1: the shape of a preview that died or a tunnel that never came up.
  const r = await run([dir, "--proof", "http://127.0.0.1:1/"]);
  assert.equal(r.status, 1, `an unmeasurable preview must be refused:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /--proof-unmeasured/, "the refusal does not name the way through");
  assert.equal(manifestOf(dir).explore.proof, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("--proof-unmeasured records the reason instead of a measurement", async () => {
  const dir = project();
  const r = await run([dir, "--proof", UNREACHABLE, ...NO_PROBE]);
  assert.equal(r.status, 0, r.stderr);
  const proof = manifestOf(dir).explore.proof;
  assert.equal(proof.url, UNREACHABLE);
  assert.equal(proof.measured, null, "an unmeasured proof must say so, not leave the field out");
  assert.match(proof.reason, /tunnel/);

  // And the reason is not optional: an empty one is silence wearing the flag's name.
  const blank = await run([dir, "--proof", UNREACHABLE, "--proof-unmeasured", "  "]);
  assert.equal(blank.status, 1, blank.stdout);
  rmSync(dir, { recursive: true, force: true });
});

test("the canvas is recorded by command, published or declined", async () => {
  const dir = project();
  // The gate blocks a shown set whose canvas is neither published nor declined, so a field with
  // no writer is a gate the model can only clear by hand-editing the manifest it was told never
  // to touch.
  const r = await run([dir, "--canvas-url", "https://claude.ai/code/artifact/abc123"]);
  assert.equal(r.status, 0, r.stderr);
  const canvas = manifestOf(dir).explore.canvas;
  assert.equal(canvas.url, "https://claude.ai/code/artifact/abc123");
  assert.ok(Date.parse(canvas.recorded_at) > 0, "the canvas record carries no timestamp");
  assert.match(r.stdout, /canvas published/i);

  const skipped = await run([dir, "--canvas-skipped", "no design skill in this session"]);
  assert.equal(skipped.status, 0, skipped.stderr);
  const declined = manifestOf(dir).explore.canvas;
  assert.equal(declined.skipped, true);
  assert.equal(declined.reason, "no design skill in this session");
  assert.ok(Date.parse(declined.recorded_at) > 0, "the declined record carries no timestamp");
  rmSync(dir, { recursive: true, force: true });
});

test("a canvas that cannot be opened, or declined with no reason, is refused", async () => {
  const dir = project();
  const bad = await run([dir, "--canvas-url", "the design canvas"]);
  assert.equal(bad.status, 1, `a link the client cannot open must be refused:\n${bad.stdout}${bad.stderr}`);
  assert.match(bad.stderr, /http/i);
  assert.equal(manifestOf(dir).explore.canvas, undefined, "a refused url was recorded anyway");

  const silent = await run([dir, "--canvas-skipped", "   "]);
  assert.equal(silent.status, 1, `a declined canvas with no reason must be refused:\n${silent.stdout}${silent.stderr}`);
  assert.match(silent.stderr, /reason/i);
  assert.equal(manifestOf(dir).explore.canvas, undefined, "a reasonless skip was recorded anyway");

  // Both at once is a model guessing rather than reporting: the canvas was published, or it
  // was not.
  const both = await run([dir, "--canvas-url", "https://claude.ai/code/artifact/abc123", "--canvas-skipped", "no design skill"]);
  assert.equal(both.status, 1, `both flags at once must be refused:\n${both.stdout}${both.stderr}`);
  assert.match(both.stderr, /--canvas-url/);
  assert.match(both.stderr, /--canvas-skipped/);
  assert.equal(manifestOf(dir).explore.canvas, undefined, "a contradictory call was recorded anyway");
  rmSync(dir, { recursive: true, force: true });
});

test("the proof still records after Compose has cleared the registry", async () => {
  const dir = project();
  await run([dir, "--hero", "b3"]);
  // Compose clears src/lib/variants.ts in the same step that records the proof, and the flow is
  // built around that order slipping: a client who changes their mind gets an edited home, a
  // re-verify and a SECOND --proof. Refusing it with a message about picks is how the fidelity
  // gate ends up skipped on exactly the builds someone cared enough to iterate on.
  writeFileSync(join(dir, "src/lib/variants.ts"), "export const variants = [];\n");
  const r = await run([dir, "--proof", "https://palate-fixture.vercel.app/second/", ...NO_PROBE]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(manifestOf(dir).explore.proof.url, "https://palate-fixture.vercel.app/second/");

  // And with the file gone entirely, which is the archive-first order.
  rmSync(join(dir, "src/lib/variants.ts"));
  const gone = await run([dir, "--proof", "https://palate-fixture.vercel.app/third/", ...NO_PROBE, "--second-pass"]);
  assert.equal(gone.status, 0, gone.stderr);
  assert.equal(manifestOf(dir).explore.proof.url, "https://palate-fixture.vercel.app/third/");
  assert.equal(manifestOf(dir).explore.second_passes, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("a pick after the registry is gone is judged against what boards-render recorded", async () => {
  const dir = project();
  rmSync(join(dir, "src/lib/variants.ts"));

  const bad = await run([dir, "--hero", "b9"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /b9/);
  assert.match(bad.stderr, /b1, b2, b3, b4, b5/, "the refusal does not name the boards the manifest recorded");
  assert.match(bad.stderr, /build-manifest/, "the refusal does not say where the list came from");

  // A real one still works, and takes its rung from the same record.
  const ok = await run([dir, "--hero", "b4"]);
  assert.equal(ok.status, 0, ok.stderr);
  const pick = manifestOf(dir).explore.picks[0];
  assert.equal(pick.variant_id, "b4");
  assert.equal(pick.rung, 4);
  assert.equal(pick.position, 0.8, "the ladder size came from somewhere other than the recorded set");
  rmSync(dir, { recursive: true, force: true });
});

test("a directory that is not a Palate site is refused, never reported as recorded", async () => {
  const empty = mkdtempSync(join(tmpdir(), "palate-pick-empty-"));
  // THE WRONG PROJECT DIRECTORY IS THE FAILURE THIS REPO HAS ALREADY PAID FOR. The doctrine's
  // invocation takes a <project-dir> the model supplies, and on a real build the manifest sat at
  // a repo root while the site sat one level down, which turned every gate off. A success line
  // on an empty directory is that fault with a reassuring message on top of it.
  const r = await run([empty, "--proof", UNREACHABLE, ...NO_PROBE]);
  assert.equal(r.status, 2, `an empty directory must be bad arguments, not a recorded proof:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /Not an Explore build/);
  assert.ok(!/motion proof recorded/.test(r.stdout), "it printed a success line for a directory holding nothing");
  rmSync(empty, { recursive: true, force: true });

  // And the case N3 opened stays open: the registry gone, the manifest present.
  const dir = project();
  rmSync(join(dir, "src/lib/variants.ts"));
  const ok = await run([dir, "--proof", UNREACHABLE, ...NO_PROBE]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(manifestOf(dir).explore.proof.url);
  rmSync(dir, { recursive: true, force: true });
});

test("a broken rung names the record it was read from", async () => {
  const dir = project();
  rmSync(join(dir, "src/lib/variants.ts"));
  const m = manifestOf(dir);
  m.explore.boards[2].rung = 9;
  writeFileSync(join(dir, "build-manifest.json"), JSON.stringify(m, null, 2));
  const r = await run([dir, "--hero", "b3"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rung 9/);
  assert.match(r.stderr, /build-manifest/, "it sent the reader to the registry, which is not where the rung came from");
  assert.ok(!/fix src\/lib\/variants\.ts/.test(r.stderr), "it named the registry as the thing to fix");
  rmSync(dir, { recursive: true, force: true });
});

test("an intensity outside 1 to 4 is refused", async () => {
  const dir = project();
  const r = await run([dir, "--intensity", "7"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /1 to 4/);
  rmSync(dir, { recursive: true, force: true });
});

test("--answer records the question round, key by key, and refuses an unknown key", async () => {
  const dir = project();
  await run([dir, "--answer", "motion=the column rules draw down over 800ms, nothing loops"]);
  await run([dir, "--answer", "mix=b2 services list under the b3 hero"]);
  await run([dir, "--answer", "cms=false, the office edits nothing"]);
  const m = manifestOf(dir);
  assert.equal(m.explore.question_round.motion.startsWith("the column rules"), true);
  assert.equal(m.explore.question_round.mix.startsWith("b2 services"), true);
  assert.equal(m.explore.question_round.cms, "false, the office edits nothing");
  assert.ok(m.explore.question_round.answered_at, "answered_at was not stamped");

  const r = await run([dir, "--answer", "colour=red"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /motion, mix, cms/);
  rmSync(dir, { recursive: true, force: true });
});

test("--answer with no key or no value is refused, not silently dropped", async () => {
  const dir = project();
  const noValue = await run([dir, "--answer", "motion="]);
  assert.equal(noValue.status, 1);
  const noKey = await run([dir, "--answer", "just some text"]);
  assert.equal(noKey.status, 1);
  rmSync(dir, { recursive: true, force: true });
});

// ----------------------------------------------------------------- the canvas read-back
const seedBoard = (dir, file, body) => writeFileSync(join(dir, ".palate/explore/seed", file),
  `<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style>x-dc{display:block}</style></helmet>${body}</x-dc></body></html>`);

test("a text edit and a new note on the canvas become feedback Compose must honour", async () => {
  const dir = project();
  // The keys boards-render stamps. The editor preserves attributes, so they are what a change
  // is matched on: without them a deletion reads as an edit to every element after it.
  const seedBody = '<div data-palate-k="k1" style="padding:40px">' +
    '<h1 data-palate-k="k2" style="font-size:64px;color:#111111">Quiet confidence</h1>' +
    '<p data-palate-k="k3" style="font-size:18px">We look after the whole thing.</p></div>';
  seedBoard(dir, "B3.dc.html", seedBody);
  writeFileSync(join(dir, ".palate/explore/seed/canvas.json"), JSON.stringify({
    artboards: [{ file: "B3.dc.html", x: 0, y: 0, w: 1440, h: 2000, title: "Rung 3 of 5: The Loud Room" }],
    annotations: [{ id: "board-b3", x: 0, y: 2024, w: 420, text: "The Loud Room - rung 3 of 5." }],
    launch: { view: "canvas" },
  }, null, 2));

  const extract = join(dir, "extract");
  mkdirSync(extract, { recursive: true });
  writeFileSync(join(extract, "B3.dc.html"),
    readFileSync(join(dir, ".palate/explore/seed/B3.dc.html"), "utf8")
      .replace("Quiet confidence", "Quietly certain")
      .replace("font-size:64px;color:#111111", "font-size:72px;color:#111111"));
  writeFileSync(join(extract, "canvas.json"), JSON.stringify({
    artboards: [{ file: "B3.dc.html", x: 0, y: 0, w: 1440, h: 2000, title: "Rung 3 of 5: The Loud Room" }],
    annotations: [
      { id: "board-b3", x: 0, y: 2024, w: 420, text: "The Loud Room - rung 3 of 5." },
      { id: "client-1", x: 500, y: 2024, w: 420, text: "Can the photograph be warmer?" },
    ],
    launch: { view: "canvas" },
  }, null, 2));

  const r = await run([dir, "--hero", "b3", "--canvas", extract]);
  assert.equal(r.status, 0, r.stderr);
  const fb = JSON.parse(readFileSync(join(dir, ".palate/explore/feedback.json"), "utf8"));

  const text = fb.filter((f) => f.kind === "text");
  assert.equal(text.length, 1, `expected one text edit, got ${JSON.stringify(fb)}`);
  assert.equal(text[0].board, "b3");
  assert.equal(text[0].before, "Quiet confidence");
  assert.equal(text[0].after, "Quietly certain");
  assert.ok(text[0].path, "a text edit with no path cannot be applied to anything");

  const notes = fb.filter((f) => f.kind === "note");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].after, "Can the photograph be warmer?");
  assert.equal(notes[0].before, null, "a new note has no before");

  const style = fb.filter((f) => f.kind === "style");
  assert.equal(style.length, 1);
  assert.match(style[0].before, /font-size:64px/);
  assert.match(style[0].after, /font-size:72px/);

  assert.match(r.stdout, /3 change/, "the run does not say how much feedback it found");
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A DIRECTION IS FOUR BOARDS ON ONE ROW, and the read-back has to know which one was edited.
 *
 * Every B frame now sits at x 0 on its own row, so a note attributed by horizontal span alone
 * lands on direction 1 whichever direction it was written beside: one client's sentence about
 * the boldest direction applied to the most restrained one, in a file Compose is told to
 * honour. Attribution is by the frame whose x AND y spans contain the note.
 */
const FOUR = `export interface Variant { id: string; }
export const variants: Variant[] = [
  { id: "b1", name: "The Quiet Room", artboard: "B1.dc.html",
    presentation: { inner: "I1.dc.html", mobile: "M1.dc.html", sheet: "S1.dc.html" },
    ambition: 1, what: "A", why: "B", feeling: "quiet", donor: "aesop", section: "services",
    motion: "One fade.", ctas: ["Book"] },
  { id: "b2", name: "The Long Table", artboard: "B2.dc.html",
    presentation: { inner: "I2.dc.html", mobile: "M2.dc.html", sheet: "S2.dc.html" },
    ambition: 2, what: "C", why: "D", feeling: "candid", donor: "leoleo", section: "proof",
    motion: "Rows settle.", ctas: ["See"] },
];
export const landingVariants: Variant[] = [];
`;

test("an edit on the detail sheet is read back and tagged with its surface", async () => {
  const dir = project();
  writeFileSync(join(dir, "src/lib/variants.ts"), FOUR);
  const body = (copy) => `<div data-palate-k="k1" style="padding:40px">` +
    `<h2 data-palate-k="k2" style="font-size:32px">${copy}</h2></div>`;
  for (const [n, id] of [[1, "b1"], [2, "b2"]]) {
    for (const f of [`B${n}`, `I${n}`, `M${n}`, `S${n}`]) seedBoard(dir, `${f}.dc.html`, body(`${f} as drawn`));
    void id;
  }
  writeFileSync(join(dir, ".palate/explore/seed/canvas.json"),
    JSON.stringify({ artboards: [], annotations: [], launch: { view: "canvas" } }));

  const extract = join(dir, "extract");
  mkdirSync(extract, { recursive: true });
  for (const f of ["B1", "I1", "M1", "S1", "B2", "I2", "M2", "S2"]) {
    const src = readFileSync(join(dir, ".palate/explore/seed", `${f}.dc.html`), "utf8");
    writeFileSync(join(extract, `${f}.dc.html`), f === "S2" ? src.replace("S2 as drawn", "S2, with the form error reworded") : src);
  }
  writeFileSync(join(extract, "canvas.json"),
    JSON.stringify({ artboards: [], annotations: [], launch: { view: "canvas" } }));

  const r = await run([dir, "--canvas", extract]);
  assert.equal(r.status, 0, r.stderr);
  const fb = JSON.parse(readFileSync(join(dir, ".palate/explore/feedback.json"), "utf8"));
  const text = fb.filter((f) => f.kind === "text");
  assert.equal(text.length, 1, `expected one text edit on the sheet, got ${JSON.stringify(fb)}`);
  assert.equal(text[0].board, "b2");
  assert.equal(text[0].surface, "sheet", "the edit was read back without saying which board it was on");
  assert.equal(text[0].after, "S2, with the form error reworded");
  // Every surface of every direction is diffed, not only the home board.
  assert.match(r.stdout, /read cleanly/i);
  rmSync(dir, { recursive: true, force: true });
});

test("a note beside the second direction's sheet is attributed to that direction, not the first", async () => {
  const dir = project();
  writeFileSync(join(dir, "src/lib/variants.ts"), FOUR);
  for (const f of ["B1", "I1", "M1", "S1", "B2", "I2", "M2", "S2"]) {
    seedBoard(dir, `${f}.dc.html`, `<div data-palate-k="k1"><p data-palate-k="k2" style="font-size:18px">${f}</p></div>`);
  }
  // The rows boards-render lays: every B at x 0, the sheet at 4310, row 2 a row below row 1.
  const row = (y, n) => [
    { file: `B${n}.dc.html`, x: 0, y, w: 1440, h: 2000, title: `Rung ${n}` },
    { file: `I${n}.dc.html`, x: 2320, y, w: 1440, h: 1800, title: "inner" },
    { file: `M${n}.dc.html`, x: 3840, y, w: 390, h: 1900, title: "mobile" },
    { file: `S${n}.dc.html`, x: 4310, y, w: 1440, h: 1600, title: "sheet" },
  ];
  const artboards = [...row(0, 1), ...row(2120, 2)];
  writeFileSync(join(dir, ".palate/explore/seed/canvas.json"),
    JSON.stringify({ artboards, annotations: [], launch: { view: "canvas" } }));

  const extract = join(dir, "extract");
  mkdirSync(extract, { recursive: true });
  for (const f of ["B1", "I1", "M1", "S1", "B2", "I2", "M2", "S2"]) {
    writeFileSync(join(extract, `${f}.dc.html`), readFileSync(join(dir, ".palate/explore/seed", `${f}.dc.html`), "utf8"));
  }
  writeFileSync(join(extract, "canvas.json"), JSON.stringify({
    artboards,
    annotations: [
      // Written inside direction 2's sheet frame. By x span alone this is nobody's; by x span
      // against the B frames alone it was direction 1's, which is the bug.
      { id: "client-1", x: 4400, y: 2400, w: 420, text: "The form error should name the field." },
      // And one inside direction 2's home board, where x alone said direction 1.
      { id: "client-2", x: 200, y: 2300, w: 420, text: "Warmer photography here." },
    ],
    launch: { view: "canvas" },
  }, null, 2));

  const r = await run([dir, "--canvas", extract]);
  assert.equal(r.status, 0, r.stderr);
  const fb = JSON.parse(readFileSync(join(dir, ".palate/explore/feedback.json"), "utf8"));
  const notes = fb.filter((f) => f.kind === "note");
  assert.equal(notes.length, 2, JSON.stringify(fb));
  const sheetNote = notes.find((n) => n.path === "client-1");
  assert.equal(sheetNote.board, "b2", "the note beside direction 2's sheet was filed against another direction");
  assert.equal(sheetNote.surface, "sheet", "the note does not say which surface it was written beside");
  const homeNote = notes.find((n) => n.path === "client-2");
  assert.equal(homeNote.board, "b2");
  assert.equal(homeNote.surface, "home");
  rmSync(dir, { recursive: true, force: true });
});

test("a deleted element is one removed entry, not hundreds of shifted ones", async () => {
  const dir = project();
  // The seed shape boards-render writes: a stable key on every element, which the canvas editor
  // preserves because it edits text and inline styles, not attributes.
  const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    `<p data-palate-k="k${n}" style="font-size:${14 + n}px">Paragraph number ${n}.</p>`).join("");
  seedBoard(dir, "B3.dc.html", `<div data-palate-k="k0" style="padding:40px">${rows}</div>`);
  writeFileSync(join(dir, ".palate/explore/seed/canvas.json"), JSON.stringify({ artboards: [], annotations: [], launch: { view: "canvas" } }));

  const extract = join(dir, "extract");
  mkdirSync(extract, { recursive: true });
  // The commonest edit a canvas allows after retyping: the client deletes one band.
  writeFileSync(join(extract, "B3.dc.html"),
    readFileSync(join(dir, ".palate/explore/seed/B3.dc.html"), "utf8")
      .replace('<p data-palate-k="k4" style="font-size:18px">Paragraph number 4.</p>', ""));
  writeFileSync(join(extract, "canvas.json"), JSON.stringify({ artboards: [], annotations: [], launch: { view: "canvas" } }));

  const r = await run([dir, "--canvas", extract]);
  assert.equal(r.status, 0, r.stderr);
  const fb = JSON.parse(readFileSync(join(dir, ".palate/explore/feedback.json"), "utf8"));

  const removed = fb.filter((f) => f.kind === "removed");
  assert.equal(removed.length, 1, `expected exactly one removed entry, got ${JSON.stringify(fb)}`);
  assert.equal(removed[0].path, "k4");
  assert.match(removed[0].before, /Paragraph number 4/);
  assert.equal(removed[0].after, null);

  // AND NOTHING SHIFTED. An ordinal diff reported every paragraph after the deletion as a text
  // edit and every style after it as a style edit, and told Compose to honour all of them.
  assert.equal(fb.filter((f) => f.kind === "text").length, 0, `positional text edits leaked in: ${JSON.stringify(fb)}`);
  assert.equal(fb.filter((f) => f.kind === "style").length, 0, `positional style edits leaked in: ${JSON.stringify(fb)}`);
  assert.equal(fb.length, 1);

  // The success line must not tell Compose to honour a board it could not align, and this one
  // it COULD align, so it is named as read cleanly.
  assert.match(r.stdout, /read cleanly/i);
  rmSync(dir, { recursive: true, force: true });
});

test("a board whose keys cannot be aligned is sent to a person, never honoured", async () => {
  const dir = project();
  // An artboard from before the keys existed: the diff can only compare by position, and a
  // position-aligned diff after any structural edit is noise dressed as instructions.
  seedBoard(dir, "B3.dc.html", '<div style="padding:40px"><p style="font-size:15px">One.</p><p style="font-size:16px">Two.</p></div>');
  writeFileSync(join(dir, ".palate/explore/seed/canvas.json"), JSON.stringify({ artboards: [], annotations: [], launch: { view: "canvas" } }));
  const extract = join(dir, "extract");
  mkdirSync(extract, { recursive: true });
  writeFileSync(join(extract, "B3.dc.html"),
    '<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><helmet><style>x-dc{display:block}</style></helmet>' +
    '<div style="padding:40px"><p style="font-size:15px">One, changed.</p></div></x-dc></body></html>');
  writeFileSync(join(extract, "canvas.json"), JSON.stringify({ artboards: [], annotations: [], launch: { view: "canvas" } }));

  const r = await run([dir, "--hero", "b3", "--canvas", extract]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /b3.*by hand/is, "the run does not send the unalignable board to a person");
  assert.ok(!/honour/i.test(r.stdout.split("by hand")[0].split("\n").pop() || ""),
    "it told Compose to honour a board it could not align");
  rmSync(dir, { recursive: true, force: true });
});

test("an unchanged canvas records nothing rather than an empty claim", async () => {
  const dir = project();
  seedBoard(dir, "B3.dc.html", '<div data-palate-k="k1"><h1 data-palate-k="k2" style="font-size:64px">Quiet confidence</h1></div>');
  writeFileSync(join(dir, ".palate/explore/seed/canvas.json"), JSON.stringify({ artboards: [], annotations: [], launch: { view: "canvas" } }));
  const extract = join(dir, "extract");
  mkdirSync(extract, { recursive: true });
  writeFileSync(join(extract, "B3.dc.html"), readFileSync(join(dir, ".palate/explore/seed/B3.dc.html"), "utf8"));
  writeFileSync(join(extract, "canvas.json"), JSON.stringify({ artboards: [], annotations: [], launch: { view: "canvas" } }));

  const r = await run([dir, "--canvas", extract]);
  assert.equal(r.status, 0, r.stderr);
  const fb = JSON.parse(readFileSync(join(dir, ".palate/explore/feedback.json"), "utf8"));
  assert.deepEqual(fb, []);
  assert.match(r.stdout, /no change/i);
  rmSync(dir, { recursive: true, force: true });
});

test("an unreadable canvas extract is refused, not read as silence", async () => {
  const dir = project();
  const r = await run([dir, "--canvas", join(dir, "nowhere")]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nowhere/);
  assert.ok(!existsSync(join(dir, ".palate/explore/feedback.json")),
    "an unreadable extract wrote a feedback file, which reads as a client who changed nothing");
  rmSync(dir, { recursive: true, force: true });
});

// ===================================================================== the Compose record
//
// A build took 101 screenshots and no record existed of anybody holding one against the board
// they were composed from. The shots prove a page RENDERED; nothing proved a person looked at
// it. So the look is a command with the same shape as the pick: a shot on disk, newer than the
// page it claims to be of, and a sentence that could only have been written by somebody who
// opened it.

const VERDICT = "The hero bleeds like the board, the wordmark sits on the photo, the band's two columns share a baseline";

// THE PAGE IS BUILT BEFORE IT IS SHOT, which is the order a real build goes in and the order
// the age check is about: a shot older than its page is the fault, not the normal case.
function looked(dir, route = "/", { shot = ".palate-shots/desktop-full.png", html = true } = {}) {
  if (html) {
    const rel = route === "/" ? "dist/client/index.html" : `dist/client/${route.replace(/^\//, "")}/index.html`;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), "<!doctype html><h1>built</h1>");
  }
  mkdirSync(join(dir, ".palate-shots"), { recursive: true });
  writeFileSync(join(dir, shot), "not really a png, but bytes are bytes");
}

test("a look is recorded against the route, with the shot it was taken from", async () => {
  const dir = project();
  looked(dir);
  const r = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png", "--verdict", VERDICT]);
  assert.equal(r.status, 0, r.stderr);
  const pages = manifestOf(dir).compose.pages;
  assert.equal(pages.length, 1);
  assert.equal(pages[0].route, "/");
  assert.equal(pages[0].page_type, "home");
  assert.equal(pages[0].verdict, VERDICT);
  assert.ok(Date.parse(pages[0].looked_at) > 0, "the look carries no timestamp");
  // THE SHOT IS FINGERPRINTED, so a look cannot be re-used over a page that has been rebuilt
  // since: the record names the exact pixels the sentence is about.
  const { createHash } = await import("node:crypto");
  const want = createHash("sha256").update(readFileSync(join(dir, ".palate-shots/desktop-full.png"))).digest("hex");
  assert.equal(pages[0].shot_sha256, want);
  rmSync(dir, { recursive: true, force: true });
});

test("a look whose shot is not a screenshot of this build is refused", async () => {
  const dir = project();
  looked(dir);
  writeFileSync(join(dir, "elsewhere.png"), "bytes");
  const r = await run([dir, "--looked", "/", "--shot", "elsewhere.png", "--verdict", VERDICT]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /the look must be a screenshot under \.palate-shots\//);
  assert.equal(manifestOf(dir).compose, undefined, "a refused look was recorded anyway");
  rmSync(dir, { recursive: true, force: true });
});

test("a look taken before the page it claims to be of is refused", async () => {
  const dir = project();
  looked(dir);
  // The page rebuilt AFTER the shot. The sentence is then about pixels that no longer exist,
  // which is the exact way a look survives the change it should have caught.
  const { utimesSync } = await import("node:fs");
  const now = Date.now() / 1000;
  utimesSync(join(dir, ".palate-shots/desktop-full.png"), now - 600, now - 600);
  utimesSync(join(dir, "dist/client/index.html"), now, now);
  const r = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png", "--verdict", VERDICT]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /older than the built page/);
  rmSync(dir, { recursive: true, force: true });
});

test("a verdict too short to be a reading is refused, and says how short", async () => {
  const dir = project();
  looked(dir);
  const r = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png", "--verdict", "the hero is right"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /40/, "the refusal does not say what the floor is");
  rmSync(dir, { recursive: true, force: true });
});

test("a verdict that says nothing is refused with the phrase named", async () => {
  const dir = project();
  looked(dir);
  const r = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png",
    "--verdict", "I opened the home page at 1440 and it LOOKS GOOD to me, nothing to report here"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /looks good/i, "the refusal does not name the phrase it caught");
  rmSync(dir, { recursive: true, force: true });
});

test("a verdict that uses the word fine in a real reading is recorded", async () => {
  // "fine" was on the empty-phrase list and matched on word boundaries, so a real sentence
  // about a real page was refused with a message telling its author they had not opened it.
  // The other four phrases stay: each of them says nothing on its own.
  const dir = project();
  looked(dir);
  const r = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png",
    "--verdict", "The hairline rule is fine at 1px, the kicker is gone and the photo bleeds to both edges"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(manifestOf(dir).compose.pages[0].verdict, /fine at 1px/);
  rmSync(dir, { recursive: true, force: true });
});

test("a value flag given with no value is refused, never read as the next flag", async () => {
  // `--looked --shot x.png --verdict "..."` recorded a look on a route called `/--shot`,
  // classified it as a service page, and satisfied gate-look.mjs for a page nobody built.
  const dir = project();
  looked(dir);
  const r = await run([dir, "--looked", "--shot", ".palate-shots/desktop-full.png", "--verdict", VERDICT]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--looked was given with no value/);
  assert.equal(manifestOf(dir).compose, undefined, "a route named after a flag was recorded anyway");
  // The same guard on the flag at the end of the line, where there is no next token at all.
  const trailing = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png", "--verdict"]);
  assert.equal(trailing.status, 2, trailing.stderr);
  assert.match(trailing.stderr, /--verdict was given with no value/);
  rmSync(dir, { recursive: true, force: true });
});

test("a second look at the same route replaces the first, one entry per route", async () => {
  const dir = project();
  looked(dir);
  const first = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png", "--verdict", VERDICT]);
  assert.equal(first.status, 0, first.stderr);
  const was = manifestOf(dir).compose.pages[0].looked_at;
  await new Promise((ok) => setTimeout(ok, 20));
  const second = "The hero now bleeds, the wordmark clears the photograph and the two columns sit on one baseline";
  const r = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png", "--verdict", second]);
  assert.equal(r.status, 0, r.stderr);
  const pages = manifestOf(dir).compose.pages;
  assert.equal(pages.length, 1, "a second look at the same route was appended instead of replacing");
  assert.equal(pages[0].verdict, second);
  assert.notEqual(pages[0].looked_at, was, "the look was replaced without moving its timestamp");
  rmSync(dir, { recursive: true, force: true });
});

test("--primary marks the route the drawn inner page became, at most one per build", async () => {
  const dir = project();
  looked(dir, "/security-windows");
  looked(dir, "/gallery", { shot: ".palate-shots/gallery.png" });
  const second = "The grid runs three wide, the captions sit under the frames, the enquiry band closes it";

  // EVERY DIRECTION DRAWS ONE INNER PAGE, and until the mark existed nothing said which route
  // it became, so the page judge held every inner page against the donor's HOME page instead.
  const r = await run([dir, "--looked", "/security-windows", "--shot", ".palate-shots/desktop-full.png",
    "--verdict", VERDICT, "--primary"]);
  assert.equal(r.status, 0, r.stderr);
  let pages = manifestOf(dir).compose.pages;
  assert.equal(pages.filter((p) => p.primary).length, 1);
  assert.equal(pages.find((p) => p.primary).route, "/security-windows");

  // A SECOND --primary MOVES THE MARK. Two routes claiming the drawn inner page would have the
  // judge comparing one drawing with two pages and reporting both.
  const moved = await run([dir, "--looked", "/gallery", "--shot", ".palate-shots/gallery.png",
    "--verdict", second, "--primary"]);
  assert.equal(moved.status, 0, moved.stderr);
  pages = manifestOf(dir).compose.pages;
  assert.equal(pages.filter((p) => p.primary).length, 1, "two routes claim the drawn inner page");
  assert.equal(pages.find((p) => p.primary).route, "/gallery");
  assert.equal(pages.length, 2, "the mark moved by dropping a page");

  // A LOOK WITHOUT THE FLAG IS NOT PRIMARY, or every page would claim the drawing.
  const plain = await run([dir, "--looked", "/security-windows", "--shot", ".palate-shots/desktop-full.png",
    "--verdict", VERDICT]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(manifestOf(dir).compose.pages.find((p) => p.route === "/security-windows").primary, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("--primary is refused on the home page and outside a look", async () => {
  const dir = project();
  looked(dir);
  // THE HOME HAS ITS OWN BOARD. Marking it the inner page would hold it against a drawing of a
  // different page while the drawing of this one sat unused.
  const home = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png",
    "--verdict", VERDICT, "--primary"]);
  assert.equal(home.status, 1, home.stdout);
  assert.match(home.stderr, /cannot be the home page/);
  assert.equal(manifestOf(dir).compose, undefined, "a refused look wrote a record anyway");

  const loose = await run([dir, "--primary"]);
  assert.notEqual(loose.status, 0, "a mark with no route to put it on cannot be recorded");
  assert.match(loose.stderr, /--looked/);
  rmSync(dir, { recursive: true, force: true });
});

test("a deliberate departure from the board is recorded as an override, with its reason", async () => {
  const dir = project();
  const r = await run([dir, "--override", "/security-windows", "--section", "hero",
    "--what", "photo inset instead of bleed",
    "--reason", "the only photo under 900px wide is soft at full bleed"]);
  assert.equal(r.status, 0, r.stderr);
  const o = manifestOf(dir).compose.overrides;
  assert.equal(o.length, 1);
  assert.equal(o[0].route, "/security-windows");
  assert.equal(o[0].section, "hero");
  assert.equal(o[0].what, "photo inset instead of bleed");
  assert.match(o[0].reason, /soft at full bleed/);
  assert.ok(Date.parse(o[0].recorded_at) > 0, "the override carries no timestamp");
  rmSync(dir, { recursive: true, force: true });
});

test("an override with no reason is refused, because that is the whole record", async () => {
  const dir = project();
  const r = await run([dir, "--override", "/security-windows", "--section", "hero", "--what", "photo inset instead of bleed"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /--reason/);
  assert.equal(manifestOf(dir).compose, undefined, "a reasonless override was recorded anyway");
  rmSync(dir, { recursive: true, force: true });
});

test("a look and a motion proof in one call are refused, one record per call", async () => {
  const dir = project();
  looked(dir);
  const r = await run([dir, "--looked", "/", "--shot", ".palate-shots/desktop-full.png", "--verdict", VERDICT,
    "--proof", UNREACHABLE, ...NO_PROBE]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /--looked/);
  assert.equal(manifestOf(dir).compose, undefined, "the look was recorded from a call that was refused");
  rmSync(dir, { recursive: true, force: true });
});
