#!/usr/bin/env node
/**
 * gate-brand-token-usage.mjs - does the BUILT site actually use the brand?
 *
 * The gap this closes: every existing brand check stops at wiring. verify-is-real-astro.sh
 * proves the brand package is a dependency, verify-brand-exports.sh proves it exports
 * tokens.css and fonts.css, verify-brand-record.mjs proves the record exists. Nothing looks
 * at the CSS that actually ships. A build can import tokens.css, never reference a single
 * token, hardcode #1a1a1a and "Playfair Display" through every component, and pass the lot.
 * The client then gets a site that is not on their brand and no gate said a word.
 *
 * So this reads dist/ and asks two questions of the SHIPPED css:
 *   1. Colour: is every hex used in a colour position one that a custom property declares?
 *   2. Type:   is every font-family a face the brand declares (a --*-font-* token or an
 *              @font-face), rather than a face nobody put in the brand?
 *
 * Usage: node scripts/gate-brand-token-usage.mjs [projectDir] [--json] [--strict]
 * Exit 0 = clean, 1 = blocking findings, 3 = advisory only, 2 = cannot run. A missing dist
 * is a loud 2 and never a 0, because "I could not look" must not read the same as "I looked
 * and it was fine", which is how the vendored-marker grep in verify-is-real-astro.sh managed
 * to pass on every build for as long as it existed.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Thresholds. Calibrated against the eight shipped Palate demo builds (aralia,
// aught, axis, hesper, kern, nocturne, vela, zoop), which are the standard a
// client build has to meet, plus the template's own dist.
//
// OFF_TOKEN_HEX_MAX = 2. A real build legitimately carries one or two literal
// colours that are not brand tokens: a photo-overlay tint, a third-party embed's
// own colour, a single decorative gradient stop. Three or more distinct ones is
// not a one-off, it is a second palette. Set to 0 this gate would cry wolf on
// every build and get switched off, which is worse than not having it.
//
// HEX_REPEAT_MAX = 4. Independently of the count, ONE literal repeated across
// five or more declarations is functioning as a brand colour with no token
// behind it, which is exactly the failure mode ("defined tokens, then hardcoded
// hexes everywhere") and the reason a distinct-count-only rule is not enough.
// ---------------------------------------------------------------------------
const OFF_TOKEN_HEX_MAX = 2;
const HEX_REPEAT_MAX = 4;

// Colour-bearing properties we police. Deliberately EXCLUDES:
//  - box-shadow / text-shadow: near-universally an rgba/hex black that is not a brand colour
//    and never reads as one, so policing it is pure noise.
//  - fill / stroke: icon and inline-SVG one-offs, the documented false positive.
const COLOUR_PROPS = new Set([
  "color", "background", "background-color", "background-image",
  "border-color", "border-top-color", "border-right-color",
  "border-bottom-color", "border-left-color", "border-block-color",
  "border-inline-color", "outline-color", "caret-color",
  "text-decoration-color", "accent-color", "column-rule-color",
]);

// Neutral endpoints. Present in every stylesheet ever written, carry no brand
// signal, and flagging them would drown the real findings.
const NEUTRAL_HEXES = new Set(["#ffffff", "#000000"]);

// Generic and system-stack families. Naming these inline is not "ignoring the
// brand", it is the fallback tail every font stack has.
const GENERIC_FAMILIES = new Set([
  "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
  "sans-serif", "serif", "monospace", "cursive", "fantasy", "math",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "helvetica neue",
  "helvetica", "arial", "noto sans", "liberation sans", "apple color emoji",
  "segoe ui emoji", "segoe ui symbol", "noto color emoji", "cantarell",
  "sf mono", "menlo", "monaco", "consolas", "liberation mono", "courier new",
  "inherit", "initial", "unset", "revert", "revert-layer", "emoji",
  // Web-safe fallback tails. A build that ends a stack with Georgia or Times New
  // Roman is naming a fallback, not choosing a face, and flagging those was the
  // one false positive the demo run turned up.
  "georgia", "times new roman", "times", "verdana", "tahoma", "trebuchet ms",
  "courier", "palatino", "palatino linotype", "garamond", "book antiqua",
  "sfmono-regular", "sf pro text", "sf pro display", "andale mono",
]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function normHex(h) {
  let s = h.toLowerCase().slice(1);
  if (s.length === 3 || s.length === 4) s = s.slice(0, 3).split("").map((c) => c + c).join("");
  else s = s.slice(0, 6);
  return "#" + s;
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function hexesIn(str) {
  const found = [];
  for (const m of str.match(HEX_RE) || []) {
    const len = m.length - 1;
    if (len !== 3 && len !== 4 && len !== 6 && len !== 8) continue;
    found.push(normHex(m));
  }
  return found;
}

const FONT_FACE_RE = /@font-face\s*\{([^{}]*)\}/gi;

/**
 * Pull the @font-face blocks out FIRST and return them separately. A face's own
 * `font-family:` is necessarily a literal (it is the declaration of the face, not a
 * use of it), so leaving those blocks in the stream makes every real build look like
 * it names faces inline. Verified against the eight shipped demos, where a state
 * machine that tried to track @font-face by nesting depth mis-scored all of them.
 */
