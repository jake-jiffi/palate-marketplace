#!/usr/bin/env node
/**
 * scripts/palate-pick.mjs - record what the client chose, and what they changed.
 *
 * ====================== WHY THIS EXISTS AT ALL =======================
 *
 * Until this file, the Explore stage produced no number. "Which rung do clients actually pick",
 * "how long does it take them" and "how often do they want a second pass" were all
 * unanswerable, so the most expensive stage of a build could not be argued about with anything
 * but anecdote. A pick recorded here carries the rung, its position on the ladder and the
 * moment it was made, and `boards-render` stamped `explore.shown_at` when the set went out, so
 * time to pick is a subtraction rather than a memory.
 *
 * ==================== AND WHY IT REFUSES SO MUCH =====================
 *
 * Everything downstream trusts this record: Compose lifts the picked components, the fidelity
 * gate measures the built home against the picked board, and the changelog quotes the numbers.
 * A pick naming a board that does not exist is worse than no pick, because it looks like data.
 * So an unregistered id, a rung outside the ladder, a second hero pick without `--replace` and
 * an unreadable canvas extract are each refused with their own message.
 *
 * THE CANVAS IS FEEDBACK, NEVER THE SOURCE OF TRUTH. `--canvas <dir>` diffs the artboards the
 * design skill read back against the ones we seeded and writes `.palate/explore/feedback.json`.
 * Compose must honour the text edits and the notes on the picked surfaces; the style edits are
 * evidence of intent rather than instructions, because a client dragging a font size on a
 * flattened snapshot is saying "bigger", not specifying 72px.
 *
 * Usage:
 *   node scripts/palate-pick.mjs <projectDir> --hero b3 [--section b5] [--cta "Book a table"]
 *        [--intensity 3] [--note "..."] [--canvas <extract-dir>] [--second-pass] [--replace]
 *        [--proof <preview-url> [--proof-unmeasured "<reason>"]]
 *        [--answer motion=... --answer mix=... --answer cms=...]
 *        [--canvas-url <published-url> | --canvas-skipped "<reason>"]
 *        [--looked <route> --shot .palate-shots/<file>.png --verdict "<what you can see>" [--primary]]
 *        [--override <route> --section <band> --what "<instead>" --reason "<why>"]
 * Exit: 0 recorded, 1 refused (with the reason), 2 bad arguments.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "./boards-render.mjs";
import { normaliseRoute, pageTypeOf, routeSlug } from "./lib/route-kind.mjs";

// THE GATE AND THE RECORD MUST AGREE ABOUT WHAT KIND OF PAGE A ROUTE IS, so there is one
// definition and `gate-look.mjs` reads the same module. Re-exported here because this file is
// where the Compose record is written and where a reader looks for its shape.
export { pageTypeOf, routeSlug };

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set([
  "--hero", "--section", "--cta", "--intensity", "--note", "--canvas", "--proof", "--answer",
  "--proof-unmeasured",
  "--canvas-url", "--canvas-skipped",
  "--looked", "--shot", "--verdict",
  "--override", "--what", "--reason",
]);
/**
 * A VALUE FLAG WITH NO VALUE IS A REFUSAL, never the next flag read as its value.
 *
 * `opt()` returned whatever token followed, so `--looked --shot x.png --verdict "..."` recorded
 * a look on a route called `/--shot`, classified it as a service page, and satisfied
 * `gate-look.mjs` for a page nobody built. The board judge and the page judge both refuse this
 * shape; the record that feeds them has to refuse it too.
 */
const opt = (k) => {
  const i = args.indexOf(k);
  if (i < 0) return null;
  const v = args[i + 1];
  if (VALUE_FLAGS.has(k) && (v === undefined || v.startsWith("--")))
    badArgs(`${k} was given with no value. Name it: ${k} <value>. NOT a record.`);
  return v !== undefined ? v : null;
};
const flag = (k) => args.includes(k);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) { if (VALUE_FLAGS.has(args[i])) i++; continue; }
  positional.push(args[i]);
}

const refuse = (reason) => { process.stderr.write(`palate-pick: ${reason}\n`); process.exit(1); };
const badArgs = (reason) => { process.stderr.write(`palate-pick: ${reason}\n`); process.exit(2); };

const dir = resolve(positional[0] || ".");

const manifestPath = join(dir, "build-manifest.json");
let manifest = {};
if (existsSync(manifestPath)) {
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch { refuse(`${manifestPath} is not readable JSON. Fix or remove it; a pick written beside a broken manifest is a pick nothing will read.`); }
}
const explore = manifest.explore && typeof manifest.explore === "object" ? manifest.explore : {};
const existing = Array.isArray(explore.picks) ? explore.picks.slice() : [];

/**
 * THE LADDER OUTLIVES THE REGISTRY, and it has to, because Compose clears the registry in the
 * same step that records the proof.
 *
 * This file used to refuse before it read a single flag when `src/lib/variants.ts` was missing
 * or empty. In the stated order that works. The flow is built around the order slipping: the
 * motion proof exists so a client can change their mind on ONE page, and a client who does gets
 * an edited home, a re-verify and a SECOND `--proof`, which then refused with a message about
 * picks. Same for a Compose resumed in a later session, or one that archives first. The
 * doctrine has just told the model never to hand-edit the manifest, so the only way out was to
 * skip, and the done summary read `fidelity=skipped` on exactly the builds somebody cared
 * enough about to iterate on.
 *
 * So: only a flag that names a BOARD needs the ladder, and when the registry is gone the ladder
 * is read from `explore.boards`, which boards-render recorded when the set went out.
 */
