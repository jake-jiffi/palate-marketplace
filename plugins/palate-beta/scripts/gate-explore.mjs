#!/usr/bin/env node
import { routeOrExit } from "./lib/workflow-route.mjs";
/**
 * scripts/gate-explore.mjs - the Explore PRESENTATION gate.
 *
 * ========================== WHAT IT IS PROTECTING ==========================
 *
 * Explore's value is that it hands a client a declared RANGE, and a range only exists if the
 * client can see it is one. Handed `/v1` through `/v8` with no framing, a client reads eight
 * guesses, opens two, and picks whichever is nearest what they already had in mind. Every
 * expensive thing about the ladder is then wasted, and the restrained rung in particular reads
 * as "the boring one" rather than as one deliberate end of a span.
 *
 * So this gate holds seven things that are easy to skip and impossible to notice missing:
 *
 *   1. THE COACHING PAGE EXISTS. `src/pages/explore.astro` is what says what happened, draws
 *      the ladder, and tells the client what to do next (react, mix across rungs, ask for
 *      changes, and only then build the whole site). A set of boards with no such page
 *      is a pile of links.
 *   2. EVERY BOARD ARGUES FOR ITSELF. `what`, `why` and `feeling` on each entry are the
 *      difference between "I like that one" and "somewhere around 4, with 5's motion". They
 *      are also a check on the BUILD: a rung whose `why` restates its `what`, or whose feeling
 *      is "modern and clean", did not have an idea, and that is worth catching before a client
 *      reads it rather than after.
 *   3. THE LADDER IS REAL. Every rung carries a distinct `ambition`, and they run 1..N with no
 *      gaps, because a set that is all rung 1 or has three rung 4s is a bag wearing a ladder's
 *      labels.
 *   4. THE ARTBOARD IS THE RUNG'S OWN, EXISTS, AND THE MOTION IS WRITTEN. `artboard` must be
 *      exactly `B<rung>.dc.html`, because `/pick --canvas` derives that name from the rung and
 *      a board naming any other file has its client edits read back from somewhere else. A
 *      registered file that was never drawn is a rung the canvas cannot draw, and a board is
 *      mostly a STILL: a direction whose motion plan was never written is chosen with its most
 *      expensive property invisible. A `motion` that restates `what` is that field filled in
 *      rather than thought about.
 *   5. THE SET IS A SET. One distinct donor per rung, because five boards drawn from one
 *      reference are one idea wearing five skins, and two or three CTA labels per board,
 *      because one is a guess and four is a survey.
 *   6. A SHOWN CANVAS WAS PUBLISHED OR DECLINED. Once `explore.shown_at` is recorded,
 *      `explore.canvas` must say what happened to it: a published `{ url }`, or a declined
 *      `{ skipped: true, reason }`. Silence reads as "the client never got to see a canvas at
 *      all", which is worse than either honest outcome. `/pick --canvas-url <url>` and
 *      `/pick --canvas-skipped "<reason>"` are what write it.
 *   7. A BOLD BRIEF HAS A REAL LADDER. Three rungs is the floor on a high-intensity brief,
 *      because below three there is no "between" for a client to point at.
 *   8. EVERY PIECE NAMES ITS VARIATION AND ITS DONOR. A direction is signed off piece by piece,
 *      so `pieces` records the kit variation used for the navigation, the hero, the closing
 *      band, the enquiry form, the footer and the direction's own inner section, and the
 *      reference each one's craft came from. A variation the kit does not carry is a promise
 *      the build cannot keep, and a donor nobody surveyed is provenance invented afterwards.
 *   9. THE DETAIL SHEET AND THE REGISTRY AGREE. The sheet is the artefact the client signs;
 *      the registry is what Compose builds from. A direction whose sheet shows one footer and
 *      whose registry records another ships a footer nobody approved.
 *
 * ============================ FAIL-OPEN, ALWAYS ============================
 *
 * It only has an opinion once variants are REGISTERED. No variants.ts, no variants, or a build
 * that is not doing Explore all SKIP. It has nothing to say about a non-Explore build, a
 * single-page edit, or a user who never ran Explore at all.
 *
 * A SKIP SAYS SO AND EXITS 2, it does not exit 0. Exiting 0 having inspected nothing put
 * "explore=pass" in the done gate's summary line on every build that never ran Explore.
 *
 * Exit 0 = pass, 2 = skip (first stderr line `gate-explore: skipped (<reason>)`) OR block
 * (with the specific entries named). The caller separates the two on that first line.
 * Usage: node scripts/gate-explore.mjs [projectDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginRootRefusal } from "../hooks/project-dir.mjs";
// ONE PARSER FOR THE KIT AND FOR THE REGISTRY'S NESTED BLOCKS. boards-render checks the detail
// sheet's marks against the same manifest, and two parsers reading one file differently is how a
// check passes on one surface and fails on the other. Importing runs nothing: that module only
// calls main() when it is the entry point.
import { parseKitVariations, splitPieces, presentationOf } from "./boards-render.mjs";
// The bar, the wording and the surface names come from the judge itself: stated twice, they
// drift, and a done gate that refuses a different set from the judge is worse than neither.
import { refusedRung, WORSE_PHRASE, SURFACES } from "./gate-board-judge.mjs";

const dir = process.argv[2] || ".";
routeOrExit("reader", "gate-explore", [dir]);

// NEVER GRADE THE PLUGIN'S OWN FILES. This defaults to ".", and the plugin ships a template
// variants.ts, so a run from a plugin checkout would judge the scaffold's example entries as
// though a client were about to be handed them.
const refusal = pluginRootRefusal(dir);
if (refusal) {
  console.error(`gate-explore: refused: ${refusal}. Name the site directory explicitly. NOT a pass.`);
  process.exit(2);
}
const read = (p) => {
  try {
    return readFileSync(join(dir, p), "utf8");
  } catch {
    return null;
  }
};

/**
 * Strip comments without touching string contents.
 *
 * This is not fussiness: the shipped template carries a COMMENTED-OUT example entry with every
 * required field filled in, so a naive regex scan would read the template itself as a valid,
 * fully-argued variant and pass a build that registered nothing.
 */
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
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The body of `export const <name>: Variant[] = [ ... ]`, by bracket matching. */
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