function splitFontFaces(css) {
  const declared = [];
  const rest = css.replace(FONT_FACE_RE, (_m, body) => {
    for (const d of body.split(";")) {
      const i = d.indexOf(":");
      if (i > 0 && d.slice(0, i).trim().toLowerCase() === "font-family") declared.push(d.slice(i + 1));
    }
    return " ";
  });
  return { declared, rest };
}

/**
 * Split a stylesheet into { prop, value } declarations. A real parser is overkill here;
 * a scan for `prop: value;` inside braces is enough for built CSS, minified or not.
 */
function declarations(css) {
  const out = [];
  let buf = "";
  const flush = () => {
    const s = buf.trim();
    buf = "";
    if (!s) return;
    const i = s.indexOf(":");
    if (i <= 0) return;
    const prop = s.slice(0, i).trim().toLowerCase();
    const value = s.slice(i + 1).trim();
    if (!prop || !value || /\s/.test(prop)) return;
    out.push({ prop, value });
  };
  for (const c of css) {
    if (c === "{" || c === "}" || c === ";") { flush(); continue; }
    buf += c;
  }
  flush();
  return out;
}

function familiesIn(value) {
  // Strip any var(...) so its fallback tail is not read as an inline face.
  const withoutVars = value.replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, " ");
  return withoutVars
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, "").trim().toLowerCase())
    .filter(Boolean);
}

export function analyse(cssSources) {
  const tokenHexes = new Set();
  const declaredFaces = new Set();
  const decls = [];
  for (const { file, css } of cssSources) {
    const { declared, rest } = splitFontFaces(stripComments(css));
    for (const v of declared) for (const fam of familiesIn(v)) declaredFaces.add(fam);
    for (const d of declarations(rest)) decls.push({ ...d, file });
  }
  // Pass 1: the TOKEN SET. Every hex and every face a custom property declares is, by
  // definition, part of the brand's vocabulary. With Tailwind v4 the brand preset lands
  // as `--brand-font-display: "Archivo", ...` and then Tailwind emits utilities that
  // repeat the literal, so an "it must go through var()" rule would fail every real
  // build. Comparing against the declared vocabulary is the version that holds.
  for (const d of decls) {
    if (!d.prop.startsWith("--")) continue;
    for (const h of hexesIn(d.value)) tokenHexes.add(h);
    if (/font/.test(d.prop)) for (const fam of familiesIn(d.value)) declaredFaces.add(fam);
  }
  // Pass 2: hexes used in colour positions that no token declares. Counted per
  // DECLARATION, not per occurrence: a four-stop gradient of one colour at four alphas
  // is one design decision, and counting it as four would misreport a single veil as a
  // colour used all over the site.
  const offToken = new Map(); // hex -> { count, files:Set, props:Set }
  for (const d of decls) {
    if (d.prop.startsWith("--")) continue;
    if (!COLOUR_PROPS.has(d.prop)) continue;
    for (const h of new Set(hexesIn(d.value))) {
      if (NEUTRAL_HEXES.has(h) || tokenHexes.has(h)) continue;
      const e = offToken.get(h) || { count: 0, files: new Set(), props: new Set() };
      e.count++; e.files.add(d.file); e.props.add(d.prop);
      offToken.set(h, e);
    }
  }
  // Pass 3: faces used that the brand never declared.
  const offFaces = new Map(); // family -> { count, files:Set }
  for (const d of decls) {
    if (d.prop !== "font-family") continue;
    for (const fam of new Set(familiesIn(d.value))) {
      if (GENERIC_FAMILIES.has(fam) || declaredFaces.has(fam)) continue;
      if (fam.startsWith("-")) continue;
      const e = offFaces.get(fam) || { count: 0, files: new Set() };
      e.count++; e.files.add(d.file);
      offFaces.set(fam, e);
    }
  }
  return { tokenHexes, declaredFaces, offToken, offFaces, declCount: decls.length };
}

/**
 * Severity is calibrated, not guessed. Measured across the eight shipped demos:
 * off-brand FACES 0 in all eight, and the highest repeat of any one off-token hex
 * was 2. Real builds simply do not do those two things, so they BLOCK. The
 * distinct-count rule fires on one of the eight (aralia, which really does hardcode
 * an error red #8a3b2e the palette never declares), so it is ADVISORY: a rule that
 * fails a good build gets switched off, and a gate that is off catches nothing.
 * `--strict` promotes advisories to blocking for anyone who wants the harder line.
 */