const registryPath = join(dir, "src/lib/variants.ts");

/**
 * IS THIS A PALATE SITE AT ALL? The registry check used to answer that as a side effect, and
 * scoping it to the pick flags took the answer with it: `--proof` against an empty directory
 * exited 0 and printed "motion proof recorded" while stderr muttered that there was no manifest.
 *
 * That is the failure this repo has already paid for. The doctrine's invocation takes a
 * `<project-dir>` the model supplies, and on a real client build the manifest sat at a repo root
 * while the site sat one level down: every gate resolved to a directory holding none of the
 * artefacts and the whole suite went quiet. A success line on the wrong directory is that fault
 * with a reassuring message on top.
 *
 * EITHER file is enough, which is what keeps a post-Compose `--proof` working: after the clear
 * the registry is empty or gone and the manifest is the site's identity.
 */
if (!existsSync(registryPath) && !existsSync(manifestPath)) {
  badArgs(
    `Not an Explore build: no src/lib/variants.ts and no build-manifest.json under ${dir}. ` +
    "Nothing recorded. Name the site directory, not the repository root.",
  );
}

const registryBoards = existsSync(registryPath) ? parseRegistry(readFileSync(registryPath, "utf8")) : [];
const recordedBoards = (Array.isArray(explore.boards) ? explore.boards : [])
  .filter((b) => b && b.id)
  .map((b) => ({ id: b.id, ambition: Number(b.rung) }));
const fromRegistry = registryBoards.length > 0;
const boards = fromRegistry ? registryBoards : recordedBoards;
const boardsSource = fromRegistry ? "src/lib/variants.ts" : "build-manifest.json (explore.boards, recorded by boards-render)";
const ids = boards.map((b) => b.id).join(", ");
const N = boards.length;

// --------------------------------------------------------------------------- the picks
// ONLY THESE READ THE LADDER. Everything else on this command line writes a manifest field and
// has no opinion about which boards exist.
//
// `--section` NAMES A BOARD, EXCEPT BESIDE `--override`, WHERE IT NAMES A SECTION. The override
// records a departure from the board on one band of one page, so the band has to be named, and
// the word for it is the word the doctrine already uses. The two readings cannot collide in one
// call: an override is about a built page and a section pick is about the ladder.
const overrideRoute = flag("--override") ? (opt("--override") ?? "") : null;
const wanted = [];
for (const surface of ["hero", "section"]) {
  if (surface === "section" && overrideRoute !== null) continue;
  const id = opt(`--${surface}`);
  if (id) wanted.push({ surface, id });
}

/**
 * A pick is only ever as good as the entry behind it.
 *
 * The rung comes from the registry, not from the command line, so a pick cannot claim a
 * position the board does not hold. A registry whose rung is outside 1..N is a broken ladder
 * and it is refused HERE rather than recorded and discovered later by the gate that reads it.
 */
function resolvePick(surface, id) {
  if (!boards.length) {
    refuse(
      `no boards are registered in src/lib/variants.ts and build-manifest.json records none either, ` +
      "so there is nothing to pick. Run boards-render.mjs before recording a pick against a set nothing has seen.",
    );
  }
  const b = boards.find((x) => x.id === id);
  if (!b) refuse(`${id} is not a registered board. Registered in ${boardsSource}: ${ids}.`);
  const rung = Number(b.ambition);
  if (!Number.isFinite(rung) || rung < 1 || rung > N) {
    // Named from the source the rung was actually read from. Sending someone to the registry
    // for a number the manifest supplied is sending them to a file that may not exist any more.
    refuse(`${id} carries rung ${b.ambition}, which is outside 1 to ${N}. The ladder is broken; fix ${boardsSource} before recording a pick against it.`);
  }
  if (existing.some((p) => p.surface === surface) && !flag("--replace")) {
    const held = existing.find((p) => p.surface === surface);
    refuse(`a ${surface} pick is already recorded (${held.variant_id}). Pass --replace to change it, so a change of mind is a decision rather than an accident.`);
  }
  return {
    surface,
    variant_id: id,
    rung,
    // The rung divided by the count: a rung number means nothing without the ladder it sat on,
    // and 3 of 5 and 3 of 10 are not the same choice.
    position: Math.round((rung / N) * 1000) / 1000,
    picked_at: new Date().toISOString(),
  };
}

const picks = existing.filter((p) => !wanted.some((w) => w.surface === p.surface));
const made = wanted.map((w) => resolvePick(w.surface, w.id));
picks.push(...made);

// --------------------------------------------------------------- intensity, cta, notes
const patch = { explore: {} };
if (made.length) patch.explore.picks = picks;

const intensityRaw = opt("--intensity");
if (intensityRaw !== null) {
  const n = Number(intensityRaw);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    refuse(`--intensity ${intensityRaw} is outside 1 to 4. It is the position the client pointed at on the calibration row, not a score.`);
  }
  patch.commission = { intensity_asked: n };
}