/** Top-level `{...}` objects inside an array body. */
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
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) out.push(body.slice(start, i + 1));
    }
  }
  return out;
}

/** A string-array field (`ctas: ["a", "b"]`). Returns null when the key is absent. */
function arrayField(obj, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`, "s").exec(obj);
  if (!m) return null;
  return [...m[1].matchAll(/(["'\`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((x) => x[2].trim()).filter(Boolean);
}

function field(obj, key) {
  const s = new RegExp(`\\b${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`, "s").exec(obj);
  if (s) return s[2].replace(/\\(['"`])/g, "$1").trim();
  const num = new RegExp(`\\b${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(obj);
  return num ? Number(num[1]) : null;
}

const findings = [];
const add = (what, why) => findings.push({ what, why });

const src = read("src/lib/variants.ts");
if (!src) {
  // A SKIP IS NOT A PASS. Exiting 0 here put "explore=pass" in the done gate's summary for
  // every build that never ran Explore, so the one line a person reads claimed a gate had
  // cleared a thing it had not looked at. Say what was not inspected, and exit 2.
  console.error("gate-explore: skipped (not an Explore build: no src/lib/variants.ts)");
  process.exit(2);
}

const clean = stripComments(src);
const body = arrayBody(clean, "variants");
const entries = body ? objects(body) : [];
if (!entries.length) {
  console.error("gate-explore: skipped (no boards registered)");
  process.exit(2);
}

// ------------------------------------------------------- 1. the coaching page
if (!existsSync(join(dir, "src/pages/explore.astro"))) {
  add(
    "No page explains the range",
    `${entries.length} variant(s) are registered but src/pages/explore.astro does not exist. The client gets a list of URLs with nothing saying what they are, why they differ, or what to do next, so the ladder reads as ${entries.length} unexplained guess${entries.length === 1 ? "" : "es"}. Copy it from the scaffold template.`,
  );
}

// ------------------------------------------------- 2. every rung argues for itself
// A feeling that describes any website describes none of them. This list is closed and short
// on purpose: it catches the reflex answers, not unusual ones.
const EMPTY_FEELING = /^(modern|clean|professional|sleek|minimal|fresh|bold|simple|elegant|premium|contemporary|dynamic|innovative|and|,|\s|&)+$/i;
const PLACEHOLDER_NAME = /^(option|variant|version|direction|concept|design|idea)\s*\d*$/i;

const seenAmbition = new Map();
const seenDonor = new Map();
const parsed = [];
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) || []);

for (const entry of entries) {
  /**
   * THE NESTED PROVENANCE IS CUT OUT BEFORE ANY OTHER FIELD IS READ. `pieces` carries a `donor:`
   * per entry and `field()` takes the first match anywhere in the object, so a board whose
   * `pieces` block sits above its own `donor:` line would report the NAVIGATION's reference as
   * the direction's, and "two boards drawn from one reference" would then be a claim about the
   * wrong slug on a set where nothing of the sort happened.
   */
  const { pieces, rest: o } = splitPieces(entry);
  const id = field(o, "id") || "(unnamed)";
  const name = field(o, "name");
  const artboardRaw = field(o, "artboard");
  const artboard = typeof artboardRaw === "string" ? artboardRaw.trim() : "";
  const ambition = field(o, "ambition");
  const what = field(o, "what");
  const why = field(o, "why");
  const feeling = field(o, "feeling");
  const donor = field(o, "donor");
  const section = field(o, "section");
  const motion = field(o, "motion");
  const ctas = arrayField(o, "ctas");
  const presentation = presentationOf(o);
  parsed.push({ id, ambition, pieces, section, presentation, sheet: presentation?.sheet || null });

  const missing = [];
  if (typeof ambition !== "number") missing.push("ambition");
  if (!what) missing.push("what");
  if (!why) missing.push("why");
  if (!feeling) missing.push("feeling");
  if (!donor) missing.push("donor");
  if (!section) missing.push("section");
  if (!motion) missing.push("motion");
  if (!ctas) missing.push("ctas");
  // WITHOUT IT, CHECK 10 SKIPS IN SILENCE. The sheet is named by `presentation.sheet`, so a
  // registry that declares no presentation has no sheet to compare its own provenance against,
  // and the comparison would simply not happen on the direction least likely to survive it.
  if (!presentation || !presentation.inner || !presentation.mobile || !presentation.sheet) missing.push("presentation");
  if (missing.length) {
    add(
      `${id} does not argue for itself`,
      `missing ${missing.join(", ")}. Every rung needs its own position on the ladder, what it is, why it is doing that for THIS business, the feeling it carries, the reference its craft came from, the section it shows, what MOVES on it, the CTA labels the client can choose between, and the other three artboards of the direction (presentation: { inner, mobile, sheet }). Without them the client can only judge on taste, and a board is mostly a still, so unwritten motion is unseen motion.`,
    );
    continue;
  }

  // ------------------------------------------- 4. the artboard exists (the board IS the file)
  if (!artboard) {
    add(`${id} has no artboard`, `every board names its file, e.g. artboard: "B${ambition ?? 1}.dc.html". Without it nothing can be drawn on the canvas or shown on /explore.`);
  } else if (artboard !== `B${ambition}.dc.html`) {
    // NOT just the SHAPE of the name, the name itself. `/pick --canvas` derives the file it
    // reads back from the rung (`B${ambition}.dc.html`), so a board at rung 3 registering
    // B7.dc.html passes a pattern check and then aligns against a file the read-back will
    // never open: the client's edits to that rung are silently dropped.
    add(
      `${id} names an artboard its rung will never open`,
      `rung ${ambition} is read back as B${ambition}.dc.html and this board registers ${artboard}. The canvas read-back (/pick --canvas) derives the file from the rung, so anything else is edits nobody reads.`,
    );
  } else if (!existsSync(join(dir, ".palate/explore/seed", artboard))) {
    add(`${id} registers a board that was never drawn`, `artboard ${artboard} needs .palate/explore/seed/${artboard} and there is no such file. The canvas shows a hole where rung ${ambition} should be.`);
  }

  /**
   * AND THE OTHER THREE FILES, AT DONE TIME.
   *
   * boards-render.mjs refuses a missing inner, phone or sheet file before it opens a browser,
   * which is the right place at DRAW time and a hole at DONE time: `gate-done.sh` runs this gate
   * and never runs boards-render, and the judge fingerprints the stills under `shots/` rather
   * than the seed. So a registry naming `S3.dc.html` after the file was deleted, renamed or
   * never committed cleared every done-time gate, check 10 silently skipped the provenance
   * comparison, and the seed handed to the next session was one board short with nothing saying
   * so. A direction is four artboards; the client is otherwise shown one of them missing.
   */
  for (const [kind, file] of Object.entries(presentation)) {
    if (file && !existsSync(join(dir, ".palate/explore/seed", file))) {
      add(
        `${id} registers a ${kind} board that was never drawn`,
        `presentation.${kind} names ${file} and there is no .palate/explore/seed/${file}. A direction is four artboards and the client is shown one short.`,
      );
    }
  }

  {
    const w = words(what);
    const mo = words(motion);
    if (w.size >= 4 && mo.size >= 4) {
      const shared = [...mo].filter((t) => w.has(t)).length;
      if (shared / mo.size >= 0.5) {
        add(
          `${id}'s motion restates its "what"`,
          "The motion plan and the description are the same sentence twice, so nobody wrote down what actually moves. Say what moves, when, and how it feels: a board is a still, and the client is otherwise choosing a direction with its most expensive property invisible.",
        );
      }
    }
  }

  if (ctas && (ctas.length < 2 || ctas.length > 3)) {
    add(
      `${id} offers ${ctas.length} call${ctas.length === 1 ? "" : "s"} to action`,
      "Two or three, so the client makes a choice rather than accepting a guess. One is a guess and four is a survey.",
    );
  }

  if (donor) {
    const n = seenDonor.get(donor) || [];
    n.push(id);
    seenDonor.set(donor, n);
  }

  if (name && PLACEHOLDER_NAME.test(name)) {
    add(`${id} has a placeholder name`, `"${name}" tells the client nothing. Name the idea, not its index.`);
  }
  if (EMPTY_FEELING.test(feeling)) {
    add(
      `${id}'s feeling describes any website`,
      `"${feeling}" would be true of almost every page ever built, so it carries no information. Name what a person would actually feel in front of THIS one.`,
    );
  }
  // A `why` that restates the `what` is the commonest way this section gets filled in without
  // being thought about, and it is detectable: the argument shares almost all of its words with
  // the description.
  const w = words(what);
  const y = words(why);
  if (w.size >= 4 && y.size >= 4) {
    const shared = [...y].filter((t) => w.has(t)).length;
    if (shared / y.size > 0.7) {
      add(
        `${id}'s "why" restates its "what"`,
        "The description and the argument are the same sentence twice. `why` has to say what this direction is FOR: who is arriving, what they need, and why this shape serves them.",
      );
    }
  }
  const n = seenAmbition.get(ambition) || [];
  n.push(id);
  seenAmbition.set(ambition, n);
}

