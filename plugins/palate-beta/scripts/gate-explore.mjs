#!/usr/bin/env node
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
import { join } from "node:path";
import { pluginRootRefusal } from "../hooks/project-dir.mjs";

const dir = process.argv[2] || ".";

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

for (const o of entries) {
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
  parsed.push({ id, ambition });

  const missing = [];
  if (typeof ambition !== "number") missing.push("ambition");
  if (!what) missing.push("what");
  if (!why) missing.push("why");
  if (!feeling) missing.push("feeling");
  if (!donor) missing.push("donor");
  if (!section) missing.push("section");
  if (!motion) missing.push("motion");
  if (!ctas) missing.push("ctas");
  if (missing.length) {
    add(
      `${id} does not argue for itself`,
      `missing ${missing.join(", ")}. Every rung needs its own position on the ladder, what it is, why it is doing that for THIS business, the feeling it carries, the reference its craft came from, the section it shows, what MOVES on it, and the CTA labels the client can choose between. Without them the client can only judge on taste, and a board is mostly a still, so unwritten motion is unseen motion.`,
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

// ------------------------------------------------ 7. shown boards were put somewhere
// The canvas is where the person iterates. Publishing it is not optional when the design skill
// is present, and when it is absent that is RECORDED with a reason, never left silent.
{
  const ex = manifest?.explore || {};
  if (ex.shown_at) {
    const c = ex.canvas || {};
    const ok = (typeof c.url === "string" && c.url.trim()) || (c.skipped === true && typeof c.reason === "string" && c.reason.trim());
    if (!ok) {
      add(
        "The boards were shown but the canvas was neither published nor declined",
        `explore.shown_at is ${ex.shown_at} and manifest.explore.canvas records nothing. Publish the canvas with the design skill and record explore.canvas = { url }, or record explore.canvas = { skipped: true, reason } when no design skill can run in this session.`,
      );
    }
  }
}

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