const cta = opt("--cta");
if (cta) patch.explore.cta = cta;

const note = opt("--note");
if (note) {
  const on = made[0] || existing[0] || null;
  patch.explore.notes = [
    ...(Array.isArray(explore.notes) ? explore.notes : []),
    { surface: on ? on.surface : "general", variant_id: on ? on.variant_id : null, note, at: new Date().toISOString() },
  ];
}

/**
 * The motion proof: Compose has built the home page and shown it to the client, moving.
 *
 * IT IS A COMMAND BECAUSE THE GATE DEPENDS ON IT. `scripts/gate-done.sh` runs the fidelity gate
 * only once `explore.proof` is recorded, so a model that has to hand-edit JSON to write it is a
 * model that will sometimes not, and every build after Compose would then read
 * `fidelity=skipped` in the done summary with nothing saying a check had been lost. A flag can
 * be named in the doctrine and copied verbatim.
 */
const proofUrl = opt("--proof");
const proofUnmeasured = flag("--proof-unmeasured") ? (opt("--proof-unmeasured") ?? "") : null;
if (proofUnmeasured !== null && !proofUrl) {
  badArgs("--proof-unmeasured says why the preview could not be measured, so it needs the preview: pass --proof <url> with it.");
}
if (proofUrl) {
  if (!/^https?:\/\/\S+$/.test(proofUrl)) {
    refuse(`--proof ${proofUrl} is not a URL. It is the preview the client was shown the home page moving on, so it has to be one they can open.`);
  }
  if (proofUnmeasured !== null) {
    // THE HONEST ESCAPE, and it is recorded rather than silent. Some previews cannot be driven
    // from this machine: a tunnel that only the client's browser reaches, a staging host behind
    // a login. The proof is still worth recording, and what the gate must never see is an
    // unmeasured proof that looks exactly like a measured one.
    const reason = proofUnmeasured.trim();
    if (!reason) {
      refuse("--proof-unmeasured needs the reason the probe could not reach the preview. Without it this flag is a way of not measuring that leaves no trace, which is the fault it exists to make visible.");
    }
    patch.explore.proof = { url: proofUrl, verified_at: new Date().toISOString(), measured: null, reason };
  } else {
    /**
     * MEASURE IT. A real build recorded this proof on the agent's word: the board promised a
     * 0.6x parallax, the record said the motion had been shown, and the image moved 7 per cent
     * of the scroll. The person who opened the preview said there was no motion. Nothing could
     * have contradicted the record, because the record held nothing that could be wrong.
     */
    const probe = join(HERE, "motion-proof.mjs");
    let measured = null;
    let probeErr = "";
    try {
      measured = JSON.parse(execFileSync(process.execPath, [probe, proofUrl], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
        // A bound, because the probe drives a browser at a URL somebody typed. Without it a
        // page that never finishes loading hangs the command the doctrine tells every build to
        // run, and a hang reads as a broken tool rather than as an unreachable preview.
        timeout: 60_000,
      }));
    } catch (e) {
      probeErr = (e.stderr || e.message || "").toString().trim().split("\n")[0];
    }
    if (!measured) {
      refuse(`the preview at ${proofUrl} could not be measured (${probeErr || "the probe returned nothing"}). If the page really is out of this machine's reach, say so: --proof ${proofUrl} --proof-unmeasured "<reason>".`);
    }
    const parallax = Array.isArray(measured.parallax) ? measured.parallax : [];
    /**
     * A WITHHELD MEASUREMENT IS NEITHER EVIDENCE NOR A LICENCE.
     *
     * On a page too short to scroll the probe reports no parallax at all, because every ratio
     * would be a small number divided by a smaller one. Reading that empty list as "nothing
     * moves" would refuse a page on a measurement nobody took; making it PROVE the page moves,
     * which is what the first fix did, let a wholly static short page record a motion proof.
     * So on a short page the parallax clause is simply not part of the floor, and the other
     * three still are.
     */
    const shortPage = measured.short_page === true;
    const still = (measured.animated || 0) === 0
      && (measured.running || 0) === 0
      && (shortPage || parallax.every((p) => (Number(p.ratio) || 0) < 0.05))
      && measured.header?.before === measured.header?.after;
    if (still) {
      refuse(shortPage
        ? `nothing measurable moves at ${proofUrl}: no animation, nothing running, the header unchanged, and the page is too short to scroll far enough to measure a parallax. Build the motion the board promised, or if this preview cannot be driven from here say so: --proof ${proofUrl} --proof-unmeasured "<reason>".`
        : `nothing measurable moves at ${proofUrl}; the motion proof is what the client was promised, build it before recording it.`);
    }
    patch.explore.proof = { url: proofUrl, verified_at: new Date().toISOString(), measured };
  }
}

/**
 * WHERE THE BOARDS WENT: the canvas was published, or it was declined with a reason.
 *
 * `scripts/gate-explore.mjs` blocks a build that recorded `explore.shown_at` and then said
 * nothing about the canvas, and until this flag existed the doctrine asked for the field and
 * named no command to write it, so the only way to clear the gate was to hand-edit the
 * manifest, which the same doctrine forbids. A gate with no writer is a gate people route
 * around.
 *
 * The two are mutually exclusive in one call because they are opposite claims about the same
 * set, and a call carrying both is a model guessing rather than reporting.
 */