// ------------------------------------------------------ 5. one distinct donor per rung
for (const [slug, who] of seenDonor) {
  if (who.length > 1) {
    add(
      `${who.length} boards are drawn from ${slug}`,
      `${who.join(", ")} share one donor, so they are one idea wearing ${who.length} skins. One distinct reference per rung: the range is the product, and a range sampled from a single site is not one.`,
    );
  }
}

// -------------------------------------------------------- 3. the ladder is real
const rungs = parsed.filter((v) => typeof v.ambition === "number");
if (rungs.length >= 2) {
  for (const [pos, ids] of seenAmbition) {
    if (ids.length > 1) {
      add(
        `Rung ${pos} is claimed by ${ids.length} variants`,
        `${ids.join(", ")} all sit at the same position, so the set is not a ladder at that point. One concept per rung.`,
      );
    }
  }
  const want = rungs.length;
  const got = [...new Set(rungs.map((v) => v.ambition))].sort((a, b) => a - b);
  const expected = Array.from({ length: want }, (_, i) => i + 1);
  if (got.length === want && got.some((v, i) => v !== expected[i])) {
    add(
      "The ladder has gaps",
      `${want} variant(s) carry positions ${got.join(", ")}, which should run 1 to ${want}. A gap makes the range unreadable: the client cannot tell whether a step is missing or whether the numbers mean nothing.`,
    );
  }
}

