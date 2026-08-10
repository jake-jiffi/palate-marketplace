#!/usr/bin/env node
/**
 * scripts/phantom-utility-check.mjs - the phantom / undefined utility-class gate.
 *
 * ux-lint.sh is per-line PCRE with ZERO knowledge of the Tailwind config or the
 * compiled CSS, so it cannot tell a real utility from a hallucinated one. A real Palate
 * build shipped a 404 styled with `bg-brand-accent`, `rounded-brand`, `text-brand-muted`
 * - none of which exist in the build's custom (camelCase) preset - so they compiled to
 * NOTHING and the page shipped as unstyled text under verdict:pass. Guessing kebab
 * brand-* names against a custom preset is a recurring LLM failure that lands on
 * low-attention pages (404/500) which escape the visual pass.
 *
 * Design: COMPILER-AS-ORACLE. The project's own compiled CSS (dist/, produced by the
 * same Tailwind engine that ships) is ground truth for "did this class resolve". A class
 * used in source, in a canonical Tailwind property namespace, that produced NO rule
 * anywhere in the build, is a phantom. The namespace allowlist only decides WHAT is a
 * utility candidate (so custom/scoped classes like `nf-btn`, `ev-panel` are never
 * flagged); the compiled CSS decides whether it resolved, so this is preset-aware for
 * free (the dist reflects the real preset, @theme removals and arbitrary values).
 *
 * Freshness is everything: a class added to source since the last build reads as phantom
 * against a stale dist. So this BUILDS by default; `--no-build` trusts the existing dist
 * (fast, for a just-built tree); `--require-fresh` makes a stale dist a SKIP (exit 2),
 * never a false flag - use it anywhere freshness is not guaranteed (the Stop hook).
 *
 * Usage:
 *   node scripts/phantom-utility-check.mjs [project-dir]   (default ".")
 *     [--dist <dir>]            (default <project>/dist)
 *     [--ext .astro,.html]      (source globs; default .astro,.html)
 *     [--build | --no-build]    (default: build, so dist matches source)
 *     [--require-fresh]         (exit 2 SKIP if dist is older than any source file)
 *     [--ignore tok,glob*]      (suppress tokens; glob* prefix match)
 *     [--json <path>] [--ci]
 *
 * Exit: 0 clean OR fail-open SKIP (no dist + --no-build, or stale + --require-fresh);
 *       1 phantom utilities found; 2 internal error (bad args / missing project).
 *
 * Per-line escape: `phantom-class-disable <token>` (or `-all`) as a comment on the
 * same or preceding line, mirroring ux-lint-disable.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { spawnSync } from "node:child_process";

// Canonical Tailwind core utility first-segment namespaces (property prefixes only).
// Small + stable across v3/v4. Decides "is it meant to be a utility"; dist decides
// "did it resolve". A hallucinated `bg-brand-accent` has first-seg `bg` (in here) so it
// is a candidate; a custom `nf-btn` has first-seg `nf` (not here) so it is never flagged.
const NS = new Set(("p px py pt pb pl pr ps pe m mx my mt mb ml mr ms me w h size min max gap space inset top right bottom left start end z order basis grow shrink flex grid col row justify items content self place auto text font leading tracking indent align list decoration underline whitespace break hyphens line bg from via to border rounded ring outline divide shadow opacity mix fill stroke accent caret placeholder blur brightness contrast grayscale hue invert saturate sepia drop backdrop translate rotate scale skew origin transition duration delay ease animate cursor select resize scroll snap touch will appearance pointer object aspect overflow overscroll float clear box isolation visibility table caption columns container sr not").split(" "));
const EXCLUDE = new Set(["node_modules", ".git", ".astro", "dist", ".vercel", ".output", ".wrangler"]);

// ---- args ----
let ROOT = ".", DIST = null, distExplicit = false, EXTS = [".astro", ".html"];
let BUILD = null, REQUIRE_FRESH = false, IGNORE = [], JSON_OUT = null, CI = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dist") { DIST = argv[++i]; distExplicit = true; }
  else if (a === "--ext") EXTS = argv[++i].split(",").map((s) => (s.startsWith(".") ? s : "." + s));
  else if (a === "--build") BUILD = "force";
  else if (a === "--no-build") BUILD = "never";
  else if (a === "--require-fresh") REQUIRE_FRESH = true;
  else if (a === "--ignore") IGNORE = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--json") JSON_OUT = argv[++i];
  else if (a === "--ci") CI = true;
  else if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
  else if (a.startsWith("-")) { console.error(`phantom-utility-check: unknown flag ${a}`); process.exit(2); }
  else ROOT = a;
}
function printHelp() { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 40).map((l) => l.replace(/^ \*? ?/, "")).join("\n")); }
if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) { console.error(`phantom-utility-check: project dir not found at ${ROOT}`); process.exit(2); }
DIST = DIST || join(ROOT, "dist");
function skip(msg) { console.error(`phantom-utility-check: SKIP - ${msg}`); process.exit(0); }

function walk(dir, exts, out = []) {
  let ents; try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    if (EXCLUDE.has(e)) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}
const newestMtime = (files) => files.reduce((m, f) => { try { return Math.max(m, statSync(f).mtimeMs); } catch { return m; } }, 0);

// ---- ensure a FRESH compiled dist (the oracle) ----
if (BUILD === null) BUILD = distExplicit ? "never" : "force";
const srcFiles = walk(join(ROOT, "src"), EXTS);
if (BUILD === "force") {
  console.error("phantom-utility-check: building (npm run build) so compiled CSS matches source...");
  const r = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore" });
  if (r.status !== 0) skip("npm run build did not succeed; cannot produce compiled CSS to gate against.");
}
const distCss = walk(DIST, [".css", ".html"]);
if (!distCss.length) skip(`no compiled CSS under ${DIST}; nothing to gate (build first, or drop --no-build).`);
if (REQUIRE_FRESH) {
  // A stale oracle would read real, newly-added utilities as phantom. Refuse to judge.
  const srcNewest = newestMtime(srcFiles);
  const distOldest = distCss.reduce((m, f) => { try { return Math.min(m, statSync(f).mtimeMs); } catch { return m; } }, Infinity);
  if (srcNewest > distOldest + 1000) skip(`dist is older than source (stale oracle); rebuild before gating. Not flagging against a stale build.`);
}

// ---- PRESENT set: every class that produced a real CSS rule ----
const unescapeCss = (s) => s.replace(/\\(.)/g, "$1");
function classesFromCss(css, out) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let segStart = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") { for (const m of css.slice(segStart, i).matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) out.add(unescapeCss(m[1])); segStart = i + 1; }
    else if (c === "}" || c === ";") segStart = i + 1;
  }
}
const present = new Set();
for (const f of walk(DIST, [".css"])) classesFromCss(readFileSync(f, "utf8"), present);
for (const f of walk(DIST, [".html"])) { for (const m of readFileSync(f, "utf8").matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) classesFromCss(m[1], present); }

// ---- USED set: candidate classes from source ----
function baseOf(token) {
  let depth = 0, lastColon = -1;
  for (let i = 0; i < token.length; i++) { const c = token[i]; if (c === "[") depth++; else if (c === "]") depth = Math.max(0, depth - 1); else if (c === ":" && depth === 0) lastColon = i; }
  let b = lastColon >= 0 ? token.slice(lastColon + 1) : token;
  if (b.startsWith("!")) b = b.slice(1); if (b.endsWith("!")) b = b.slice(0, -1);
  return b;
}
const firstSeg = (base) => { const h = base.indexOf("-"); return h > 0 ? base.slice(0, h) : (NS.has(base) ? base : null); };
const ignored = (tok) => IGNORE.some((g) => (g.endsWith("*") ? tok.startsWith(g.slice(0, -1)) : tok === g));
const attrRe = /\b(?:class:list|className|class)\s*=\s*("([^"]*)"|'([^']*)'|\{([\s\S]*?)\})/g;
const strRe = /'([^']*)'|"([^"]*)"|`([^`]*)`/g;
const findings = [], seen = new Set();
for (const file of srcFiles) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const offsets = []; let acc = 0; for (const ln of lines) { offsets.push(acc); acc += ln.length + 1; }
  const lineOf = (idx) => { let lo = 0, hi = offsets.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
  const disabledAt = (line, tok) => { for (const i of [line - 1, line - 2]) { const l = lines[i]; if (!l) continue; if (l.includes("phantom-class-disable-all")) return true; const dm = l.match(/phantom-class-disable\s+([^\s*]+)/); if (dm && dm[1] === tok) return true; } return false; };
  let m;
  while ((m = attrRe.exec(text)) !== null) {
    const line = lineOf(m.index);
    let chunks;
    if (m[4] !== undefined) { chunks = []; let s; strRe.lastIndex = 0; while ((s = strRe.exec(m[4])) !== null) chunks.push(s[1] ?? s[2] ?? s[3] ?? ""); }
    else chunks = [m[2] ?? m[3] ?? ""];
    for (const ch of chunks) {
      if (ch.includes("${")) continue;
      for (const tok of ch.split(/\s+/)) {
        if (!tok || tok.includes("${") || tok.includes("{") || tok.includes("(")) continue;
        if (present.has(tok) || ignored(tok)) continue;
        const seg = firstSeg(baseOf(tok));
        if (!seg || !NS.has(seg)) continue;          // not a Tailwind-utility candidate
        if (disabledAt(line, tok)) continue;
        const key = `${file}::${line}::${tok}`;
        if (seen.has(key)) continue; seen.add(key);
        findings.push({ token: tok, file, line });
      }
    }
  }
}

// ---- report ----
findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
const rel = (f) => f.replace(ROOT.replace(/\/$/, "") + "/", "");
for (const f of findings) {
  if (CI) console.log([rel(f.file), f.line, "Critical", "phantom-utility", f.token].join("\t"));
  else console.log(`${rel(f.file)}:${f.line}  [Critical phantom-utility]  ${f.token}  (used in source, resolves to NO CSS rule in ${rel(DIST)})`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ ran: true, checked: srcFiles.length, present: present.size, phantom: findings.map((f) => ({ token: f.token, file: rel(f.file), line: f.line })), pass: findings.length === 0 }, null, 2) + "\n");
if (!CI) console.error(`phantom-utility-check: ${findings.length} phantom utilit${findings.length === 1 ? "y" : "ies"} (scanned ${srcFiles.length} source files, ${present.size} resolved classes)`);
process.exit(findings.length > 0 ? 1 : 0);