const canvasUrl = flag("--canvas-url") ? (opt("--canvas-url") ?? "") : null;
const canvasSkipped = flag("--canvas-skipped") ? (opt("--canvas-skipped") ?? "") : null;
if (canvasUrl !== null && canvasSkipped !== null) {
  refuse("--canvas-url and --canvas-skipped say opposite things about the same set: the canvas was published, or it was declined. Pass one.");
}
if (canvasUrl !== null) {
  let usable = false;
  try { const u = new URL(canvasUrl); usable = u.protocol === "http:" || u.protocol === "https:"; } catch { usable = false; }
  if (!usable) {
    refuse(`--canvas-url ${JSON.stringify(canvasUrl)} is not an http(s) URL. It is the link the client opens to work on the boards, so it has to be one they can open.`);
  }
  patch.explore.canvas = { url: canvasUrl, recorded_at: new Date().toISOString() };
}
if (canvasSkipped !== null) {
  const reason = canvasSkipped.trim();
  if (!reason) {
    refuse("--canvas-skipped needs the reason. A declined canvas is an honest outcome and an unexplained one is silence, which is what the gate is refusing in the first place.");
  }
  patch.explore.canvas = { skipped: true, reason, recorded_at: new Date().toISOString() };
}

/**
 * THE COMPOSE RECORD: somebody opened the page, and said what they saw.
 *
 * A real build shot 101 screenshots and finished with no record that anyone had held one of
 * them against the board it was composed from. Screenshots prove a page RENDERED. They say
 * nothing about whether the hero still bleeds the way the direction did, and a build can pass
 * every mechanical gate it has while quietly becoming a different site from the one the client
 * signed off.
 *
 * So the look is recorded the way the pick is: by command, with the evidence attached.
 *
 *   the SHOT   has to be a screenshot of this build (under .palate-shots/) and NEWER than the
 *              built page, because a sentence about pixels that were replaced afterwards is a
 *              sentence about a page nobody has seen. It is fingerprinted, so the record names
 *              the exact image the reading is about.
 *   the VERDICT has to be a reading rather than a verdict-shaped noise. "Looks good" is the
 *              shape a model reaches for when it did not open anything, so the empty phrases
 *              are named and refused, and a sentence under 40 characters cannot carry three
 *              observations however it is worded.
 *
 * The OVERRIDE is the other half, and it is what makes the fidelity gate usable. A build
 * sometimes SHOULD depart from the board (the only photograph is too soft to bleed), and
 * without a way of saying so the only options are a permanent finding or a weaker gate. An
 * override is a departure with a reason attached, recorded once, and a later task suppresses
 * exactly the finding it names and prints the reason beside it.
 */
const compose = manifest.compose && typeof manifest.compose === "object" ? manifest.compose : {};
const existingPages = Array.isArray(compose.pages) ? compose.pages.slice() : [];
const existingOverrides = Array.isArray(compose.overrides) ? compose.overrides.slice() : [];

// Phrases that read as a look and are not one. Matched on WORD BOUNDARIES: "fine" inside
// "refined" is a real word in a real reading, and a checker that cannot tell them apart
// teaches people to write around it rather than to look.
// "fine" is gone from this list: "the hairline rule is fine at 1px, the kicker is gone" is a
// real reading of a real page, and refusing it told the author they had not opened anything.
const EMPTY_VERDICTS = ["looks good", "matches the board", "no issues", "as designed"];
const MIN_VERDICT = 40;