// -------------------------------------------- 6. a bold brief needs a real ladder
// The count sets the RESOLUTION of the ladder, never its range, so a floor is about having
// enough steps for "somewhere between 3 and 4" to mean anything. Below three there is no
// between. Only enforced on a high-intensity brief, where a collapsed Explore is the
// documented cause of a Variety-flat build.
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(join(dir, "build-manifest.json"), "utf8"));
} catch { /* no manifest, no opinion */ }
const intensity = String(manifest?.commission?.intensity ?? "");
// An off-enum value fails toward BOLD, the same way gate-done.sh reads it: a wrongly-bold
// build gets a loud gate and a wrongly-calm one gets a timid site nobody can explain.
const isHigh = intensity !== "" && intensity !== "calm";
let MIN_BOARDS = Number(process.env.PALATE_MIN_BOARDS ?? 3);
if (!Number.isFinite(MIN_BOARDS) || MIN_BOARDS < 1) MIN_BOARDS = 3;
if (isHigh && entries.length < MIN_BOARDS) {
  add(
    `a high-intensity brief has ${entries.length} board(s)`,
    `the ladder needs at least ${MIN_BOARDS} rungs for a client to point BETWEEN them, and this brief records commission.intensity "${intensity}". Build the remaining rungs, or record commission.explore_skip with the named-direction reason.`,
  );
}

