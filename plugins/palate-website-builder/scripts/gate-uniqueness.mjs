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
 * Exit 0 = pass (genuinely distinct), 2 = block (a near-duplicate pair), with the pair
 * named on stderr. Thresholds via env: PALATE_UNIQ_STRUCT (default 0.82),
 * PALATE_UNIQ_STYLE (default 0.72) - a pair fails only if it exceeds BOTH.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const STRUCT_MAX = Number(process.env.PALATE_UNIQ_STRUCT ?? 0.82);
const STYLE_MAX = Number(process.env.PALATE_UNIQ_STYLE ?? 0.72);

const files = process.argv.slice(2);
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
  const re = /<(section|header|main|footer|article|aside|nav|div|h1|h2|h3|ul|ol|figure)\b[^>]*?(?:class="([^"]*)")?[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cls = (m[2] || "").trim().split(/\s+/)[0] || "";
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

const variants = files.map((f) => {
  const html = readFileSync(f, "utf8");
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

function base(p) { return p.split("/").pop(); }

// OPTIONAL perceptual-hash enhancement: where sharp is available (e.g. CI with the
// build's node_modules), a DCT pHash over each variant's full-page screenshot adds a
// pixel-level distance (Hamming over 64-bit hashes; reject < ~10). It is intentionally
// NOT required here so the gate stays portable; wire it in the verifier where sharp is
// present. The capstone validated pHash Hamming distances of 30..42 across 3 variants.