const lookedRoute = flag("--looked") ? (opt("--looked") ?? "") : null;
if (lookedRoute !== null && proofUrl) {
  refuse("--looked and --proof are two different records and this command writes one at a time. Record the motion proof, then record the look.");
}
if (lookedRoute !== null) {
  const route = normaliseRoute(lookedRoute);
  const shotArg = opt("--shot");
  const verdict = (opt("--verdict") ?? "").trim();
  if (!shotArg) refuse("--looked needs the screenshot it was taken from: --shot .palate-shots/<file>.png. A look with no image is a claim.");
  if (!verdict) refuse("--looked needs --verdict \"<what you saw>\": three things you can see in the shot, in your own words.");

  const shotsRoot = resolve(dir, ".palate-shots");
  const shotPath = resolve(dir, shotArg);
  if (shotPath !== shotsRoot && !shotPath.startsWith(shotsRoot + sep)) {
    refuse(`the look must be a screenshot under .palate-shots/ (got ${shotArg}). That directory is what the capture driver writes, so a file outside it is an image nothing in this build produced.`);
  }
  if (!existsSync(shotPath)) refuse(`--shot ${shotArg} does not exist (${shotPath}). Take the screenshot before recording the look.`);

  /**
   * THE PAGE THE SHOT IS OF, in the order the adapters produce it. A route with no built page
   * is not refused here: a look can honestly be recorded against a preview, and refusing would
   * make this command unusable on the exact builds that serve rather than build. What IS
   * refused is a shot that predates a page we CAN see, because that is measurable.
   */
  const slug = route === "/" ? "" : route.replace(/^\//, "");
  const builtPage = [
    slug ? join(dir, "dist/client", slug, "index.html") : join(dir, "dist/client/index.html"),
    slug ? join(dir, "dist", slug, "index.html") : join(dir, "dist/index.html"),
  ].find((p) => existsSync(p));
  if (builtPage && statSync(shotPath).mtimeMs < statSync(builtPage).mtimeMs) {
    refuse(`the shot is older than the built page it claims to be of (${shotArg} predates ${builtPage.slice(dir.length + 1)}). Re-shoot the page and look at what it is now.`);
  }

  if (verdict.length < MIN_VERDICT) {
    refuse(`--verdict is ${verdict.length} characters and the floor is ${MIN_VERDICT}. Name three things you can see in the shot: what the hero does, where the eye goes second, and one thing that is wrong or deliberately different.`);
  }
  const empty = EMPTY_VERDICTS.find((p) => new RegExp(`\\b${p.replace(/ /g, "\\s+")}\\b`, "i").test(verdict));
  if (empty) {
    refuse(`--verdict says "${empty}", which is the phrase somebody writes when they did not open the page. Say what is on it instead: the hero, the second thing the eye lands on, and one thing that is wrong or deliberately different.`);
  }

  /**
   * `--primary` NAMES THE ROUTE THE DRAWN INNER PAGE BECAME.
   *
   * Every direction is drawn with one inner page (`I<N>`) beside its home, and it is the only
   * picture of what this direction's inner pages were supposed to be. Nothing on the manifest
   * said which route it was lifted into, so the page judge had no choice but to hold every
   * inner page against the donor's HOME page, which is the weaker of the two comparisons
   * available and is not the promise the client was shown. One mark closes that.
   *
   * AT MOST ONE PER BUILD, and the home can never be it: the home has its own board, and a
   * build claiming two primary inner pages is a build saying the drawing became two things.
   */
  const primary = flag("--primary");
  if (primary && route === "/") {
    refuse("--primary marks the route the drawn INNER page became, so it cannot be the home page: the home answers to the direction's own board. Mark the inner page the client will spend their time on.");
  }

  const entry = {
    route,
    page_type: pageTypeOf(route),
    shot: shotArg,
    shot_sha256: createHash("sha256").update(readFileSync(shotPath)).digest("hex"),
    looked_at: new Date().toISOString(),
    verdict,
    ...(primary ? { primary: true } : {}),
  };
  // ONE ENTRY PER ROUTE. A second look at the same page is a newer reading of it, not a second
  // page, and a list that grew would let one look at the home page stand in for five.
  patch.compose = patch.compose || {};
  const others = existingPages.filter((p) => normaliseRoute(p?.route) !== route);
  patch.compose.pages = [
    // A SECOND `--primary` MOVES THE MARK rather than adding one. Two routes claiming the drawn
    // inner page would have the judge comparing one drawing with two pages and reporting both.
    ...(primary ? others.map(({ primary: _drop, ...p }) => p) : others),
    entry,
  ];
}

if (flag("--primary") && lookedRoute === null) {
  refuse("--primary marks a route that is being looked at, so it goes with --looked: --looked /security-windows --shot ... --verdict \"...\" --primary.");
}

if (overrideRoute !== null) {
  const route = normaliseRoute(overrideRoute);
  const section = (opt("--section") ?? "").trim();
  const what = (opt("--what") ?? "").trim();
  const reason = (opt("--reason") ?? "").trim();
  if (!section) refuse("--override needs the band it is about: --section hero. An override with no section suppresses nothing, because the gate matches on the section it names.");
  if (!what) refuse("--override needs --what \"<what was done instead>\", in the words somebody comparing the page with the board would use.");
  if (!reason) {
    refuse("--override needs --reason \"<why>\". The reason IS the record: a departure from the board with no reason attached is indistinguishable from the drift this gate exists to catch.");
  }
  patch.compose = patch.compose || {};
  // APPENDED, never replaced. Two overrides on one section of one page are two decisions taken
  // at two moments, and the later one does not unmake the earlier one's reason.
  patch.compose.overrides = [...(patch.compose.overrides ?? existingOverrides), { route, section, what, reason, recorded_at: new Date().toISOString() }];
}

/**
 * THE QUESTION ROUND: the three things Compose needs from the person before any Astro is
 * built for the picked rung. `--answer` is repeatable (one flag per question, or several
 * calls over a session) so every occurrence on this command line is collected, not just the
 * last, and merge-by-field in manifest-merge.mjs lets a later call add `cms` without wiping a
 * `motion` recorded an hour earlier.
 */
const ANSWER_KEYS = ["motion", "mix", "cms"];
const answers = {};
for (let i = 0; i < args.length; i++) if (args[i] === "--answer") {
  const kv = String(args[i + 1] || "");
  const eq = kv.indexOf("=");
  const k = eq > 0 ? kv.slice(0, eq).trim() : "";
  const v = eq > 0 ? kv.slice(eq + 1).trim() : "";
  if (!ANSWER_KEYS.includes(k) || !v) {
    refuse(`--answer takes one of motion, mix, cms (as key=text; got ${JSON.stringify(kv)}). These are the three things Compose needs from the person: how the picked direction should move, what to mix in from other boards, and who edits the copy.`);
  }
  answers[k] = v;
}
if (Object.keys(answers).length) {
  patch.explore.question_round = { ...answers, answered_at: new Date().toISOString() };
}

if (flag("--second-pass")) {
  // COUNTS, never latches. A boolean would answer "did they ask for changes" and lose the
  // question worth asking, which is how many rounds a direction takes before it is settled.
  patch.explore.second_passes = (Number(explore.second_passes) || 0) + 1;
}

// ------------------------------------------------------------------- the canvas read-back
let feedbackCount = null;
let feedbackClean = [];
let feedbackUnaligned = [];
const canvasDir = opt("--canvas");
if (canvasDir) {
  const ex = resolve(dir, canvasDir);
  if (!existsSync(ex)) refuse(`--canvas ${canvasDir} does not exist (${ex}). An extract that cannot be read is not a client who changed nothing.`);
  const seedDir = join(dir, ".palate/explore/seed");
  if (!existsSync(seedDir)) refuse(`there is no seed at ${seedDir} to diff against. Run boards-render.mjs before reading a canvas back.`);
  const read = diffCanvas(seedDir, ex, boards);
  mkdirSync(join(dir, ".palate/explore"), { recursive: true });
  writeFileSync(join(dir, ".palate/explore/feedback.json"), JSON.stringify(read.entries, null, 2) + "\n");
  feedbackCount = read.entries.length;
  feedbackClean = read.clean;
  feedbackUnaligned = read.unaligned;
}

// ------------------------------------------------------------------------------- record
if (!made.length && !patch.commission && !patch.explore.cta && !patch.explore.notes
    && !patch.explore.proof && !patch.explore.question_round && !patch.explore.canvas
    && patch.explore.second_passes === undefined && canvasDir === null && !patch.compose) {
  badArgs("nothing to record. Pass at least one of --hero, --section, --intensity, --cta, --note, --proof, --answer, --canvas-url, --canvas-skipped, --second-pass, --canvas, --looked or --override.");
}

if (existsSync(manifestPath)) {
  const merge = join(HERE, "manifest-merge.mjs");
  try {
    execFileSync(process.execPath, [merge, "--manifest", manifestPath, "--set", JSON.stringify(patch)], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    refuse(`the manifest could not be written (${(e.stderr || e.message || "").toString().trim().slice(0, 200)}).`);
  }
} else {
  process.stderr.write(`palate-pick: no build-manifest.json at ${manifestPath}; the pick was not recorded anywhere durable.\n`);
}

// -------------------------------------------------------------------------------- report
for (const p of made) {
  const shown = explore.shown_at ? Date.parse(explore.shown_at) : NaN;
  const took = Number.isFinite(shown) ? Math.round((Date.parse(p.picked_at) - shown) / 1000) : null;
  process.stdout.write(
    `palate-pick: ${p.surface} = ${p.variant_id}, direction ${p.rung} of ${N} (position ${p.position})` +
    `${took !== null ? `, time to pick ${took}s` : ", time to pick unknown (no shown_at: boards-render did not stamp this build)"}\n`,
  );
}
if (patch.commission) process.stdout.write(`palate-pick: the client pointed at calibration reference ${patch.commission.intensity_asked}.\n`);
if (patch.explore.cta) process.stdout.write(`palate-pick: call to action "${patch.explore.cta}".\n`);
if (patch.explore.proof) {
  process.stdout.write(
    `palate-pick: motion proof recorded at ${patch.explore.proof.url}. The done gate measures the built home against the picked board from here.\n`,
  );
}
if (patch.explore.canvas) {
  process.stdout.write(
    patch.explore.canvas.url
      ? `palate-pick: canvas published at ${patch.explore.canvas.url}. /explore links to it first.\n`
      : `palate-pick: canvas declined, recorded as "${patch.explore.canvas.reason}". Hand over /explore instead.\n`,
  );
}
if (patch.compose?.pages) {
  const e = patch.compose.pages[patch.compose.pages.length - 1];
  process.stdout.write(`palate-pick: look recorded on ${e.route} (${e.page_type}), from ${e.shot}. The done gate asks for one look per page type.\n`);
}
if (patch.compose?.overrides) {
  const o = patch.compose.overrides[patch.compose.overrides.length - 1];
  process.stdout.write(`palate-pick: override on ${o.route}, ${o.section}: ${o.what}, because ${o.reason}.\n`);
}
if (patch.explore.question_round) {
  process.stdout.write(`palate-pick: question round recorded (${Object.keys(answers).sort().join(", ")}).\n`);
}
if (patch.explore.second_passes !== undefined) process.stdout.write(`palate-pick: second pass ${patch.explore.second_passes}.\n`);
if (feedbackCount !== null) {
  if (!feedbackCount) {
    process.stdout.write("palate-pick: no change was made on the canvas; feedback.json is empty.\n");
  } else {
    process.stdout.write(`palate-pick: ${feedbackCount} change(s) read back from the canvas into .palate/explore/feedback.json.\n`);
    // THE INSTRUCTION IS SCOPED TO THE BOARDS IT IS TRUE OF. It used to be printed over every
    // board including one the diff had just warned it could not align, so the last line the
    // operator read was "Compose must honour" over a file full of guesses.
    if (feedbackClean.length) {
      process.stdout.write(`  Read cleanly: ${feedbackClean.join(", ")}. Compose must honour the text edits and the notes on the picked surfaces.\n`);
    }
    for (const u of feedbackUnaligned) {
      process.stdout.write(`  Read ${u.board} by hand before Compose: ${u.why}, so nothing recorded for it is a reliable edit.\n`);
    }
  }
}
process.exit(0);

// ============================================================================== the diff

/**
 * What changed between the seed and what came back.
 *
 * The two files descend from the same render, so they can be walked in document order and
 * compared position by position. That is the whole trick and it is why this needs no parser:
 * the canvas edits text and inline styles, it does not restructure a page. When the shapes
 * disagree the common prefix is still compared and the mismatch is SAID, because a diff that
 * quietly gave up looks exactly like a client who changed nothing.
 */
export function diffCanvas(seedDir, extractDir, boards) {
  const out = [];
  const clean = [];
  const unaligned = [];

  /**
   * EVERY SURFACE OF EVERY DIRECTION, not only the home board.
   *
   * A direction is four artboards on the canvas, and the client can edit any of them. Diffing
   * `B<n>` alone meant a reworded form error on the detail sheet, or a headline retyped on the
   * phone, came back as "no change was made on the canvas": the most specific instruction a
   * client can give, silently dropped. Every entry now carries the surface it was made on, so
   * Compose applies a sheet edit to the sheet.
   */
  const surfaces = boards.flatMap((b) => boardSurfaces(b).map((s) => ({ ...s, board: b })));
  const byFile = new Map(surfaces.map((s) => [s.file, { board: s.board.id, surface: s.surface }]));
  for (const b of boards) {
    // The donor card is the plugin's own, but a note can be written beside it and it belongs to
    // the direction it sits with.
    if (Number.isFinite(Number(b.ambition))) byFile.set(`D${Number(b.ambition)}.dc.html`, { board: b.id, surface: "donor" });
  }

  for (const { board: b, surface, file } of surfaces) {
    const label = surface === "home" ? b.id : `${b.id} ${surface}`;
    const a = join(seedDir, file);
    const z = join(extractDir, file);
    if (!existsSync(a) || !existsSync(z)) continue;
    const before = scanArtboard(readFileSync(a, "utf8"));
    const after = scanArtboard(readFileSync(z, "utf8"));

    /**
     * ALIGN ON THE KEY, and say so when it cannot be done.
     *
     * boards-render stamps `data-palate-k` on every element, and the editor preserves
     * attributes, so a deletion is a key that is gone rather than every element after it
     * appearing to have changed. A seed written before the keys existed, or an extract whose
     * keys were duplicated by a copy-paste, cannot be aligned: those boards produce NO
     * positional guesses at all, because a wrong edit Compose is told to honour is worse than
     * no edit, and the caller sends them to a person.
     */
    const dupes = (list) => {
      const seen = new Set();
      for (const x of list) { if (seen.has(x.key)) return true; seen.add(x.key); }
      return false;
    };
    const keyed = before.keyed && after.keyed && !dupes(before.styles) && !dupes(after.styles);
    if (!keyed) {
      unaligned.push({ board: label, why: before.keyed && after.keyed ? "duplicated element keys" : "no element keys in the seed or the extract" });
      out.push({
        board: b.id,
        surface,
        kind: "unaligned",
        path: file,
        before: null,
        after: before.keyed && after.keyed
          ? "the extract carries duplicated element keys, so nothing in it can be matched to the board"
          : "the artboard carries no element keys, so a change cannot be told from a shift",
      });
      continue;
    }

    const textBefore = new Map(before.texts.map((t) => [t.key, t.text]));
    const textAfter = new Map(after.texts.map((t) => [t.key, t.text]));
    for (const [key, text] of textBefore) {
      if (!textAfter.has(key)) continue;   // removals are reported once, below
      if (textAfter.get(key) !== text) out.push({ board: b.id, surface, kind: "text", path: key, before: text, after: textAfter.get(key) });
    }

    const styleBefore = new Map(before.styles.map((t) => [t.key, t.style]));
    const styleAfter = new Map(after.styles.map((t) => [t.key, t.style]));
    for (const [key, style] of styleBefore) {
      if (!styleAfter.has(key)) continue;
      if (styleAfter.get(key) !== style) out.push({ board: b.id, surface, kind: "style", path: key, before: style, after: styleAfter.get(key) });
    }

    // ONE ENTRY PER ELEMENT, whichever way it went. A deleted band is a decision the client
    // made and Compose has to honour it; hundreds of shifted pairs are noise dressed as one.
    const keysBefore = new Set([...styleBefore.keys(), ...textBefore.keys()]);
    const keysAfter = new Set([...styleAfter.keys(), ...textAfter.keys()]);
    for (const key of keysBefore) {
      if (keysAfter.has(key)) continue;
      out.push({ board: b.id, surface, kind: "removed", path: key, before: textBefore.get(key) ?? styleBefore.get(key) ?? null, after: null });
    }
    for (const key of keysAfter) {
      if (keysBefore.has(key)) continue;
      out.push({ board: b.id, surface, kind: "added", path: key, before: null, after: textAfter.get(key) ?? styleAfter.get(key) ?? null });
    }
    clean.push(label);
  }

  // The annotations, which are where a client writes a sentence rather than dragging a value.
  const seedCanvas = readJson(join(seedDir, "canvas.json"));
  const backCanvas = readJson(join(extractDir, "canvas.json"));
  if (seedCanvas && backCanvas) {
    const was = new Map((seedCanvas.annotations || []).map((n) => [n.id, n.text]));
    for (const n of backCanvas.annotations || []) {
      const before = was.has(n.id) ? was.get(n.id) : null;
      if (before === n.text) continue;
      const where = boardForAnnotation(n, backCanvas, byFile);
      out.push({ board: where.board, surface: where.surface, kind: "note", path: n.id, before, after: n.text });
    }
  }
  return { entries: out, clean, unaligned };
}

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

/**
 * The artboards one direction is made of, and what each of them is.
 *
 * `presentation` is required of a registry written by the current template, and absent from an
 * older one and from the ladder recovered out of `explore.boards` after Compose clears the
 * registry. A surface with no file is simply not diffed: this reads a canvas back, and refusing
 * here would turn an old build's feedback into an error message.
 */
function boardSurfaces(b) {
  const p = b.presentation || {};
  return [
    { surface: "home", file: b.artboard || `B${b.ambition}.dc.html` },
    { surface: "inner", file: p.inner },
    { surface: "mobile", file: p.mobile },
    { surface: "sheet", file: p.sheet },
  ].filter((s) => s.file);
}

/**
 * Which board, and which of its surfaces, a note belongs to.
 *
 * An annotation the plugin wrote names both in its id. One a CLIENT wrote names neither, so it
 * is attributed by geometry, and the geometry changed underneath it: the canvas lays one ROW
 * per direction, so every home board sits at x 0 and the old horizontal-span test attributed
 * every free-form note on the canvas to direction 1. A client's sentence about the boldest
 * direction was applied to the most restrained one, in the file Compose is told to honour.
 *
 * So a note belongs to the frame whose x span AND y span contain it, any of the five in the
 * row. Rows are 120 apart and the slop is 40, so a note below one row cannot reach the next.
 * A note inside no frame is recorded against the whole set rather than dropped, because an
 * unattributable sentence from a client is still the most valuable line on the canvas.
 */
function boardForAnnotation(note, canvas, byFile) {
  const named = /^(board|inner|mobile|sheet|donor)-(.+)$/.exec(note.id || "");
  if (named) return { board: named[2], surface: named[1] === "board" ? "home" : named[1] };
  const SLOP = 40;
  for (const f of canvas.artboards || []) {
    const where = byFile.get(f.file || "");
    if (!where) continue;
    const inX = note.x >= f.x - SLOP && note.x <= f.x + f.w + SLOP;
    const inY = note.y >= f.y - SLOP && note.y <= f.y + f.h + SLOP;
    if (inX && inY) return where;
  }
  return { board: null, surface: null };
}

/**
 * Walk an artboard and record its text runs and its inline styles, in document order.
 *
 * The path is an ordinal, `h1[3]`, rather than a CSS selector. A selector would be prettier and
 * would also be a promise this cannot keep: the flattened artboard's classes come from the
 * build and are not stable across a rebuild, where the position of an element in the document
 * is exactly what Compose needs to find it again.
 */
export function scanArtboard(html) {
  const body = /<x-dc\b[^>]*>([\s\S]*)<\/x-dc>/i.exec(html);
  const src = body ? body[1].replace(/<helmet\b[\s\S]*?<\/helmet>/i, "") : html;
  const texts = [];
  const styles = [];
  const counts = new Map();
  let keyed = false;
  let last = null;
  // ATTRIBUTE-AWARE, so a `>` inside a quoted value does not end the tag: the serialiser does
  // not escape one, and a single `aria-label="Next >"` shifted every path after it.
  const re = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) {
      const text = m[3].replace(/\s+/g, " ").trim();
      if (text && last) texts.push({ path: last.path, key: last.key, text });
      continue;
    }
    const tag = m[1].toLowerCase();
    if (m[0].startsWith("</")) { last = null; continue; }
    if (tag === "script" || tag === "style") { last = null; continue; }
    const n = (counts.get(tag) || 0);
    counts.set(tag, n + 1);
    const attrs = m[2] || "";
    const km = /\bdata-palate-k\s*=\s*"([^"]*)"/i.exec(attrs);
    if (km) keyed = true;
    // The ordinal is the fallback identity and the legible half of a key: `k12 (p[3])` tells a
    // reader where to look, where `k12` alone tells them nothing.
    const path = `${tag}[${n}]`;
    last = { path, key: km ? km[1] : path };
    const st = /\bstyle\s*=\s*"([^"]*)"/i.exec(attrs);
    if (st) styles.push({ path, key: last.key, style: st[1] });
  }
  return { texts, styles, keyed };
}