/**
 * WHAT THE JUDGE STILL OWES, and whether it applies to this build at all. Checks 7 and 8 both
 * read this, because the canvas is owed only AFTER every board has PASSED the judge: doctrine
 * publishes at that point, so a build with a board still to judge, or with one the judge has
 * just refused, owes a drawing and does NOT yet owe a canvas. Reported together the two checks
 * contradicted each other, telling one build to publish the canvas and to redraw the board it
 * would have published.
 *
 * A BUILD WITH NO DONOR ROW IS OUTSIDE THE JUDGE ENTIRELY. `--no-donors` writes
 * `explore.donor_row = { skipped: true }` and leaves no donor hero for a board to be compared
 * with, so no board on that build can ever be judged. Reading it as "unjudged" would suppress
 * the canvas check forever on exactly the builds that still owe a canvas, which is the same
 * silence check 7 exists to refuse.
 */
const donorRowSkipped = manifest?.explore?.donor_row?.skipped === true;
const judgeApplies = process.env.PALATE_GATE_JUDGE !== "0" && !donorRowSkipped;
const judgedById = new Map(
  (Array.isArray(manifest?.explore?.board_judgements) ? manifest.explore.board_judgements : []).map((j) => [j?.id, j]),
);
// Owed = never judged, OR judged and refused. A board that does not read comparable or better
// is judged and is not shippable, so a canvas is no more owed on it than on a board nobody has
// looked at.
const boardsOwingJudgement =
  !judgeApplies || !manifest?.explore?.shown_at
    ? []
    : parsed.filter((v) => (judgedById.get(v.id)?.rung ?? null) !== null ? refusedRung(judgedById.get(v.id).rung) : true).map((v) => v.id);
const unjudgedBoards = !judgeApplies || !manifest?.explore?.shown_at ? [] : parsed.filter((v) => !judgedById.has(v.id)).map((v) => v.id);

// ------------------------------------------------ 7. shown boards were put somewhere
// The canvas is where the person iterates. Publishing it is not optional when the design skill
// is present, and when it is absent that is RECORDED with a reason, never left silent.
{
  const ex = manifest?.explore || {};
  if (ex.shown_at && !boardsOwingJudgement.length) {
    const c = ex.canvas || {};
    const ok = (typeof c.url === "string" && c.url.trim()) || (c.skipped === true && typeof c.reason === "string" && c.reason.trim());
    if (!ok) {
      add(
        "The boards were shown but the canvas was neither published nor declined",
        `explore.shown_at is ${ex.shown_at} and manifest.explore.canvas records nothing. Publish the canvas with the design skill and record explore.canvas = { url }, or record explore.canvas = { skipped: true, reason } when no design skill can run in this session.` +
          (donorRowSkipped
            ? " This build recorded explore.donor_row = { skipped: true }, so there is no donor hero for a board to be judged against and the board judge does not apply here: the canvas is owed as soon as the boards are shown."
            : ""),
      );
    }
  }
}

