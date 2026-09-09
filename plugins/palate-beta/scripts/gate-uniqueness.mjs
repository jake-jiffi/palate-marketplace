#!/usr/bin/env node
/**
 * scripts/gate-uniqueness.mjs - the portable uniqueness gate (S2).
 *
 * Given the rendered Explore variants (their HTML files), it fails closed if any two
 * variants are near-duplicates: ritually-varied output that is structurally and
 * stylistically the same is the slop this catches. Dependency-light by design (pure
 * node, no sharp) so it runs anywhere the depth gate does; a perceptual-hash pass on
 * the screenshots is a documented optional enhancement (see the comment at the foot).
 *
 * Two signals, both computed from the HTML, no image decode needed:
 *   - STRUCTURAL: the normalised tag+class skeleton (the section/layout shape).
 *   - STYLE/TOKEN: the palette hexes, font families, and the radius/easing vocabulary.
 * A pair is a near-duplicate only when BOTH are too close (same shape AND same skin).
 *
 * Usage: node scripts/gate-uniqueness.mjs <variant1.html> <variant2.html> [more...]
 *        node scripts/gate-uniqueness.mjs --project <dir>
 *
 * `--project` finds the renders itself, in BOTH places they live: the per-board directories
 * under `.palate/explore/shots` and the per-variant ones under `.palate-shots` (the older
 * whole-page shape, and any site still on it). Knowing where a render lives belongs in the gate
 * rather than in a glob in gate-done.sh, which is how the board renders would otherwise have
 * been invisible to it: the shell would have gone on comparing an empty set and reporting
 * "fewer than 2 to compare" on a build with five boards on disk.
 * Exit 0 = pass (genuinely distinct), 2 = block (a near-duplicate pair), with the pair
 * named on stderr. Thresholds via env: PALATE_UNIQ_STRUCT (default 0.82),
 * PALATE_UNIQ_STYLE (default 0.72) - a pair fails only if it exceeds BOTH.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const STRUCT_MAX = Number(process.env.PALATE_UNIQ_STRUCT ?? 0.82);
const STYLE_MAX = Number(process.env.PALATE_UNIQ_STYLE ?? 0.72);

/** Every rendered board or variant under a project, boards first (they are the current shape). */
function discover(dir) {
  const out = [];
  for (const [root, re] of [[join(dir, ".palate/explore/shots"), /^b\d+$/], [join(dir, ".palate-shots"), /^v\d+$/]]) {
    let names = [];
    try { names = readdirSync(root); } catch { continue; }
    for (const n of names.sort()) {
      if (!re.test(n)) continue;
      const f = join(root, n, "rendered.html");
      if (existsSync(f)) out.push(f);
    }
  }
  return out;
}

const argv = process.argv.slice(2);
let files = argv;
const pi = argv.indexOf("--project");
if (pi >= 0) {
  const dir = argv[pi + 1];
  if (!dir) {
    console.error("uniqueness gate: --project needs a directory.");
    process.exit(2);
  }
  files = discover(dir);
  if (files.length < 2) {
    console.error(`uniqueness gate: skipped (fewer than 2 rendered boards or variants under ${dir}: found ${files.length}). NOT a pass.`);
    process.exit(2);
  }
}
if (files.length < 2) {
  console.error("uniqueness gate: pass 2+ rendered variant HTML files. (A single variant cannot be checked for variety.)");
  process.exit(2);
}

// A brand-PROVIDED build locks the palette / type / radius, so the style axis is ~1.0
// by construction and the gate would collapse to structure-only, flagging coherent
// variants that SHOULD share one mandated design system as duplicates (the retro's
// real false positive: structure 0.91 read as a dup). In that mode raise the structural
// bar so only a near-identical SHAPE is a true duplicate when the skin cannot differ by
// design. An explicit env threshold always wins.
function brandProvided(fromFile) {
  let dir = dirname(fromFile);
  for (let i = 0; i < 5; i++) {
    const p = join(dir, ".palate-skill-state.json");
    try { if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).brandMode === "brand-provided"; } catch { /* ignore */ }
    const up = dirname(dir); if (up === dir) break; dir = up;
  }
  return false;
}
const BRAND_PROVIDED = brandProvided(files[0]);
const STRUCT_EFF = process.env.PALATE_UNIQ_STRUCT != null ? STRUCT_MAX : (BRAND_PROVIDED ? 0.92 : STRUCT_MAX);

