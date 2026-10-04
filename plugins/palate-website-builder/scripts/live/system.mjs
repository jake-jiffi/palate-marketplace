// The site system check. After a direction is chosen, type and colour come only from the system
// (src/styles/system.css, plus src/styles/system/**), headings take their size only from the
// system's heading styles, and every departure carries a written reason. Spacing literals are
// reported, not refused. Naming alone never held a system together: a build that adopted the class
// names still set 252 font sizes of its own.
import fs from 'node:fs';
import path from 'node:path';
import { readState, listFiles } from './project.mjs';

const SYSTEM = 'src/styles/system.css';
const TYPE = new Set(['font-size', 'line-height', 'letter-spacing', 'font-weight', 'font-family', 'font']);
const COLOUR = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline))?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?|filter)$/;
const SPACING = /^(?:padding|margin)(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?$|^(?:row-|column-)?gap$/;
const ABSOLUTE = /-?\d*\.?\d+(?:px|rem|vw|vh|vmin|vmax|svh|dvh|lvh|svw|dvw|lvw|pt|pc|cm|mm|in|ch|ex|cap|lh|rlh|q)\b/i;
const NAMED = /\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gr[ae]y|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia|brown|beige|ivory|tan|coral|salmon|crimson|indigo|violet|cyan|magenta)\b/i;
const KEYWORD = /^(?:inherit|initial|unset|revert|revert-layer|normal|auto|none|bolder|lighter|smaller|larger)$/i;
const GENERIC_FONT = /\b(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math)\b/gi;
const REQUIRED = ['.padding-global', '.container-', '.padding-section-', '.heading-style-h1', '.heading-style-h2', '.heading-style-h3', '.heading-style-h4', '.heading-style-h5', '.heading-style-h6', '.text-size-regular'];

const withoutVars = value => { let out = value, previous; do { previous = out; out = out.replace(/var\((?:[^()]|\([^()]*\))*\)/g, ''); } while (out !== previous); return out; };

// A small CSS reader: selectors (innermost style rule), declarations and line numbers. A
// `/* system: reason */` comment on the line before a declaration, or after it on the same line,
// records a deliberate exception.
export function declarations(css, firstLine = 1) {
  const out = [], stack = [];
  let buffer = '', line = firstLine, start = firstLine, pending = null;
  for (let i = 0; i < css.length;) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2), text = css.slice(i + 2, end < 0 ? css.length : end);
      const reason = /system:\s*([^*]+)/i.exec(text)?.[1].trim();
      if (reason) {
        const last = out.at(-1);
        if (last && last.line === line && !last.exception) last.exception = reason; else pending = reason;
      }
      line += (text.match(/\n/g) || []).length;
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    const char = css[i];
    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== char) j += css[j] === '\\' ? 2 : 1;
      buffer += css.slice(i, j + 1); i = j + 1; continue;
    }
    if (char === '{') { stack.push(buffer.trim()); buffer = ''; i++; continue; }
    if (char === ';' || char === '}') {
      const text = buffer.trim(), colon = text.indexOf(':');
      const selector = [...stack].reverse().find(item => !item.startsWith('@')) || '';
      // Descriptors inside @font-face, @property and similar are not styles on any element.
      const descriptor = /^@(?!media|supports|container|layer|scope|starting-style|document)/i.test(stack.at(-1) || '');
      if (text && colon > 0 && stack.length && !text.startsWith('@') && !descriptor) {
        out.push({ selector, property: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).trim(), line: start, exception: pending });
        pending = null;
      }
      buffer = '';
      if (char === '}') stack.pop();
      i++; continue;
    }
    if (!buffer.trim() && char.trim()) start = line;
    if (char === '\n') line++;
    buffer += char; i++;
  }
  return out;
}

function typeValueOk(value) {
  const plain = value.replace(/!important/i, '').trim();
  if (KEYWORD.test(plain) || /^-?\d*\.?\d+(?:em|%)$/.test(plain)) return true;
  if (!/var\(/.test(plain)) return false;
  const rest = withoutVars(plain).replace(GENERIC_FONT, '');
  return !ABSOLUTE.test(rest) && !/["']/.test(rest) && !/\b(?!calc|clamp|min|max)[a-z][a-z-]{2,}\b/i.test(rest);
}
function colourLiteral(property, value) {
  if (!COLOUR.test(property)) return false;
  const rest = withoutVars(value).replace(/url\([^)]*\)/gi, '');
  return /#[0-9a-f]{3,8}\b/i.test(rest) || /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(rest) || NAMED.test(rest);
}

function sources(project, file) {
  const text = fs.readFileSync(path.join(project, file), 'utf8');
  if (file.endsWith('.css')) return { css: [{ text, line: 1 }], markup: '' };
  const css = [];
  for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    css.push({ text: match[1], line: text.slice(0, match.index + match[0].indexOf('>') + 1).split('\n').length });
  }
  for (const match of text.matchAll(/\sstyle="([^"]*)"/g)) {
    css.push({ text: `inline-style{${match[1]}}`, line: text.slice(0, match.index).split('\n').length });
  }
  return { css, markup: text.replace(/<style\b[\s\S]*?<\/style>/gi, '') };
}