// --------------------------------------------- 8. every shown board was judged against its donor
// The board judge (scripts/gate-board-judge.mjs) compares each board with the library reference
// it was drawn from, both orders, at every intensity, and the bar is comparable or better on
// every surface it was judged on. This is the half that makes it bind: once the boards are in
// front of a client, a board with no judgement, and a board that read worse than its own donor,
// are both things a person finds out by looking rather than by being told. PALATE_GATE_JUDGE=0
// releases the whole check, the same variable the judge itself reads.
if (judgeApplies) {
  const ex = manifest?.explore || {};
  if (ex.shown_at) {
    const judged = judgedById;
    if (unjudgedBoards.length) {
      add(
        `${unjudgedBoards.length} shown board(s) were never compared with their donor`,
        `${unjudgedBoards.join(", ")} have no entry in manifest.explore.board_judgements. Every board is judged against the library reference it was drawn from, both ways round, before a client sees it: run node scripts/gate-board-judge.mjs <projectDir>, the main build agent dispatches each comparison to a fresh subagent, then run it again with --judgements <file>. The canvas is owed only once EVERY board has passed the judge, which is why nothing here asks for a canvas record yet.`,
      );
    }
    for (const v of parsed) {
      const j = judged.get(v.id);
      if (j && refusedRung(j.rung)) {
        // NAMING THE SURFACES IT WAS READ WORSE ON, where the record carries them. An older
        // record holds only the direction's own rung, so the surfaces are said when known and
        // the finding still stands when they are not.
        const worseOn = Object.entries(j.rungs && typeof j.rungs === "object" ? j.rungs : {})
          .filter(([, r]) => refusedRung(r))
          .map(([sf]) => SURFACES[sf]?.label ?? sf);
        add(
          `${v.id} was judged ${WORSE_PHRASE[j.rung]} than its donor`,
          `the board judge read ${v.id}${j.donor ? ` against ${j.donor}` : ""} as ${WORSE_PHRASE[j.rung]} than its donor` +
            (worseOn.length ? ` at the ${worseOn.join(", the ")}` : "") +
            `. A board is shown only when it reads comparable or better on every surface it is judged on. Redraw it from the donor's hero, re-render the boards and run scripts/gate-board-judge.mjs again before the canvas is published.`,
        );
      }
    }
  }
}

// ------------------------------------ 9. every piece names its variation and its donor
/**
 * THE KIT MANIFEST, which every registered variation is checked against.
 *
 * The project's own copy first, because a build may legitimately have added a piece, and the
 * plugin's template as the fallback for a registry written before the site was scaffolded.
 * Neither parsing is a FINDING rather than a silence: checking a variation against an empty
 * manifest accepts every variation, which is the same as not checking at all.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
function loadKit() {
  for (const p of [join(dir, "src/lib/kit.ts"), join(HERE, "..", "templates", "astro-project", "src", "lib", "kit.ts")]) {
    if (!existsSync(p)) continue;
    try {
      const kit = parseKitVariations(readFileSync(p, "utf8"));
      if (kit.size) return kit;
    } catch { /* try the next one */ }
  }
  return new Map();
}
const kit = loadKit();

/**
 * The pieces every direction owes, whatever it chose.
 *
 * These six plus the direction's own inner section are what a client is actually signing off:
 * how they are greeted, why they should believe it, how they are asked, how they enquire, and
 * what the page says at the bottom. `trust` is on the list because the trust strip is a required
 * block on the detail sheet, and a sheet block with no registered provenance is a block whose
 * copy nobody can trace. A direction that records none of them is one whose navigation, form and footer are
 * decided later, by nobody, and discovered by the client on the built site.
 */
