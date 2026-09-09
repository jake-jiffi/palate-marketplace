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

test("the motion proof is a command, not a JSON edit", async () => {
  const dir = project();
  const r = await run([dir, "--proof", "https://palate-fixture.vercel.app/"]);
  assert.equal(r.status, 0, r.stderr);
  const proof = manifestOf(dir).explore.proof;
  assert.equal(proof.url, "https://palate-fixture.vercel.app/");
  assert.ok(Date.parse(proof.verified_at) > 0, "the proof carries no timestamp");
  // The done gate reads exactly this to decide whether there is a composed home to measure, so
  // a model that cannot write it leaves the fidelity gate skipped on every real build.
  assert.match(r.stdout, /motion proof/i);
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
  const r = await run([dir, "--proof", "https://palate-fixture.vercel.app/second/"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(manifestOf(dir).explore.proof.url, "https://palate-fixture.vercel.app/second/");

  // And with the file gone entirely, which is the archive-first order.
  rmSync(join(dir, "src/lib/variants.ts"));
  const gone = await run([dir, "--proof", "https://palate-fixture.vercel.app/third/", "--second-pass"]);
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
  const r = await run([empty, "--proof", "https://palate-fixture.vercel.app/"]);
  assert.equal(r.status, 2, `an empty directory must be bad arguments, not a recorded proof:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /Not an Explore build/);
  assert.ok(!/motion proof recorded/.test(r.stdout), "it printed a success line for a directory holding nothing");
  rmSync(empty, { recursive: true, force: true });

  // And the case N3 opened stays open: the registry gone, the manifest present.
  const dir = project();
  rmSync(join(dir, "src/lib/variants.ts"));
  const ok = await run([dir, "--proof", "https://palate-fixture.vercel.app/"]);
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
