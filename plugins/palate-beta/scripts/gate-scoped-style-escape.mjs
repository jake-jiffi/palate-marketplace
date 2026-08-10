#!/usr/bin/env node
/**
 * scripts/gate-scoped-style-escape.mjs - the Astro scoped-style escape gate.
 *
 * Astro stamps `data-astro-cid-<hash>` only on elements that exist in the template at
 * BUILD time. A node CREATED by client JS at runtime never carries the cid, so a SCOPED
 * (non-:global) <style> rule targeting it never matches and it renders UNSTYLED. This
 * silently blanked a real build's runtime-injected chips (`.chips li` / `.chips button`
 * built with createElement). ux-lint.sh is per-line PCRE with no DOM/scope model, so it
 * is structurally blind to this. This static check is the missing arm.
 *
 * NARROWED to genuinely JS-CREATED nodes (the key false-positive fix): a class set via
 * `el.className = ...` is flagged ONLY when `el` traces to a `createElement` in the same
 * script. The common, CORRECT idiom `const panel = document.querySelector('.panel');
 * panel.className = 'panel open'` toggles state on a BUILD-TIME element that DOES carry
 * the cid, so it is NOT flagged. Three creation signals are trusted: a createElement'd
 * variable's `.className`/`setAttribute('class')`, a class="..." inside an HTML string
 * (innerHTML / insertAdjacentHTML / a created template), and a createElement'd tag that a
 * scoped descendant element selector targets.
 *
 * Usage: node scripts/gate-scoped-style-escape.mjs [project-dir] [--disable id,id] [--ci]
 * Exit: 0 clean, 1 escape(s) found (Critical), 2 internal error.
 * Per-line escape: `scoped-style-escape-disable <class-or-tag>` (or `-all`) on the line.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const EXCLUDE = new Set(["node_modules", ".git", ".astro", "dist", ".vercel", ".output", ".wrangler"]);
const GENERIC_TAGS = new Set(["div", "span"]); // too common to flag on type alone

let projectDir = ".", ci = false;
const disabledRules = new Set();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--ci") ci = true;
  else if (a === "--disable") (argv[++i] || "").split(",").forEach((x) => x.trim() && disabledRules.add(x.trim()));
  else if (a === "-h" || a === "--help") { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 24).map((l) => l.replace(/^ \*? ?/, "")).join("\n")); process.exit(0); }
  else if (a.startsWith("-")) { console.error(`scoped-style-escape: unknown flag ${a}`); process.exit(2); }
  else projectDir = a;
}
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) { console.error(`scoped-style-escape: project dir not found at ${projectDir}`); process.exit(2); }

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue;
    const p = join(dir, name); const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".astro")) out.push(p);
  }
  return out;
}
const files = walk(projectDir, []);
const lineStarts = (s) => { const a = [0]; for (let i = 0; i < s.length; i++) if (s[i] === "\n") a.push(i + 1); return a; };
const posOf = (st, off) => { let lo = 0, hi = st.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid] <= off) lo = mid; else hi = mid - 1; } return { line: lo + 1, col: off - st[lo] + 1 }; };
const classTokens = (sel) => [...sel.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
const globalTypeTokens = (sel) => [...sel.matchAll(/(?:^|[\s>+~(,])([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
// A scoped element target is the rightmost type selector in a DESCENDANT chain (e.g.
// `.chips li` -> li); a bare top-level `button {}` reset (one compound) is NOT a target.
function scopedElementTarget(sel) {
  const compounds = sel.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  if (compounds.length < 2) return null;
  const last = compounds[compounds.length - 1];
  return (/^[a-zA-Z][\w-]*$/.test(last) && !GENERIC_TAGS.has(last.toLowerCase())) ? last.toLowerCase() : null;
}

const findings = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const starts = lineStarts(src);
  const lines = src.split("\n");

  // 1. scoped vs global selector targets from every <style>
  const scopedClass = new Map(), globalClass = new Set(), scopedEl = new Map(), globalEl = new Set();
  for (const sm of src.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)) {
    const blockGlobal = /\bis:global\b/i.test(sm[1]);
    const bodyOffset = sm.index + sm[0].indexOf(sm[2]);
    const body = sm[2].replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
    for (const rm of body.matchAll(/([^{}]+?)\{/g)) {
      const lead = rm[1].length - rm[1].trimStart().length;
      const selLine = posOf(starts, bodyOffset + rm.index + lead).line;
      for (const oneSel of rm[1].split(",")) {
        const sel = oneSel.trim();
        if (!sel || sel.startsWith("@")) continue;
        const bareGlobal = /:global\b(?!\s*\()/.test(sel);
        if (blockGlobal || bareGlobal) {
          const s2 = sel.replace(/:global/g, " ");
          classTokens(s2).forEach((t) => globalClass.add(t));
          globalTypeTokens(s2).forEach((t) => globalEl.add(t));
          continue;
        }
        for (const gm of sel.matchAll(/:global\s*\(([^)]*)\)/g)) {
          classTokens(gm[1]).forEach((t) => globalClass.add(t));
          globalTypeTokens(gm[1]).forEach((t) => globalEl.add(t));
        }
        const scopedPart = sel.replace(/:global\s*\([^)]*\)/g, " ");
        for (const t of classTokens(scopedPart)) if (!scopedClass.has(t)) scopedClass.set(t, selLine);
        const et = scopedElementTarget(scopedPart);
        if (et && !scopedEl.has(et)) scopedEl.set(et, selLine);
      }
    }
  }

  // 2. classes/tags applied to genuinely JS-CREATED DOM in client <script>s
  const applied = [], created = []; // {token|tag, offset}
  const TRIGGER = /\b(?:createElement|insertAdjacentHTML|replaceChildren)\s*\(|\.innerHTML\s*\+?=/;
  for (const cm of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type\s*=\s*["'][^"']*(?:json|importmap)/i.test(cm[1])) continue;
    const body = cm[2];
    if (!TRIGGER.test(body)) continue;
    const base = cm.index + cm[0].indexOf(body);
    const split = (s) => s.split(/\s+/).filter(Boolean);

    // createElement'd variables (so `.className`/setAttribute apply ONLY to created nodes)
    const createdVars = new Set();
    for (const m of body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$.]*\.)?createElement(?:NS)?\s*\(/g)) createdVars.add(m[1]);
    // createElement'd tags (for the element rule), and remember offsets
    for (const m of body.matchAll(/createElement(?:NS)?\s*\(\s*(?:[^,)]*,\s*)?["'`]([^"'`]+)["'`]/g)) created.push({ tag: m[1].toLowerCase(), offset: base + m.index });

    const pushClass = (tok, idx) => applied.push({ token: tok, offset: base + idx });
    // (a) .className on a created var only  (b) setAttribute('class',..) on a created var only
    for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\.className\s*=\s*[`"']([^`"']*)[`"']/g)) if (createdVars.has(m[1])) for (const t of split(m[2])) pushClass(t, m.index);
    for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\.setAttribute\s*\(\s*["']class["']\s*,\s*[`"']([^`"']*)[`"']/g)) if (createdVars.has(m[1])) for (const t of split(m[2])) pushClass(t, m.index);
    // (c) class="..." inside an HTML string (innerHTML / insertAdjacentHTML / template) - injected children are always cid-less
    for (const m of body.matchAll(/\bclass\s*=\s*["'`]([^"'`]*)/g)) for (const t of split(m[1])) pushClass(t, m.index);
  }

  // 3. flag escapes
  const seen = new Set();
  const escaped = (line, token) => {
    const here = (lines[line - 1] || "") + " " + (lines[line - 2] || "");
    return new RegExp(`scoped-style-escape-disable(?:-all|\\s+${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`).test(here);
  };
  const addF = (rule, token, offset, defLine, kind) => {
    if (disabledRules.has(rule)) return;
    const { line, col } = posOf(starts, offset);
    const key = `${line}:${rule}:${token}`;
    if (seen.has(key)) return; seen.add(key);
    if (escaped(line, token)) return;
    const msg = kind === "class"
      ? `client <script> applies class ".${token}" to JS-created DOM, but ".${token}" is defined only in a SCOPED (non-:global) <style> (def line ${defLine}). The injected node carries no data-astro-cid and renders UNSTYLED. Fix: :global(.${token}) or <style is:global>. Escape: scoped-style-escape-disable ${token}`
      : `client <script> createElement("${token}"), targeted only by a SCOPED element selector (def line ${defLine}). The injected <${token}> lacks data-astro-cid and renders UNSTYLED. Fix: wrap the type in :global(${token}). Escape: scoped-style-escape-disable ${token}`;
    findings.push({ file: relative(projectDir, file) || file, line, col, rule, token, msg });
  };
  for (const { token, offset } of applied) if (scopedClass.has(token) && !globalClass.has(token)) addF("scoped-style-escape-class", token, offset, scopedClass.get(token), "class");
  for (const { tag, offset } of created) if (scopedEl.has(tag) && !globalEl.has(tag)) addF("scoped-style-escape-element", tag, offset, scopedEl.get(tag), "element");
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
if (ci) for (const f of findings) process.stdout.write(`${f.file}\t${f.line}\tCritical\t${f.rule}\t${f.token}\t${f.msg}\n`);
else { for (const f of findings) process.stdout.write(`${f.file}:${f.line}:${f.col}  [Critical ${f.rule}]  ${f.msg}\n`); console.error(`scoped-style-escape: ${findings.length} escape(s) across ${files.length} .astro file(s)`); }
process.exit(findings.length > 0 ? 1 : 0);
