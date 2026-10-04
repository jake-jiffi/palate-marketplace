#!/usr/bin/env node
/**
 * gate-kit-tokens.mjs - the rule that stops a 45-piece section library homogenising the web.
 *
 * ========================== WHY THIS GATE EXISTS ==========================
 *
 * Palate's own doctrine, from the 2026-06-26 Goree finding, is that sharing MARKUP homogenises
 * output while reusing the level of DECISION does not. A kit of forty-five sections is a shared
 * markup library, which is the thing the product argues against. Bootstrap homogenises the web
 * because everybody ships its default skin, not because its grid is bad.
 *
 * So the kit is allowed to exist on one condition: a piece owns the STRUCTURE and the STATES,
 * and the brand owns the SURFACE. Two sites using the same piece with different tokens must not
 * read as the same site. That holds only while no component can express a colour, a face, a size,
 * a radius, a shadow or a spacing of its own.
 *
 * This gate is the enforcement. Without it the rule is a paragraph, and a paragraph loses to the
 * next person in a hurry.
 *
 * ============================ WHAT IT ALLOWS ============================
 *
 * `0`, unitless numbers, percentages, `1fr`, `auto`, viewport units, `ch`, and hairlines of
 * exactly 1px or 2px (a rule that scales with the type ramp stops being a rule). Everything else
 * that names a colour or a length in a styling position must be `var(--kit-*)`.
 *
 * Exit: 0 clean, 1 findings, 2 could not run (never a pass).
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const dir = process.argv[2] || ".";
const kitRoot = join(dir, "templates/astro-project/src/components/kit");
const root = existsSync(kitRoot) ? kitRoot : join(dir, "src/components/kit");

if (!existsSync(root)) {
  console.log(`gate-kit-tokens: skipped (no kit at ${root}); this build ships no kit components.`);
  process.exit(0);
}

function walk(d) {
  const out = [];
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    /**
     * .ts TOO, AND IT WAS NOT. The kit ships shared runtimes beside its components
     * (`form-runtime.ts`, `scroll-region.ts`), and a gate that globs only `.astro` cannot see a
     * literal any of them introduces. Neither carries styles today, which is exactly the state in
     * which this is cheap to close and invisible to leave.
     */
    else if (e.endsWith(".astro") || e.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Only the <style> block is scanned, plus inline style attributes.
 *
 * Scanning the whole file would fire on prose in a header comment and on legitimate content
 * (a case study that mentions "#1"), which is the exists-but-false-fires class this repo has
 * been bitten by four times. The style block is where a literal actually costs something.
 */
function styleRegions(src) {
  const regions = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(src))) {
    regions.push({ text: m[1], offset: m.index + m[0].indexOf(m[1]) });
  }
  const inlineRe = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
  while ((m = inlineRe.exec(src))) {
    regions.push({ text: m[2], offset: m.index + m[0].indexOf(m[2]) });
  }

  /**
   * A STYLE WRITTEN FROM SCRIPT IS STILL A STYLE.
   *
   * The kit ships shared runtimes beside its components, and this gate globbed `.astro` only, so
   * anything they set was invisible to it. Widening the glob alone would have been worse than
   * leaving it: a `.ts` file has no <style> block, so the gate would have read two more files and
   * still checked nothing, which is a check that reports itself as running and cannot fire. These
   * are the three ways a script sets a style, and each one's value is scanned exactly like a
   * declaration in a stylesheet.
   */
  const scriptRe = /\.style\.(?:setProperty\(\s*(["'])([^"']+)\1\s*,\s*(["'])([^"']*)\3|([A-Za-z]+)\s*=\s*(["'`])([^"'`]*)\6)|\.style\.cssText\s*=\s*(["'`])([^"'`]*)\7/g;
  while ((m = scriptRe.exec(src))) {
    const prop = m[2] || m[5] || "";
    const value = m[4] ?? m[7] ?? m[8] ?? "";
    if (!value) continue;
    const text = prop ? `${prop.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${value};` : value;
    regions.push({ text, offset: m.index });
  }
  return regions;
}

/** Strip CSS comments so a comment explaining a colour does not read as one. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

/**
 * DECLARATIONS ARE PARSED, NOT PATTERN-MATCHED AGAINST.
 *
 * The first version of this gate used `/font-size\s*:\s*(?!var\()/`, which reported 207
 * findings on a clean kit. `\s*` backtracks to zero width, so the lookahead tested the SPACE
 * after the colon rather than the value, and every correct `font-size: var(--kit-text-base)`
 * read as a literal. A gate that cries wolf on correct code is worse than no gate: people learn
 * to route around it. So the value is extracted and the value is what gets tested.
 */
function declarations(text) {
  /**
   * MEDIA QUERY PRELUDES ARE NOT DECLARATIONS AND CANNOT BE TOKENISED.
   *
   * `@media (min-width: 48rem)` reads as `min-width: 48rem` to a naive scan, and CSS does not
   * permit `var()` in a media prelude at all, so demanding a token there would demand something
   * impossible. A breakpoint is also a structural decision about reflow rather than a brand
   * surface decision, which is the line this gate is drawing. Preludes are blanked, keeping the
   * byte offsets so reported line numbers stay correct.
   */
  const masked = text.replace(/@(?:media|container|supports)[^{]*\{/g,
    (m0) => m0.replace(/[^\n]/g, " "));
  const out = [];
  const re = /([-a-zA-Z]+)\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = re.exec(masked))) {
    out.push({ prop: m[1].toLowerCase(), value: m[2].trim(), index: m.index });
  }
  return out;
}

/**
 * LOCAL ALIASES RESOLVE. A component that writes `--ca-surface: var(--kit-bg)` at the top and
 * then flips it to `var(--kit-bg-inverse)` inside an inverse band is doing the right thing: it
 * is how a piece adapts to the surface it is placed on without duplicating every rule. The
 * first version of this check called all seven of those a literal, which would have pushed
 * authors back toward hardcoding. So a `var(--x)` counts as tokenised when `--x` is declared in
 * the same file and resolves, transitively, to a `--kit-*` token or to `currentColor`.
 */
function localAliases(text) {
  const map = new Map();
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (name.startsWith("--kit-")) continue;
    const prev = map.get(name) || [];
    prev.push(m[2].trim());
    map.set(name, prev);
  }
  return map;
}

/** Does this value reach a kit token, following local aliases up to a bounded depth? */
function reachesToken(value, aliases, depth = 0) {
  if (depth > 6) return false;
  if (/var\(\s*--kit-/.test(value)) return true;
  if (/\bcurrentColor\b/i.test(value)) return true;
  const refs = [...value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((r) => r[1]);
  for (const ref of refs) {
    const defs = aliases.get(ref);
    if (!defs) continue;
    if (defs.some((d) => reachesToken(d, aliases, depth + 1))) return true;
  }
  return false;
}

const COLOUR_PROPS = /^(color|background|background-color|border(-[a-z]+)?-color|border|outline|outline-color|fill|stroke|box-shadow|text-decoration-color|caret-color|accent-color|background-image)$/;
const SIZE_PROPS = /^(font-size|line-height|letter-spacing|padding|margin|gap|row-gap|column-gap|border-radius|width|height|min-width|min-height|max-width|max-height|inset|top|right|bottom|left|translate)(-[a-z-]+)?$/;
const FONT_PROPS = /^(font|font-family)$/;
const WIDTH_PROPS = /^(border(-[a-z]+)?-width|outline-width|outline-offset|border|outline)$/;

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOUR_FN = /\b(?:rgba?|hsla?|lab|lch|oklch|oklab|color)\s*\(/;
const NAMED = /(?<![\w-])(?:aqua|beige|black|blue|brown|coral|crimson|cyan|fuchsia|gold|gray|grey|green|indigo|ivory|khaki|lime|magenta|maroon|navy|olive|orange|pink|plum|purple|red|salmon|silver|tan|teal|tomato|violet|wheat|white|yellow)(?![\w-])/;
/** A length with a unit that is not derived from a token. */
/**
 * `em`, `ch` and `ex` are DERIVED FROM THE TYPE, which is tokenised, so an icon at `1em` scales
 * with whatever face and size the brand set. Only units that are fixed regardless of the brand
 * are literals here.
 */
const ABSOLUTE_LEN = /(?<![\w.-])\d*\.?\d+(?:px|pt|pc|in|cm|mm|rem)\b/;
/** Values that are structural rather than stylistic and carry no brand decision. */
const STRUCTURAL = /^(0|none|auto|inherit|initial|unset|currentcolor|transparent|revert|revert-layer)$/i;
/** A hairline does not scale with anything, so it may be literal. */
const HAIRLINE = /^(0|1px|2px|thin|medium)$/;

function findingsFor(prop, value, aliases) {
  const v = value.trim();
  const lower = v.toLowerCase();
  if (STRUCTURAL.test(lower)) return null;
  // Anything wholly expressed through tokens, calc over tokens, or colour-mix of tokens is fine.
  const usesToken = reachesToken(v, aliases);

  if (FONT_PROPS.test(prop) && !usesToken && !STRUCTURAL.test(lower)) {
    return "font-family literal";
  }
  if (COLOUR_PROPS.test(prop)) {
    /**
     * ALLOWLIST, NOT DENYLIST. The first version tested against a hand-written list of colour
     * names and missed `rebeccapurple`, which is exactly the failure a denylist of 148 CSS
     * colour names guarantees: the one you forgot is the one someone writes. So a colour
     * property must READ A TOKEN or be structural, and anything else is a literal whatever it
     * is called.
     */
    if (usesToken) return null;
    // Strip the parts of a shorthand that carry no colour, then see if anything is left.
    const residue = lower
      .replace(/\b(?:solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)\b/g, " ")
      .replace(/(?<![\w.-])\d*\.?\d+(?:px|pt|pc|in|cm|mm|rem|em|ch|ex|%)?\b/g, " ")
      .replace(/\b(?:inherit|initial|unset|transparent|currentcolor|revert)\b/g, " ")
      .trim();
    if (residue) {
      if (WIDTH_PROPS.test(prop) && HAIRLINE.test(lower)) return null;
      return "literal colour";
    }
  }
  if (SIZE_PROPS.test(prop) && !usesToken) {
    if (WIDTH_PROPS.test(prop) && HAIRLINE.test(lower)) return null;
    if (ABSOLUTE_LEN.test(v)) {
      // A clamp/min/max whose arguments are all tokens or viewport units is a fluid rule, not a
      // literal, but a bare rem or px value is a spacing decision the brand should own.
      if (/^(clamp|min|max|calc)\(/.test(lower) && usesToken) return null;
      return "literal length";
    }
  }
  if (WIDTH_PROPS.test(prop) && !usesToken && ABSOLUTE_LEN.test(v) && !HAIRLINE.test(lower)) {
    return "literal border width";
  }
  return null;
}

const files = walk(root);
if (!files.length) {
  console.error(`gate-kit-tokens: could not run: ${root} exists but holds no .astro or .ts files.`);
  process.exit(2);
}

const findings = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const region of styleRegions(src)) {
    const text = stripComments(region.text);
    const aliases = localAliases(text);
    for (const d of declarations(text)) {
      /**
       * A COMPONENT MAY NOT REDEFINE A KIT TOKEN.
       *
       * Foundations owns the semantic tokens and flips them by ground, so a piece that sets
       * `--kit-accent-lift` for itself is re-solving a problem that is already solved and will
       * drift from the other forty-four the first time foundations changes. Nine components had
       * done exactly that as a workaround for a real defect; the defect is fixed at source and
       * this stops the workaround coming back.
       *
       * A component-scoped alias (`--ca-surface`) is fine and is checked by what it resolves to.
       */
      if (d.prop.startsWith("--kit-")) {
        const line = src.slice(0, region.offset + d.index).split("\n").length;
        findings.push({ file: relative(dir, f), line, kind: "redefines a kit token",
          snippet: `${d.prop}: ${d.value}`.slice(0, 90) });
        continue;
      }
      if (d.prop.startsWith("--")) continue; // an alias declaration is checked by what it resolves to
      const kind = findingsFor(d.prop, d.value, aliases);
      if (!kind) continue;
      const line = src.slice(0, region.offset + d.index).split("\n").length;
      findings.push({ file: relative(dir, f), line, kind, snippet: `${d.prop}: ${d.value}`.slice(0, 90) });
    }
  }
}

if (findings.length) {
  console.error(`gate-kit-tokens: ${findings.length} literal value(s) in kit components. A kit piece owns structure and states; the brand owns the surface.`);
  for (const f of findings.slice(0, 40)) {
    console.error(`  ${f.file}:${f.line}  [${f.kind}]  ${f.snippet}`);
  }
  if (findings.length > 40) console.error(`  ... and ${findings.length - 40} more`);
  console.error(`  Replace each with a var(--kit-*) token from src/styles/foundations.css. If the token you need does not exist, add it there, once, with the reason.`);
  process.exit(1);
}

console.log(`gate-kit-tokens: clean (${files.length} kit component(s); every colour, face, size, radius, shadow and spacing reads a token).`);
process.exit(0);