export function checkSystem(project) {
  const state = readState(project);
  if (!state.selection) return { ok: true, skipped: 'No direction is chosen yet. The site system starts at the pick.' };
  return scanSystem(project, { chosen: state.selection.optionId });
}

// `systemFiles` lets an audit read a site whose system lives elsewhere; the check itself never uses it.
export function scanSystem(project, { chosen, systemFiles = null }) {
  const SYSTEM_FILE = systemFiles ? systemFiles[0] : SYSTEM;
  const inSystem = file => systemFiles ? systemFiles.includes(file) : file === SYSTEM || file.startsWith('src/styles/system/');
  const files = listFiles(path.join(project, 'src'), 'src').filter(file => /\.(?:astro|css)$/.test(file)
    && !file.startsWith('src/style-guide/')
    && !(file.startsWith('src/directions/') && !file.startsWith(`src/directions/${chosen}/`)));
  const failures = [], exceptions = [], spacing = {};

  if (!fs.existsSync(path.join(project, SYSTEM_FILE))) {
    failures.push({ file: SYSTEM_FILE, line: 0, rule: 'system-missing', detail: `Codify the chosen direction into ${SYSTEM} before building pages (references/site-system.md).` });
  } else {
    const systemText = files.filter(inSystem).map(file => fs.readFileSync(path.join(project, file), 'utf8')).join('\n');
    const missing = REQUIRED.filter(name => !systemText.includes(name));
    if (missing.length) failures.push({ file: SYSTEM_FILE, line: 0, rule: 'system-incomplete', detail: `The system does not define ${missing.join(', ')}.` });
    const bare = declarations(systemText).filter(item => item.property === 'font-size').flatMap(item => item.selector.split(',').map(part => part.trim()));
    const untagged = [1, 2, 3, 4, 5, 6].filter(level => !bare.includes(`h${level}`));
    if (untagged.length) failures.push({ file: SYSTEM_FILE, line: 0, rule: 'system-incomplete', detail: `Bare heading tags need their default size in the system: ${untagged.map(level => `h${level}`).join(', ')}.` });
  }

  // Classes that sit on heading tags anywhere in scope: those headings are sized by the system only.
  const parsed = files.filter(file => !inSystem(file)).map(file => ({ file, ...sources(project, file) }));
  const headingClasses = new Set();
  for (const { markup } of parsed) {
    for (const match of markup.matchAll(/<h[1-6]\b[^>]*\bclass="([^"]*)"/gi)) for (const name of match[1].split(/\s+/)) if (name && !name.startsWith('heading-style-') && !name.includes('{')) headingClasses.add(name);
  }
  const sizesHeading = selector => selector.split(',').some(part => {
    const last = part.trim().split(/[\s>+~]+/).at(-1) || '';
    return /^(?:h[1-6])(?![\w-])/i.test(last) || [...last.matchAll(/\.([\w-]+)/g)].some(match => headingClasses.has(match[1]));
  });

  for (const { file, css } of parsed) {
    for (const block of css) {
      for (const item of declarations(block.text, block.line)) {
        const where = { file, line: item.line, selector: item.selector, property: item.property, value: item.value };
        let rule = null;
        if (item.property === 'font-size' && sizesHeading(item.selector)) rule = 'heading-size-outside-system';
        else if (TYPE.has(item.property) && !typeValueOk(item.value)) rule = 'type-literal';
        else if (colourLiteral(item.property, item.value)) rule = 'colour-literal';
        if (rule && item.exception) { exceptions.push({ ...where, rule, reason: item.exception }); continue; }
        if (rule) { failures.push({ ...where, rule }); continue; }
        if (SPACING.test(item.property) && ABSOLUTE.test(withoutVars(item.value))) spacing[file] = (spacing[file] || 0) + 1;
      }
    }
  }
  const count = rule => failures.filter(item => item.rule === rule).length;
  return {
    ok: failures.length === 0,
    chosen,
    scanned: parsed.length,
    summary: { typeLiterals: count('type-literal'), headingSizesOutsideSystem: count('heading-size-outside-system'), colourLiterals: count('colour-literal'), systemProblems: count('system-missing') + count('system-incomplete'), recordedExceptions: exceptions.length, spacingLiterals: Object.values(spacing).reduce((sum, value) => sum + value, 0) },
    failures,
    exceptions,
    spacingWarnings: Object.entries(spacing).sort((a, b) => b[1] - a[1]).map(([file, literals]) => ({ file, literals })),
    fix: failures.length ? 'Use the system: a heading-style or text-size class, or a var(--token). A genuinely new size or colour goes into the system first, so the style guide shows it. A deliberate one-off keeps its value with /* system: <reason> */ beside it.' : undefined,
  };
}
