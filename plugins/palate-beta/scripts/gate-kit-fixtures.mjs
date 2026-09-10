#!/usr/bin/env node
/**
 * gate-kit-fixtures.mjs - every word a state fixture supplies has to reach the page.
 *
 * A fixture is a plain object handed to a component, so TypeScript cannot check its keys: the map
 * is typed Record<string, unknown> because forty five components have forty five prop shapes. A
 * fixture with the wrong key name therefore renders NOTHING, silently, and the state page shows a
 * piece that looks broken. That is not hypothetical: BenefitShowcase takes points as
 * { label, detail } and the first long fixture wrote { title, body }, so three points rendered
 * empty and it read as a component fault.
 *
 * The check is the only one that can catch it, and it is nearly free: read the BUILT html for
 * each content state and assert every long string the fixture supplies is present. No browser, no
 * heuristics, and it fails with the exact sentence that went missing.
 *
 * Runs against a built site. Silent on a build with no kit.
 *
 * Exit: 0 clean, 1 findings, 2 could not run (never a pass).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const dir = process.argv[2] || ".";
const base = existsSync(join(dir, "templates/astro-project/src"))
  ? join(dir, "templates/astro-project/src")
  : join(dir, "src");
const statesFile = join(base, "lib/kit-states.ts");
const kitFile = join(base, "lib/kit.ts");

if (!existsSync(statesFile) || !existsSync(kitFile)) {
  console.log("gate-kit-fixtures: skipped (this build ships no kit).");
  process.exit(0);
}

// The built output, wherever this project puts it.
const dist = ["dist/client", "dist", ".vercel/output/static"]
  .map((d) => join(dir, d))
  .find((d) => existsSync(join(d, "kit-frame")));
if (!dist) {
  console.log("gate-kit-fixtures: skipped (no built kit-frame pages; build the site first).");
  process.exit(0);
}

const src = readFileSync(statesFile, "utf8");

/** The fixture maps, read as source: this runs with no build step and no TypeScript loader. */
function mapOf(name) {
  const m = new RegExp(`export const ${name}[^{]*\\{([\\s\\S]*?)\\n\\};`).exec(src);
  if (!m) {
    console.error(`gate-kit-fixtures: could not run: ${relative(dir, statesFile)} has no parsable ${name}. A gate never exits 0 having inspected nothing.`);
    process.exit(2);
  }
  const out = {};
  /**
   * BOTH SHAPES. The first version matched only a MULTI-LINE entry, and every empty fixture is
   * written on one line, so EMPTY_PROPS parsed to nothing and the whole empty-state check ran over
   * zero fixtures while reporting itself clean. Exists-but-never-fires, caught by reading the
   * count in the pass message rather than by the check failing.
   */
  const multi = /^ {2}([A-Za-z]+): \{([\s\S]*?)\n {2}\},$/gm;
  const single = /^ {2}([A-Za-z]+): \{([^\n]*)\},$/gm;
  let e;
  while ((e = multi.exec(m[1]))) out[e[1]] = e[2];
  while ((e = single.exec(m[1]))) if (!(e[1] in out)) out[e[1]] = e[2];
  if (!Object.keys(out).length) {
    console.error(`gate-kit-fixtures: could not run: ${name} parsed to zero fixtures, so nothing was checked. A gate never exits 0 having inspected nothing.`);
    process.exit(2);
  }
  return out;
}

const LONG = mapOf("LONG_PROPS");
const EMPTY = mapOf("EMPTY_PROPS");
if (!Object.keys(LONG).length) {
  console.error("gate-kit-fixtures: could not run: LONG_PROPS parsed to zero fixtures.");
  process.exit(2);
}