const REQUIRED_PIECES = ["navigation", "hero", "trust", "cta", "forms", "footer"];
// A donor is only checkable against a survey that exists. A build with no `references_surveyed`
// says nothing here rather than blocking every direction over a manifest nobody wrote.
const surveyed = new Set(
  (Array.isArray(manifest?.references_surveyed) ? manifest.references_surveyed : [])
    .map((r) => (typeof r === "string" ? r : r?.slug)).filter(Boolean),
);
if (!kit.size) {
  add(
    "The website kit manifest could not be read",
    `neither ${join(dir, "src/lib/kit.ts")} nor the plugin's template parsed, so every variation these directions register is UNCHECKED rather than clean: a navigation the kit cannot build would pass here and fail at Compose.`,
  );
}
for (const v of parsed) {
  const want = [...REQUIRED_PIECES, ...(v.section && !REQUIRED_PIECES.includes(v.section) ? [v.section] : [])];
  if (!v.pieces) {
    add(
      `${v.id} records where none of its pieces came from`,
      `add pieces: { ${want.map((p) => `${p}: { variation, donor }`).join(", ")} }. A direction is signed off piece by piece, so each one names the kit variation it is (src/lib/kit.ts) and the reference its craft came from. Without it the detail sheet cannot print its provenance and nobody can say afterwards which reference the navigation came from.`,
    );
    continue;
  }
  const missing = want.filter((p) => !v.pieces[p] || !v.pieces[p].variation || !v.pieces[p].donor);
  if (missing.length) {
    add(
      `${v.id} names no variation or donor for ${missing.join(", ")}`,
      `every one of ${want.join(", ")} needs both: the kit variation it is, and the reference it was drawn from. A piece with one and not the other is half a record, and the half that goes missing is always the donor.`,
    );
  }
  for (const [piece, prov] of Object.entries(v.pieces)) {
    if (!prov?.variation) continue;
    if (kit.size) {
      if (kit.has(piece)) {
        if (!kit.get(piece).has(prov.variation)) {
          // WHERE IT ACTUALLY BELONGS, when it belongs anywhere. A real variation filed under
          // the wrong piece passes a spell check and builds nothing, and "it is not one of
          // navigation's" is a much slower answer than "FooterSimple belongs to footer".
          const home = [...kit].find(([, vars]) => vars.has(prov.variation))?.[0];
          add(
            `${v.id}'s ${piece} names the variation ${prov.variation}`,
            home
              ? `${prov.variation} belongs to ${home} in src/lib/kit.ts, not to ${piece}. The sheet the client signs off would show a ${piece} the build has no way to compose.`
              : `src/lib/kit.ts has no such variation. ${piece} carries ${[...kit.get(piece).keys()].join(", ") || "none"}. A variation nobody can build is a promise made on the build's behalf.`,
          );
        }
      } else if (![...kit.values()].some((vars) => vars.has(prov.variation))) {
        // A BESPOKE SECTION NAME. The registry's `section` is free text ("menu", "proof"), so
        // its key cannot be held to one piece's list; it is still held to the kit as a whole,
        // because a variation that belongs to no piece at all belongs to nothing.
        add(
          `${v.id}'s ${piece} names the variation ${prov.variation}`,
          `"${piece}" is the direction's own section name rather than a kit piece, so ANY variation in src/lib/kit.ts is acceptable here and ${prov.variation} is none of them. The kit carries ${[...kit].map(([p, vars]) => `${p}: ${[...vars.keys()].join(", ")}`).join("; ")}. Name the one this section is built from, so the sheet and Compose describe the same thing.`,
        );
      }
    }
    if (surveyed.size && prov.donor && !surveyed.has(prov.donor)) {
      add(
        `${v.id}'s ${piece} is drawn from ${prov.donor}, which nobody surveyed`,
        `${prov.donor} is not in build-manifest.json's references_surveyed, so its craft was never read. Provenance naming an unread reference is provenance invented after the fact: read it (refs_get) or name the reference the piece was genuinely drawn from.`,
      );
    }
  }
}