// STRUCTURAL signature: the sequence of block tags + their first class token, lower-
// cased. Captures the layout/section shape while ignoring copy and exact values.
function structSig(html) {
  const sig = [];
  // TWO STEPS, NEVER ONE REGEX. The previous pattern put a lazy [^>]*? before an OPTIONAL
  // class capture: the lazy part matched empty, the optional group matched empty, and the
  // trailing [^>]* swallowed the real class attribute, so the capture NEVER fired. Every
  // element signed as `tag.` with no class, all variants collapsed to the same tag sequence,
  // and two genuinely different pages scored structure 1.00. TWO separate real builds hit the
  // false block and had to adjudicate around this gate before the cause was fixed here. On a
  // brand-provided build the style half is legitimately ~1.0 (same palette and faces by
  // design), so the structural half is the only discriminator, and it was blind.
  const re = /<(section|header|main|footer|article|aside|nav|div|h1|h2|h3|ul|ol|figure)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cm = /class\s*=\s*"([^"]*)"/i.exec(m[2] || "");
    const cls = ((cm && cm[1]) || "").trim().split(/\s+/)[0] || "";
    sig.push(`${m[1].toLowerCase()}.${cls.toLowerCase()}`);
  }
  return sig;
}

// STYLE signature: the set of palette hexes + font families + radius/easing values.
function styleSig(html) {
  const s = new Set();
  for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b/g)) s.add(m[0].toLowerCase());
  for (const m of html.matchAll(/font-family:\s*([^;"}]+)/gi)) s.add("ff:" + m[1].toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40));
  for (const m of html.matchAll(/family=([A-Za-z0-9+]+)/g)) s.add("gf:" + m[1].toLowerCase()); // Google Fonts links
  for (const m of html.matchAll(/cubic-bezier\([^)]+\)/gi)) s.add(m[0].toLowerCase().replace(/\s/g, ""));
  for (const m of html.matchAll(/border-radius:\s*([^;"}]+)/gi)) s.add("br:" + m[1].trim());
  return s;
}

// Jaccard similarity on multisets-as-sets (0..1).
function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * The archived stylesheet is not a style SIGNATURE.
 *
 * boards-render inlines the build's whole stylesheet into each archived render so the render
 * still means something after the next build renames its assets. That stylesheet is one shared
 * Tailwind output, byte-identical on every board, so signing it puts the style axis at 1.00 for
 * every pair and collapses this gate to structure-only, silently. It is stripped before signing:
 * what discriminates two boards is the styling they actually reach for, which is in the markup.
 */
const ARCHIVED_CSS = /<style\b[^>]*data-palate-archived-css[^>]*>[\s\S]*?<\/style>/gi;

const variants = files.map((f) => {
  const html = readFileSync(f, "utf8").replace(ARCHIVED_CSS, "");
  return { f, struct: new Set(structSig(html)), style: styleSig(html) };
});

let worst = null;
const rows = [];
for (let i = 0; i < variants.length; i++) {
  for (let j = i + 1; j < variants.length; j++) {
    const st = jaccard(variants[i].struct, variants[j].struct);
    const sy = jaccard(variants[i].style, variants[j].style);
    rows.push({ a: variants[i].f, b: variants[j].f, st, sy });
    const dup = st > STRUCT_EFF && sy > STYLE_MAX;
    if (dup && (!worst || st + sy > worst.st + worst.sy)) worst = { a: variants[i].f, b: variants[j].f, st, sy };
  }
}

for (const r of rows) {
  console.error(`  ${base(r.a)} <-> ${base(r.b)}: structure ${r.st.toFixed(2)}, style ${r.sy.toFixed(2)}`);
}
if (worst) {
  console.error(`\nuniqueness gate FAILED: ${base(worst.a)} and ${base(worst.b)} are near-duplicates (structure ${worst.st.toFixed(2)} > ${STRUCT_EFF}${BRAND_PROVIDED ? " [brand-provided: style axis is locked, so the structural bar is raised]" : ""} AND style ${worst.sy.toFixed(2)} > ${STYLE_MAX}). They share the same section shape and the same palette/type skin - that is ritual variation, not range. Lead them from DIFFERENT references (vary the backbone), reproduce a different signature move${BRAND_PROVIDED ? "" : ", and re-skin from a different donor's tokens"}.`);
  process.exit(2);
}
console.log(`uniqueness gate passed: ${variants.length} variants, no near-duplicate pair (every pair differs in structure or skin).`);
process.exit(0);

/**
 * A name a person can act on.
 *
 * Every board's render is called `rendered.html`, so the last path segment alone produced
 * "rendered.html and rendered.html are near-duplicates", which names neither board. The
 * directory above it is the board id, and that is the part worth printing.
 */
function base(p) {
  const parts = p.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || p;
  const parent = parts[parts.length - 2];
  return parent && /^(b|v|lp)\d+$/i.test(parent) ? `${parent}/${last}` : last;
}

// OPTIONAL perceptual-hash enhancement: where sharp is available (e.g. CI with the
// build's node_modules), a DCT pHash over each variant's full-page screenshot adds a
// pixel-level distance (Hamming over 64-bit hashes; reject < ~10). It is intentionally
// NOT required here so the gate stays portable; wire it in the verifier where sharp is
// present. The capstone validated pHash Hamming distances of 30..42 across 3 variants.