export function verdict(result) {
  const findings = [];
  const distinct = result.offToken.size;
  if (distinct > OFF_TOKEN_HEX_MAX) {
    findings.push({
      severity: "advisory",
      kind: "off-token-colours",
      detail: `${distinct} distinct hex colours are used in colour properties but declared by no custom property (threshold: ${OFF_TOKEN_HEX_MAX})`,
      items: [...result.offToken.entries()].sort((a, b) => b[1].count - a[1].count)
        .map(([h, e]) => `${h} x${e.count} (${[...e.props].join(", ")})`),
    });
  }
  for (const [h, e] of result.offToken) {
    if (e.count > HEX_REPEAT_MAX) {
      findings.push({
        severity: "block",
        kind: "off-token-colour-repeated",
        detail: `${h} is hardcoded in ${e.count} declarations and no token declares it, so it is a brand colour with no token behind it (threshold: ${HEX_REPEAT_MAX})`,
        items: [...e.files].slice(0, 4),
      });
    }
  }
  if (result.offFaces.size > 0) {
    findings.push({
      severity: "block",
      kind: "off-token-typefaces",
      detail: `${result.offFaces.size} typeface(s) set in font-family that the brand never declares (no --*-font-* token and no @font-face)`,
      items: [...result.offFaces.entries()].sort((a, b) => b[1].count - a[1].count)
        .map(([f, e]) => `"${f}" x${e.count} in ${[...e.files].slice(0, 2).join(", ")}`),
    });
  }
  return findings;
}

export function collectCss(distDir) {
  const sources = [];
  for (const f of walk(distDir)) {
    if (f.endsWith(".css")) {
      sources.push({ file: path.relative(distDir, f), css: readFileSync(f, "utf8") });
    } else if (f.endsWith(".html")) {
      const html = readFileSync(f, "utf8");
      const rel = path.relative(distDir, f);
      for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        sources.push({ file: rel + " <style>", css: m[1] });
      }
    }
  }
  return sources;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const proj = args.find((a) => !a.startsWith("--")) || ".";
  const dist = path.join(proj, "dist");
  if (!existsSync(dist)) {
    console.error(`BRAND_TOKEN_USAGE: cannot run, no ${dist}/ to read. Build first. This is NOT a pass.`);
    process.exit(2);
  }
  const sources = collectCss(dist);
  if (sources.length === 0) {
    console.error(`BRAND_TOKEN_USAGE: cannot run, ${dist}/ contains no CSS at all. This is NOT a pass.`);
    process.exit(2);
  }
  const result = analyse(sources);
  if (result.tokenHexes.size === 0) {
    console.error(`BRAND_TOKEN_USAGE: the built CSS declares NO colour token at all (no custom property carries a hex).`);
    console.error(`  The brand tokens are not reaching the build. Check that BaseLayout imports tokens.css.`);
    process.exit(1);
  }
  const strict = args.includes("--strict");
  const findings = verdict(result).map((f) => (strict ? { ...f, severity: "block" } : f));
  const blocking = findings.filter((f) => f.severity === "block");
  if (json) {
    console.log(JSON.stringify({
      tokens: result.tokenHexes.size,
      offToken: Object.fromEntries([...result.offToken].map(([h, e]) => [h, e.count])),
      offFaces: Object.fromEntries([...result.offFaces].map(([f, e]) => [f, e.count])),
      findings,
    }, null, 2));
  }
  if (findings.length === 0) {
    if (!json) console.log(`BRAND_TOKEN_USAGE_OK: ${result.tokenHexes.size} colour tokens, ${result.declaredFaces.size} declared faces, ${result.offToken.size} off-token literal(s) (<= ${OFF_TOKEN_HEX_MAX}), no off-brand typeface.`);
    process.exit(0);
  }
  if (!json) {
    console.error(blocking.length
      ? "BRAND_TOKEN_USAGE: the built site does not resolve its colours/faces from the brand tokens."
      : "BRAND_TOKEN_USAGE [advisory]: off-token colour literals in the built site.");
    for (const f of findings) {
      console.error(`  - [${f.severity}] ${f.detail}`);
      for (const it of f.items.slice(0, 8)) console.error(`      ${it}`);
    }
    console.error("  Move these into the brand tokens (or reference the existing token) and rebuild.");
  }
  // 1 = blocking, 3 = advisory only. Separate codes so a caller can surface the
  // advisory without it reading as a pass and without it failing the build.
  process.exit(blocking.length ? 1 : 3);
}