// -------------------------------------------- 10. the detail sheet and the registry agree
/**
 * The sheet is what the client signs; the registry is what Compose builds from. A direction
 * whose sheet shows FooterGrouped and whose registry records FooterSimple ships a footer nobody
 * approved, and neither artefact is wrong on its own, which is why only comparing them finds it.
 *
 * CONTAINMENT, not equality: a real sheet carries the navigation twice, the bar at rest and the
 * drawer on a phone, and those are two different kit variations. What has to hold is that the
 * variation the registry records is one the sheet actually shows.
 *
 * A sheet that has not been drawn yet is not a disagreement. boards-render owns the missing
 * file, and inventing a finding here would report one absence twice in two different words.
 */
const SHEET_CHECKED = ["navigation", "footer", "cta", "forms"];
for (const v of parsed) {
  if (!v.pieces || !v.sheet) continue;
  const p = join(dir, ".palate/explore/seed", v.sheet);
  if (!existsSync(p)) continue;
  let html = "";
  try { html = readFileSync(p, "utf8"); } catch { continue; }
  const shown = new Map();
  for (const m of html.matchAll(/\bdata-kit-piece="([^"]*)"/g)) {
    const [piece, variation] = m[1].split(":").map((x) => x.trim());
    if (!piece || !variation) continue;
    if (!shown.has(piece)) shown.set(piece, new Set());
    shown.get(piece).add(variation);
  }
  for (const piece of SHEET_CHECKED) {
    const prov = v.pieces[piece];
    if (!prov?.variation || !shown.has(piece)) continue;
    if (!shown.get(piece).has(prov.variation)) {
      add(
        `${v.id}'s sheet and its registry disagree about the ${piece}`,
        `src/lib/variants.ts records ${prov.variation} and ${v.sheet} shows ${[...shown.get(piece)].join(", ")}. The sheet is what the client signs off and the registry is what Compose builds from, so one of them ships a ${piece} nobody approved. Redraw the block or correct the registry.`,
      );
    }
  }
}

/**
 * A SURFACE THAT WENT UNJUDGED IS SAID OUT LOUD, and it is a WARNING rather than a finding.
 *
 * The judge reads three surfaces per direction and the page ending is dropped when the library
 * holds no whole-page capture for that reference (`rungs.foot: null`). That is a fact about the
 * library, not the operator's doing, so refusing over it would switch the instrument off on the
 * builds it is meant to serve. But nothing downstream reads `rungs`, so without this line
 * "lowest across three surfaces" quietly becomes "lowest across the two we managed" and the
 * record is indistinguishable from one that was judged whole.
 *
 * A record with NO `rungs` at all predates the surfaces and claims nothing, so it is not warned
 * about: crying wolf on every older build is how a warning gets ignored.
 */
const SURFACE_NAMES = { entrance: "entrance", foot: "page ending", inner: "inner page" };
const warnings = [];
if (judgeApplies && manifest?.explore?.shown_at) {
  for (const v of parsed) {
    const rungs = judgedById.get(v.id)?.rungs;
    if (!rungs || typeof rungs !== "object") continue;
    const dropped = Object.keys(SURFACE_NAMES).filter((k) => k in rungs && rungs[k] === null);
    if (!dropped.length) continue;
    warnings.push(
      `${v.id} (${judgedById.get(v.id)?.donor ?? v.donor}) was judged on ${dropped.length === 1 ? "two surfaces" : "fewer than three surfaces"}: ` +
        `no ${dropped.map((k) => SURFACE_NAMES[k]).join(", no ")}. The library holds no whole-page capture for that reference, so ` +
        `${v.id}'s rung is the lowest of the surfaces that WERE judged, not of all three.`,
    );
  }
}
for (const w of warnings) console.error(`Explore gate warning: ${w}`);

if (!findings.length) {
  console.log(`Explore gate passed: ${entries.length} board(s), each with a rung, a description, an argument, a feeling, a distinct donor, a motion plan and its CTA options, and a page that explains the range.`);
  process.exit(0);
}

console.error("Explore gate FAILED: the range will not read as a range.\n");
for (const f of findings) console.error(`  - ${f.what}: ${f.why}`);
console.error(
  "\nThis is what the client sees first. Fix the entries in src/lib/variants.ts (and ship src/pages/explore.astro) before showing the preview. See references/explore-stage.md.",
);
process.exit(2);
