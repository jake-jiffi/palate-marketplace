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
 * So this gate holds three things that are easy to skip and impossible to notice missing:
 *
 *   1. THE COACHING PAGE EXISTS. `src/pages/explore.astro` is what says what happened, draws
 *      the ladder, and tells the client what to do next (react, mix across rungs, ask for
 *      changes, and only then build the whole site). A set of variant routes with no such page
 *      is a pile of links.
 *   2. EVERY VARIANT ARGUES FOR ITSELF. `what`, `why` and `feeling` on each entry are the
 *      difference between "I like that one" and "somewhere around 5, with 8's motion". They
 *      are also a check on the BUILD: a rung whose `why` restates its `what`, or whose feeling
 *      is "modern and clean", did not have an idea, and that is worth catching before a client
 *      reads it rather than after.
 *   3. THE LADDER IS REAL. Every rung carries a distinct `ambition`, and they run 1..N with no
 *      gaps, because a set that is all rung 1 or has three rung 4s is a bag wearing a ladder's
 *      labels.
 *
 * ============================ FAIL-OPEN, ALWAYS ============================
 *
 * It only has an opinion once variants are REGISTERED. No variants.ts, no variants, or a build
 * that is not doing Explore all skip (exit 0). It has nothing to say about a non-Explore build,
 * a single-page edit, or a user who never ran Explore at all.
 *
 * Exit 0 = pass or skip, 2 = block with the specific entries named.
 * Usage: node scripts/gate-explore.mjs [projectDir]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || ".";
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

function field(obj, key) {
  const s = new RegExp(`\\b${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`, "s").exec(obj);
  if (s) return s[2].replace(/\\(['"`])/g, "$1").trim();
  const num = new RegExp(`\\b${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(obj);
  return num ? Number(num[1]) : null;
}

const findings = [];
const add = (what, why) => findings.push({ what, why });

const src = read("src/lib/variants.ts");
if (!src) process.exit(0); // not an Explore build, or not this scaffold: nothing to say

const clean = stripComments(src);
const body = arrayBody(clean, "variants");
const entries = body ? objects(body) : [];
if (!entries.length) process.exit(0); // Explore has not registered anything yet

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
const parsed = [];

for (const o of entries) {
  const id = field(o, "id") || "(unnamed)";
  const name = field(o, "name");
  const ambition = field(o, "ambition");
  const what = field(o, "what");
  const why = field(o, "why");
  const feeling = field(o, "feeling");
  parsed.push({ id, ambition });

  const missing = [];
  if (typeof ambition !== "number") missing.push("ambition");
  if (!what) missing.push("what");
  if (!why) missing.push("why");
  if (!feeling) missing.push("feeling");
  if (missing.length) {
    add(
      `${id} does not argue for itself`,
      `missing ${missing.join(", ")}. Every rung needs its own position on the ladder, what it is, why it is doing that for THIS business, and the feeling it carries. Without them the client can only judge on taste.`,
    );
    continue;
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
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) || []);
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

if (!findings.length) {
  console.log(`Explore gate passed: ${entries.length} variant(s), each with a rung, a description, an argument and a feeling, and a page that explains the range.`);
  process.exit(0);
}

console.error("Explore gate FAILED: the range will not read as a range.\n");
for (const f of findings) console.error(`  - ${f.what}: ${f.why}`);
console.error(
  "\nThis is what the client sees first. Fix the entries in src/lib/variants.ts (and ship src/pages/explore.astro) before showing the preview. See references/explore-stage.md.",
);
process.exit(2);