/** Which piece a variation belongs to, so its page can be found. */
const pieceOf = {};
for (const block of readFileSync(kitFile, "utf8").split(/^ {4}id: "/m).slice(1)) {
  const piece = block.slice(0, block.indexOf('"'));
  for (const v of block.matchAll(/\{ id: "([A-Za-z]+)"/g)) pieceOf[v[1]] = piece;
}

const findings = [];
let checked = 0;

for (const [variation, body] of Object.entries(LONG)) {
  const piece = pieceOf[variation];
  if (!piece) {
    findings.push(`LONG_PROPS carries a fixture for ${variation}, which no piece in the manifest declares`);
    continue;
  }
  const file = join(dist, "kit-frame", piece, variation, "long", "index.html");
  if (!existsSync(file)) {
    findings.push(`${variation} has a long fixture and ${relative(dir, file)} was not built, so nothing renders it`);
    continue;
  }
  const raw = readFileSync(file, "utf8");
  // Attribute values count as content: alt text is written in the fixture and stripping tags
  // would lose it, so the raw markup is searched as well as the visible text.
  const decoded = raw.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  const visible = decoded
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const haystack = `${visible} ${decoded}`;

  /**
   * Single-line string literals of forty characters or more. Single-line matters: a naive match
   * runs from one string's closing quote to the next one's opening quote and "finds" source code.
   * Anything holding a bracket is source rather than prose and is dropped for the same reason.
   */
  const strings = [...body.matchAll(/"([^"\\\n]{40,})"/g)]
    .map((s) => s[1])
    .filter((s) => !/[{}[\]]|: \[|=> /.test(s));

  for (const s of strings) {
    checked += 1;
    if (!haystack.includes(s.slice(0, 60))) {
      findings.push(`${variation}'s long fixture supplies "${s.slice(0, 60)}..." and it never reaches the page, so the fixture is using a key the component does not take`);
    }
  }
}

/**
 * A LONG FIXTURE HAS TO ACTUALLY BE LONG, AND SOME WERE SHORTER THAN THE RESTING PAGE.
 *
 * The state note promises "roughly two to three times the usual length". Six fixtures fell well
 * short of it, three left the longest single field the same or shorter, and one cut a six-item
 * list to three, so the piece was put under LESS strain by the state whose whole job is strain.
 * The tab highlighted, the note made its claim, and nothing had been stressed.
 *
 * Measured against the piece's OWN resting render rather than against a word count, because what
 * matters is the piece being pushed past what it normally carries. Three ratios, because a fixture
 * can fail in three different ways: total volume, the longest single field (which is what wraps
 * and truncates), and the number of items (many items AND long text together is the case a grid
 * or an accordion actually breaks on).
 */
const MIN_TOTAL = 1.8;
const MIN_FIELD = 1.5;

/** Visible text per element, so a collapsed <details> answer still counts. */
function textStats(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    // The frame's own hidden heading is chrome, not the piece. Counting it added the same run of
    // characters to both sides of every ratio, which pulls the ratio toward 1 and failed two
    // fixtures that had not changed: a measurement polluted by the thing doing the measuring.
    .replace(/<h1[^>]*data-kit-frame-heading[^>]*>[\s\S]*?<\/h1>/g, " ");
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(body)?.[1] ?? body;
  const fields = [...main.matchAll(/>([^<>]{12,})</g)]
    .map((m) => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return {
    total: fields.reduce((n, f) => n + f.length, 0),
    longest: fields.reduce((n, f) => Math.max(n, f.length), 0),
    items: (main.match(/<li\b/g) || []).length + (main.match(/<article\b/g) || []).length,
  };
}

let sized = 0;
for (const variation of Object.keys(LONG)) {
  const piece = pieceOf[variation];
  if (!piece) continue;
  const longFile = join(dist, "kit-frame", piece, variation, "long", "index.html");
  const restFile = join(dist, "kit-frame", piece, variation, "rest", "index.html");
  if (!existsSync(longFile) || !existsSync(restFile)) continue;
  const long = textStats(readFileSync(longFile, "utf8"));
  const rest = textStats(readFileSync(restFile, "utf8"));
  sized += 1;
  if (rest.total > 0 && long.total < rest.total * MIN_TOTAL) {
    findings.push(`${variation}'s long fixture carries ${(long.total / rest.total).toFixed(2)}x the resting text, under the ${MIN_TOTAL}x the state promises, so the piece is not put under long content at all`);
  }
  if (rest.longest > 0 && long.longest < rest.longest * MIN_FIELD) {
    findings.push(`${variation}'s longest single field is ${(long.longest / rest.longest).toFixed(2)}x the resting longest, under ${MIN_FIELD}x; the longest field is what wraps and truncates, so a long state that does not lengthen one proves nothing`);
  }
  if (long.items < rest.items) {
    findings.push(`${variation}'s long fixture renders ${long.items} item(s) against ${rest.items} at rest, so the state removes strain rather than adding it; many items AND long text is the case a grid or an accordion breaks on`);
  }
}

/**
 * AN EMPTY FIXTURE HAS TO REACH THE EMPTY BRANCH, and one did not.
 *
 * FormBooking's empty state set two props and left a third, so the message the component wrote for
 * exactly that condition could never render, and one of the props it did set is read by the piece
 * as "every day is bookable": the state labelled empty offered a diary open seven days a week and
 * accepted a Sunday. That is the long-fixture fault in the other direction, a state that removes
 * strain rather than showing the absence it names, and the ratio checks above only ever looked at
 * LONG_PROPS so nothing could catch it.
 *
 * The test is what a reader would see: fewer items than at rest, and the piece's own empty message
 * actually on the page.
 */
for (const variation of Object.keys(EMPTY)) {
  const piece = pieceOf[variation];
  if (!piece) {
    findings.push(`EMPTY_PROPS carries a fixture for ${variation}, which no piece in the manifest declares`);
    continue;
  }
  const emptyFile = join(dist, "kit-frame", piece, variation, "empty", "index.html");
  const restFile = join(dist, "kit-frame", piece, variation, "rest", "index.html");
  if (!existsSync(emptyFile) || !existsSync(restFile)) continue;
  const emptyHtml = readFileSync(emptyFile, "utf8");
  const empty = textStats(emptyHtml);
  const rest = textStats(readFileSync(restFile, "utf8"));
  sized += 1;
  if (empty.items >= rest.items && rest.items > 0) {
    findings.push(`${variation}'s empty fixture renders ${empty.items} item(s) against ${rest.items} at rest, so it is not showing the absence it names`);
  }
  if (!/kit-empty/.test(emptyHtml)) {
    findings.push(`${variation}'s empty state never renders .kit-empty, so the message the component wrote for this condition is unreachable and the page shows a working piece instead`);
  }
}

if (findings.length) {
  console.error(`gate-kit-fixtures: ${findings.length} finding(s) over ${checked} fixture string(s) and ${sized} sized fixture(s).`);
  for (const f of findings.slice(0, 20)) console.error(`  - ${f}`);
  if (findings.length > 20) console.error(`  ... and ${findings.length - 20} more`);
  process.exit(1);
}

console.log(`gate-kit-fixtures: clean (${checked} fixture strings reach the page; ${sized} sized renders, every long state at least ${MIN_TOTAL}x the resting text and ${MIN_FIELD}x its longest field, every empty state showing its own empty message).`);
process.exit(0);
