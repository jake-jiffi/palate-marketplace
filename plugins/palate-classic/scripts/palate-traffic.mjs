#!/usr/bin/env node
/**
 * palate-traffic.mjs - which merge cost you the traffic.
 *
 * ============================== WHY IT EXISTS ==============================
 *
 * A site loses 42% of its organic clicks on one template and nobody notices,
 * because the migration that did it was written up as a success. The loss and
 * the cause live in two different systems: Search Console knows the route lost
 * impressions, git knows which merge touched that route, and nothing joins
 * them. So the write-up says "migration complete" and the number says
 * otherwise, for months.
 *
 * The index already answers "which routes does this change affect"
 * (palate-index.mjs). Search Console answers "which routes lost clicks". This
 * joins the two and names the merges that could have done it.
 *
 * ========================== IT PROPOSES SUSPECTS ==========================
 *
 * This is correlation over a small window and it says so on every line it
 * prints. A confident wrong attribution is worse than a list, because a list
 * gets checked and a verdict gets acted on: someone reverts a good merge, the
 * traffic does not come back, and now the tool has cost two changes instead of
 * none. So the output is ranked candidates, each with what would confirm it and
 * what would rule it out, and the arithmetic behind the rank is printed rather
 * than trusted.
 *
 * Four things it refuses to attribute, because each one produces a confident
 * lie if you let it through:
 *
 *   TOO LITTLE DATA   a page on five clicks a day drops to three by chance
 *                     every other week. Below the volume floor there is no
 *                     signal to attribute, and saying so is the answer.
 *   SITEWIDE MOVES    if the whole site fell together, no single merge to one
 *                     route explains it. A core update, seasonality, or a
 *                     reporting change is at least as likely, and blaming the
 *                     merge that happened to land that week is how a team
 *                     reverts something that was working.
 *   NEW ROUTES        a route with no history has not declined, it has just
 *                     started. Its "before" is empty by construction.
 *   FRESH DAYS        Search Console's last two or three days are incomplete
 *                     and always slope down. Left in, every export looks like a
 *                     decline that started last Tuesday.
 *
 * ========================== NO API CREDENTIALS ==========================
 *
 * It takes a FILE. A Search Console CSV is two clicks to export; an OAuth flow
 * to a Google property is a support conversation, a consent screen and a
 * service account, and an integration nobody can authenticate is not a feature.
 * CSV and JSON, page-by-date or a two-period comparison, all accepted.
 *
 * ============================ THE MERGE, NOT THE COMMIT ============================
 *
 * The timeline is the FIRST-PARENT mainline, and a merge commit is credited
 * with everything its branch introduced. A commit authored three weeks before
 * it landed reached production on the merge date, so the merge date is the one
 * that can explain a traffic change. Walking every commit by author date puts
 * the cause weeks before the effect and ranks it last.
 *
 * Usage:
 *   node palate-traffic.mjs <project-dir> --export <search-console-file>
 *   node palate-traffic.mjs <project-dir> --export gsc.csv --json
 *
 * Exit: 0 a report was produced, 2 unusable input. Nothing else - this is a
 * report, not a gate, and a wrapper must not read a verdict off its status.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildIndex, blastRadius } from './palate-index.mjs';

// ------------------------------------------------------------------ defaults

export const DEFAULTS = {
  windowDays: 30,     // how far before the onset a merge can still be the cause
  lagDays: 2,         // onset detection is +/- a day or two; allow that much after
  minDays: 14,        // two whole weeks each side, so weekday mix cannot fake a drop
  minClicks: 30,      // total clicks in the before window, under which nothing is sayable
  minDrop: 0.25,      // relative decline that counts as material
  minExcess: 0.15,    // how far a route must fall BEYOND the sitewide move
  minZ: 2,            // Poisson-ish screen, so a 30% wobble on thin data is not a finding
  ignoreLastDays: 3,  // Search Console's freshest days are incomplete and always slope down
  sitewideDrop: 0.15, // sitewide decline above which nothing is attributed to one merge
  sitewideBreadth: 0.5, // ...and the share of trafficked pages that must have fallen with it
};

// ------------------------------------------------------------------ csv/json

/** RFC4180-ish. Search Console quotes any field containing a comma. */
function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "1,234" and "2.73%" are both numbers in a Search Console export. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[,\s%]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim());
const dayNo = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const addDays = (d, n) => new Date((dayNo(d) + n) * 86400000).toISOString().slice(0, 10);

/** A Search Console page URL as a route path. */
export function toPath(url) {
  let s = String(url ?? '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/[^/]+/i, '');
  s = s.split('#')[0].split('?')[0];
  if (!s.startsWith('/')) s = '/' + s;
  try { s = decodeURI(s); } catch { /* leave it encoded, still comparable */ }
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : '/';
}

/**
 * Does a route from the index serve this real URL path? `/blog/[slug]` serves
 * `/blog/anything` but not `/blog/anything/deeper`, and blastRadius already
 * substitutes entry ids so concrete paths turn up too.
 */
export function routeMatches(routePath, actual) {
  if (routePath === actual) return true;
  const i = routePath.indexOf('[');
  if (i === -1) return false;
  const prefix = routePath.slice(0, i);
  if (!actual.startsWith(prefix)) return false;
  return !actual.slice(prefix.length).includes('/');
}

/**
 * Read whatever Search Console gave you.
 *
 * Three shapes turn up in the wild and all three are supported, because telling
 * someone their export is the wrong one is how a tool goes unused:
 *   SERIES   page + date rows (the API, Looker Studio, a BigQuery export)
 *   COMPARE  one row per page with two click columns (the UI's date comparison)
 *   TOTALS   one row per page, one period. Not enough to attribute anything,
 *            and it is told so rather than being silently half-analysed.
 */
export function parseExport(text, file = 'export') {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return { ok: false, error: `${file} is empty` };

  if (t.startsWith('{') || t.startsWith('[')) return parseJson(t, file);

  const lines = t.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { ok: false, error: `${file} has a header and no rows` };
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map(splitCsvLine).map((cells) => {
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });
  return fromRows(rows, header, file);
}

function parseJson(t, file) {
  let data;
  try { data = JSON.parse(t); } catch (e) { return { ok: false, error: `${file} is not valid JSON: ${e.message}` }; }
  let rows = Array.isArray(data) ? data : data.rows;
  if (!Array.isArray(rows)) return { ok: false, error: `${file}: expected an array of rows, or {"rows":[...]}` };

  // The Search Analytics API shape: dimension values live in `keys`, and their
  // order is whatever dimensions were requested, so sniff rather than assume.
  rows = rows.map((r) => {
    if (!Array.isArray(r?.keys)) return r;
    const o = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
    for (const k of r.keys) {
      if (isDate(k)) o.date = k;
      else if (/^(https?:|\/)/.test(String(k))) o.page = k;
    }
    return o;
  });
  const header = [...new Set(rows.flatMap((r) => Object.keys(r || {})))];
  return fromRows(rows, header, file);
}

/** Find the one column whose name means `want`, tolerantly. */
function col(header, want) {
  const lc = header.map((h) => String(h).toLowerCase());
  const exact = lc.indexOf(want);
  if (exact !== -1) return header[exact];
  const alias = {
    page: ['top pages', 'url', 'landing page', 'address', 'page url'],
    date: ['day'],
    clicks: ['url clicks', 'click'],
    impressions: ['impr.', 'impression'],
  }[want] || [];
  for (const a of alias) { const i = lc.indexOf(a); if (i !== -1) return header[i]; }
  const loose = lc.findIndex((h) => h === want || h.startsWith(want + ' ') || h.endsWith(' ' + want));
  return loose !== -1 ? header[loose] : null;
}

function fromRows(rows, header, file) {
  const pageCol = col(header, 'page');
  if (!pageCol) return { ok: false, error: `${file}: no page column (looked for page/Top pages/url). Header: ${header.join(', ')}` };
  const dateCol = col(header, 'date');

  // Resolved once. A sixteen-month export is a quarter of a million rows and
  // this used to re-scan the header on every one of them.
  const clickCol = col(header, 'clicks');
  const imprCol = col(header, 'impressions');

  if (dateCol) {
    const series = new Map();
    let bad = 0;
    for (const r of rows) {
      const p = toPath(r[pageCol]);
      const d = String(r[dateCol] ?? '').trim();
      if (!p || !isDate(d)) { bad++; continue; }
      if (!series.has(p)) series.set(p, new Map());
      const s = series.get(p);
      const prev = s.get(d) || { clicks: 0, impressions: 0 };
      s.set(d, { clicks: prev.clicks + num(r[clickCol]), impressions: prev.impressions + num(r[imprCol]) });
    }
    if (!series.size) return { ok: false, error: `${file}: found a date column but no parseable rows` };
    return { ok: true, shape: 'series', series, skipped: bad, file };
  }

  // No date column. Two click columns means the UI's period comparison.
  const clickCols = header.filter((h) => /click/i.test(String(h)));
  const imprCols = header.filter((h) => /impr/i.test(String(h)));
  if (clickCols.length >= 2) {
    const order = orderComparisonColumns(clickCols);
    if (!order) {
      return { ok: false, error:
        `${file}: two click columns (${clickCols.join(' / ')}) but nothing says which period is earlier. ` +
        `Rename one to contain "previous" and the other "last", or export page-by-date rows. ` +
        `Guessing would report a rise as a fall.` };
    }
    const imprOrder = imprCols.length >= 2 ? orderComparisonColumns(imprCols) : null;
    const pages = new Map();
    for (const r of rows) {
      const p = toPath(r[pageCol]);
      if (!p) continue;
      const prev = pages.get(p) || { clicksBefore: 0, clicksAfter: 0, imprBefore: 0, imprAfter: 0 };
      pages.set(p, {
        clicksBefore: prev.clicksBefore + num(r[order.before]),
        clicksAfter: prev.clicksAfter + num(r[order.after]),
        imprBefore: prev.imprBefore + (imprOrder ? num(r[imprOrder.before]) : 0),
        imprAfter: prev.imprAfter + (imprOrder ? num(r[imprOrder.after]) : 0),
      });
    }
    return { ok: true, shape: 'compare', pages, columns: order, hasImpressions: Boolean(imprOrder), file };
  }

  return { ok: false, error:
    `${file}: one row per page and one period. That says what traffic IS, never when it changed, ` +
    `so nothing can be attributed. Re-export with a date dimension, or turn on date comparison.` };
}

/**
 * Which of two click columns is the earlier period. Refuses to guess: a
 * reversed comparison reports every rise as a fall, and that error is invisible
 * in the output.
 */
export function orderComparisonColumns(cols) {
  const lc = cols.map((c) => String(c).toLowerCase());
  const earlier = lc.findIndex((c) => /previous|prior|before|baseline/.test(c));
  const later = lc.findIndex((c) => /last|current|recent|latest|after/.test(c));
  if (earlier !== -1 && later !== -1 && earlier !== later) return { before: cols[earlier], after: cols[later] };

  // Fall back to date ranges written into the header (Clicks 3/1/26-3/28/26).
  const stamps = cols.map((c) => {
    const m = String(c).match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (!m) return null;
    const v = m[1].includes('-') ? m[1] : m[1].split('/').reverse().join('-');
    return v;
  });
  if (stamps.filter(Boolean).length === cols.length && new Set(stamps).size === cols.length) {
    const idx = stamps.map((s, i) => [s, i]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return { before: cols[idx[0][1]], after: cols[idx[idx.length - 1][1]] };
  }
  return null;
}

// ------------------------------------------------------------- decline maths

/**
 * Poisson-ish two-rate screen. Clicks are counts, so the variance of a daily
 * rate is the rate itself over the number of days. Without this a page holding
 * 4 clicks a day that dips to 2 reads as "down 50%", which is a coin flip
 * wearing a percentage.
 */
export function zScore(before, nb, after, na) {
  if (!nb || !na) return 0;
  const lb = before / nb, la = after / na;
  const se = Math.sqrt(lb / nb + la / na);
  return se === 0 ? 0 : (lb - la) / se;
}

/**
 * Where a series changed, by trying every split that leaves enough days on each
 * side and keeping the one with the strongest evidence. Cheap (the series is
 * days, not rows) and it does one thing an eyeballed chart cannot: it reports
 * how good the SECOND-best split was, so a series with no real changepoint is
 * visible as one where every split scores about the same.
 */
export function detectChangepoint(days, { minDays = DEFAULTS.minDays } = {}) {
  const n = days.length;
  if (n < minDays * 2) return { ok: false, reason: 'too-few-days', days: n, need: minDays * 2 };
  // Prefix sums, so the scan is linear in days rather than quadratic. On a
  // sixteen-month export of a few thousand pages the quadratic form is minutes.
  const pc = new Float64Array(n + 1), pi = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { pc[i + 1] = pc[i] + days[i].clicks; pi[i + 1] = pi[i] + days[i].impressions; }
  let best = null;
  for (let i = minDays; i <= n - minDays; i++) {
    const B = pc[i], A = pc[n] - pc[i];
    const z = zScore(B, i, A, n - i);
    if (!best || z > best.z) {
      best = {
        z, onset: days[i].date,
        beforeDays: i, afterDays: n - i,
        clicksBefore: B, clicksAfter: A,
        imprBefore: pi[i], imprAfter: pi[n] - pi[i],
      };
    }
  }
  if (!best) return { ok: false, reason: 'too-few-days', days: days.length, need: minDays * 2 };
  const rate = (c, n) => (n ? c / n : 0);
  return {
    ok: true, ...best,
    dailyBefore: rate(best.clicksBefore, best.beforeDays),
    dailyAfter: rate(best.clicksAfter, best.afterDays),
    drop: best.clicksBefore === 0 ? 0
      : 1 - rate(best.clicksAfter, best.afterDays) / rate(best.clicksBefore, best.beforeDays),
    imprDrop: best.imprBefore === 0 ? 0
      : 1 - rate(best.imprAfter, best.afterDays) / rate(best.imprBefore, best.beforeDays),
  };
}

/**
 * What KIND of decline this is, which is the cheapest useful diagnostic in the
 * whole file. Impressions held and clicks fell means Google still shows the
 * page and people stopped clicking it: a title, description or rich-result
 * change. Impressions fell too means the page is showing for fewer searches:
 * ranking, indexing or a content change. Those two point at completely
 * different merges, and the export already contains the answer.
 */
export function declineShape(drop, imprDrop, imprBefore, imprAfter) {
  // No impressions BEFORE means no impressions signal, either because the
  // export has no such column or because the page never showed. Without that
  // baseline every page reads as "deindexed", which is the most alarming thing
  // this file can say and would be said on no evidence at all.
  if (!imprBefore) return 'unknown';
  if (imprAfter === 0 && drop > 0) return 'deindexed';
  if (imprDrop < 0.10 && drop >= 0.25) return 'ctr';
  if (imprDrop >= 0.20 && Math.abs(imprDrop - drop) < 0.20) return 'visibility';
  return 'mixed';
}

const SHAPE_NOTE = {
  ctr: 'impressions held and clicks fell: Google still shows this page, fewer people click it. That is a snippet change (title, description, rich result), not a ranking change.',
  visibility: 'impressions fell with the clicks: the page is showing for fewer searches. Ranking, indexing or a content change.',
  deindexed: 'impressions went to zero: the page has stopped appearing at all. Check indexing before you check anything else.',
  mixed: 'clicks and impressions moved by different amounts, so the shape does not single out snippet or ranking on its own.',
  unknown: 'this export carries no impressions, so there is no way to tell a snippet change from a ranking change. Re-export with the impressions column and half the guesswork below disappears.',
};

// ---------------------------------------------------------------------- git

const strip = (files, prefix) =>
  (prefix ? files.filter((f) => f.startsWith(prefix + '/')).map((f) => f.slice(prefix.length + 1)) : files);

function git(repoDir, args) {
  // Capture stderr rather than letting it through: execFileSync forwards a
  // child's stderr to ours by default, so a plain "not a git repository" ran
  // git's own fatal: line ahead of the explanation written for it.
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The mainline, newest first, each entry carrying everything it INTRODUCED.
 *
 * `--first-parent` walks what landed on the branch you ship, and
 * `--diff-merges=first-parent` credits a merge with the whole branch rather
 * than showing nothing (git's default for merges) or every commit separately
 * with its original author date.
 */
export function mainline(repoDir, { since, until } = {}) {
  const SEP = '@@PLT@@';
  const base = ['log', '--first-parent', `--format=${SEP}%H%x09%cI%x09%an%x09%s`, '--name-status'];
  if (since) base.push(`--since=${since}`);
  if (until) base.push(`--until=${until}`);

  let out;
  try {
    out = git(repoDir, ['log', '--first-parent', '--diff-merges=first-parent', `--format=${SEP}%H%x09%cI%x09%an%x09%s`, '--name-status',
      ...(since ? [`--since=${since}`] : []), ...(until ? [`--until=${until}`] : [])]);
  } catch {
    // git < 2.31 has no --diff-merges, so merges arrive with no file list. Do
    // not silently return a merge with zero files: it would look innocent.
    try { out = git(repoDir, base); } catch (e) { return { ok: false, error: `git log failed: ${e.message}` }; }
  }

  const commits = [];
  for (const block of out.split(SEP).slice(1)) {
    const nl = block.indexOf('\n');
    const head = nl === -1 ? block : block.slice(0, nl);
    const [sha, date, author, ...rest] = head.split('\t');
    const files = [], removed = [];
    for (const line of (nl === -1 ? '' : block.slice(nl + 1)).split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const status = parts[0];
      if (/^R/.test(status) && parts.length >= 3) { removed.push(parts[1]); files.push(parts[2]); }
      else if (status === 'D' && parts[1]) removed.push(parts[1]);
      else if (parts[1]) files.push(parts[1]);
    }
    commits.push({ sha, short: sha.slice(0, 8), date: date.slice(0, 10), when: date, author, subject: rest.join('\t'), files, removed });
  }
  return { ok: true, commits };
}

/** A deleted `src/pages/x.astro` used to serve `/x`. The index cannot say so: the file is gone. */
export function routeOfPageFile(file) {
  const m = file.match(/(?:^|\/)src\/pages\/(.+)$/);
  if (!m) return null;
  let r = m[1].replace(/\.astro\.tpl$/, '').replace(/\.(astro|md|mdx|ts|js)$/, '');
  if (r.endsWith('/index')) r = r.slice(0, -'/index'.length);
  if (r === 'index') r = '';
  return '/' + r;
}

// -------------------------------------------------------------------- scoring

const r3 = (n) => Math.round(n * 1000) / 1000;
const todayISO = () => new Date().toISOString().slice(0, 10);

const SURFACE = {
  head: /(layout|head|seo|meta|title|schema|jsonld|json-ld|opengraph|og-)/i,
  indexing: /(sitemap|robots|llms\.txt|canonical|redirect|middleware|vercel\.json|netlify\.toml|_headers)/i,
  content: /^src\/content\//,
  links: /(nav|header|footer|menu|breadcrumb|sidebar)/i,
};

/** Does what this commit touched match the SHAPE of the decline it is accused of? */
function surfaceScore(files, shape) {
  const hit = (re) => files.some((f) => re.test(f));
  if (shape === 'ctr') return hit(SURFACE.head) ? 1 : 0.5;
  if (shape === 'deindexed') return hit(SURFACE.indexing) ? 1 : 0.5;
  if (shape === 'visibility') return (hit(SURFACE.content) || hit(SURFACE.links) || hit(SURFACE.indexing)) ? 1 : 0.5;
  return 0.5;
}

/**
 * How well a merge lines up with a decline.
 *
 * Three parts, all printed, because a single blended number nobody can take
 * apart is exactly the sort of confident output this file is trying not to be.
 *
 *   TIMING       search effects LAG the merge (Google has to recrawl), so a
 *                merge after the onset is close to disqualified and one a month
 *                earlier is weak. Full credit sits in the fortnight before.
 *   SPECIFICITY  of the trafficked pages this merge touched, how many actually
 *                fell. This is the discriminator that matters: a merge touching
 *                only the page that fell is a suspect, one touching all forty
 *                when one fell explains nothing about why THAT one.
 *   SURFACE      whether the files fit the shape of the loss.
 */
export function scoreCandidate({ daysBefore, touchedPages, declinedTouched, files, shape, removedRoute, onsetKnown }, opt = DEFAULTS) {
  if (removedRoute) {
    return { score: 0.98, timing: 1, specificity: 1, surface: 1, certain: true,
      why: 'this merge deleted the file that served the page' };
  }
  const timing = daysBefore < -opt.lagDays ? 0
    : daysBefore < 0 ? 0.35                                   // after the onset: only if the onset is a day or two out
    : daysBefore <= 14 ? 1
    : Math.max(0.2, 1 - (daysBefore - 14) / (opt.windowDays - 14) * 0.8);
  const specificity = touchedPages > 0 ? declinedTouched / touchedPages : 0;
  const surface = surfaceScore(files, shape);
  let score = 0.40 * timing + 0.45 * specificity + 0.15 * surface;
  // An unknown onset means the window is a period boundary, not a day. The
  // ranking is still worth having; the confidence is not.
  if (!onsetKnown) score *= 0.6;
  return { score: r3(score), timing: r3(timing), specificity: r3(specificity), surface, certain: false };
}

/**
 * Specificity caps the label, not just the score. A merge that touched every
 * page cannot explain why THIS one fell and the others did not, however neatly
 * it lines up in time, and calling it "strong" is the exact overclaim this file
 * exists to avoid. Run against a real repo, a commit touching MOTION_BUDGET.md
 * came back "strong" purely on timing. It is now capped at "possible".
 */
const CONFIDENCE = (score, specificity, onsetKnown = true) => {
  const band = score >= 0.6 ? 'strong' : score >= 0.35 ? 'possible' : 'weak';
  if (band === 'strong' && specificity < 0.5) return 'possible';
  // WITHOUT A KNOWN ONSET, NOTHING IS STRONG, AND THIS ENFORCES IT IN CODE.
  //
  // Every comparison-shape report prints "no candidate can be called strong".
  // That was prose, not a rule: a perfect candidate scores 1.0, the unknown-onset
  // penalty multiplies by 0.6, and the band cut is >= 0.6, so exactly 0.6 landed
  // in `strong` and the report contradicted its own caveat one line later. A
  // report that disagrees with itself is worse than one that says less, because
  // the reader has no way to know which half to believe.
  if (!onsetKnown && band === 'strong') return 'possible';
  return band;
};

/** What would settle it. Concrete commands, not advice. */
function evidence(c, route, shape, url) {
  const out = [];
  if (c.removedRoute) {
    out.push(`confirm: \`git show ${c.short} --stat\` - the file serving ${route} is deleted in it.`);
    out.push(`confirm: does the live URL still 200? If it 404s or redirects elsewhere, this is the cause and not a candidate.`);
    return out;
  }
  // --stat, not a pathspec: listing the first three of forty files would look
  // like the whole change and quietly hide the file that did the damage.
  out.push(`confirm: \`git show --stat ${c.short}\` - ${c.filesChanged} file(s), and it is on ${route}'s dependency path.`);
  if (shape === 'ctr') {
    out.push(`confirm: diff the rendered <title> and <meta name="description"> for ${route} at ${c.short}^ and ${c.short}. A snippet rewrite moves CTR at unchanged position.`);
    out.push(`rule out: in Search Console, filter to ${url || route} and compare average position across the onset. If position fell too, the snippet is not the story.`);
  } else if (shape === 'deindexed') {
    out.push(`confirm: run URL Inspection on ${url || route}. A noindex, a canonical pointing elsewhere or a robots rule shipped in this merge would show as excluded.`);
    out.push(`rule out: if the URL inspects as indexed and the impressions are still gone, this is a ranking collapse and not an indexing change.`);
  } else {
    out.push(`confirm: compare the query list for this page before and after the onset. Fewer queries at the same position means content or internal links changed, which this merge can be checked for.`);
    out.push(`rule out: if the same queries rank at the same position and impressions still fell, the change is on Google's side, not in this merge.`);
  }
  out.push(`rule out: nothing here closes the case. Reverting on one route and watching for a fortnight is the only test that does.`);
  return out;
}

// ------------------------------------------------------------------ analysis

/**
 * The whole join. Deliberately pure over (index, parsed export, commits) so the
 * tests can build all three by hand and no test needs a network or a Google
 * account.
 */
export function analyse({ index, parsed, commits, opt = DEFAULTS, gitError = null }) {
  const o = { ...DEFAULTS, ...opt };
  const notes = [];

  // ---- normalise both shapes into one per-page record ----------------------
  let pages = [];
  let sitewide = null;
  let onsetKnown = parsed.shape === 'series';

  if (parsed.shape === 'series') {
    const allDates = [...new Set([...parsed.series.values()].flatMap((m) => [...m.keys()]))].sort();
    const cut = o.ignoreLastDays > 0 ? allDates.slice(0, Math.max(0, allDates.length - o.ignoreLastDays)) : allDates;
    if (o.ignoreLastDays > 0 && allDates.length !== cut.length) {
      notes.push(`dropped the last ${allDates.length - cut.length} day(s) of the export (${cut.length ? addDays(cut[cut.length - 1], 1) : '?'} onward): Search Console backfills those and they always slope down.`);
    }
    const dense = (m) => cut.map((d) => ({ date: d, ...(m.get(d) || { clicks: 0, impressions: 0 }) }));

    // The site as a whole, on the same instrument, before any route is judged.
    const total = new Map();
    for (const m of parsed.series.values()) {
      for (const d of cut) {
        const v = m.get(d) || { clicks: 0, impressions: 0 };
        const p = total.get(d) || { clicks: 0, impressions: 0 };
        total.set(d, { clicks: p.clicks + v.clicks, impressions: p.impressions + v.impressions });
      }
    }
    sitewide = detectChangepoint(cut.map((d) => ({ date: d, ...total.get(d) })), o);

    for (const [path, m] of parsed.series) {
      const days = dense(m);
      const cp = detectChangepoint(days, o);
      pages.push({ path, days, cp, firstSeen: [...m.keys()].sort()[0] });
    }
  } else {
    for (const [path, v] of parsed.pages) {
      pages.push({
        path,
        cp: {
          ok: true, onset: null, z: zScore(v.clicksBefore, 1, v.clicksAfter, 1),
          clicksBefore: v.clicksBefore, clicksAfter: v.clicksAfter,
          dailyBefore: v.clicksBefore, dailyAfter: v.clicksAfter, // one "day" = one period
          imprBefore: v.imprBefore, imprAfter: v.imprAfter,
          beforeDays: 1, afterDays: 1,
          drop: v.clicksBefore ? 1 - v.clicksAfter / v.clicksBefore : 0,
          imprDrop: v.imprBefore ? 1 - v.imprAfter / v.imprBefore : 0,
        },
      });
    }
    const sum = (k) => pages.reduce((s, p) => s + p.cp[k], 0);
    const B = sum('clicksBefore'), A = sum('clicksAfter');
    sitewide = { ok: true, onset: null, clicksBefore: B, clicksAfter: A, dailyBefore: B, dailyAfter: A, beforeDays: 1, afterDays: 1,
      z: zScore(B, 1, A, 1), drop: B ? 1 - A / B : 0,
      imprBefore: sum('imprBefore'), imprAfter: sum('imprAfter'),
      imprDrop: sum('imprBefore') ? 1 - sum('imprAfter') / sum('imprBefore') : 0 };
  }

  // A comparison export has no dates in it, so there is no onset to search
  // around. Without a bound every merge in the repo's history becomes a
  // candidate for every page, which is not a ranking, it is a git log. Take the
  // boundary the caller names, or the day the report is run, and say which.
  const assumedOnset = parsed.shape === 'compare' ? (o.onset || todayISO()) : null;
  if (assumedOnset) {
    notes.push(`this is a two-period comparison, so the export cannot say WHICH DAY the decline began. ` +
      `Merges are searched in the ${o.windowDays} days before ${assumedOnset}${o.onset ? '' : ' (today, because --onset was not given)'}, ` +
      `and no candidate can be called strong. Export page-by-date rows for a real onset.`);
  }

  const siteDrop = sitewide.ok ? sitewide.drop : 0;

  // ---- what each mainline commit touched -----------------------------------
  // Which pages materially fell, decided once. Recomputing this inside the
  // per-page x per-commit loop made the join quadratic in pages, and the worst
  // case is the common one: a config change fails wide to every route, so a
  // single commit "touches" all of them.
  // The volume floor belongs here too: without it a page the report calls
  // "insufficient data" still counts as a decline inside another commit's
  // specificity score, so the two halves of the output disagree.
  const trafficked = pages.filter((p) => p.cp.ok && p.cp.clicksBefore >= o.minClicks);
  const declined = new Set(trafficked
    .filter((p) => (p.cp.drop ?? 0) >= o.minDrop && p.cp.z >= o.minZ)
    .map((p) => p.path));

  /**
   * "Sitewide" has to mean BROAD, not merely large. A four-page site where one
   * page collapses moves the site total by a quarter, and the aggregate alone
   * would then announce that the whole site fell together, suppress the one
   * real finding, and be wrong twice. Verified against a real repo, where
   * exactly that happened. So it also has to have hit most of the pages that
   * carry traffic, on a site with enough pages for the word to mean anything.
   */
  const breadth = trafficked.length ? declined.size / trafficked.length : 0;
  const sitewideMove = sitewide.ok && siteDrop >= o.sitewideDrop && sitewide.z >= o.minZ
    && trafficked.length >= 3 && breadth >= o.sitewideBreadth;

  const gsPaths = pages.map((p) => p.path);
  const enriched = (commits || []).map((c) => {
    // A deleted page file cannot be resolved through the index (the route is
    // gone from it) and would fail wide to every route, which is the opposite
    // of the truth: a deletion is the most specific change there is.
    const removedRoutes = c.removed.map(routeOfPageFile).filter(Boolean);
    const touchedRoutes = c.files.length ? blastRadius(index, c.files) : [];
    const other = c.removed.filter((f) => !routeOfPageFile(f));
    if (other.length) for (const r of blastRadius(index, other)) touchedRoutes.push(r);
    const touched = gsPaths.filter((p) => touchedRoutes.some((rp) => routeMatches(rp, p)));
    return {
      ...c, touchedRoutes: [...new Set(touchedRoutes)], removedRoutes, touchedPages: touched,
      declinedTouched: touched.filter((p) => declined.has(p)).length,
    };
  });

  // ---- judge each page -----------------------------------------------------
  const findings = [];
  for (const p of pages) {
    const cp = p.cp;
    const served = index.routes.find((r) => routeMatches(r.path, p.path)) || null;
    const removedBy = enriched.find((c) => c.removedRoutes.some((rp) => routeMatches(rp, p.path))) || null;

    // Totals AND rates, because the two windows are almost never the same
    // length. Every percentage in this file is computed from the daily rate, so
    // printing totals beside it produced "544 -> 459 clicks, down 74%" on a
    // real run, and a line that contradicts itself is worse than no line.
    const base = {
      page: p.path, route: served?.path ?? null, source: served?.source ?? null,
      clicksBefore: cp.clicksBefore, clicksAfter: cp.clicksAfter,
      beforeDays: cp.beforeDays, afterDays: cp.afterDays,
      dailyBefore: r3(cp.dailyBefore ?? 0), dailyAfter: r3(cp.dailyAfter ?? 0),
      onset: cp.onset,
      drop: r3(cp.drop ?? 0), imprDrop: r3(cp.imprDrop ?? 0), z: r3(cp.z ?? 0),
      attributable: false, suspects: [],
    };

    if (!cp.ok) { findings.push({ ...base, verdict: 'insufficient-data', reason: `${cp.days} day(s) of data, ${cp.need} needed (${o.minDays} each side of a changepoint)` }); continue; }
    if (cp.clicksBefore < o.minClicks) {
      findings.push({ ...base, verdict: 'insufficient-data',
        reason: `${cp.clicksBefore} clicks before the split, floor is ${o.minClicks}. At this volume a normal week's noise looks like a ${Math.round((cp.drop ?? 0) * 100)}% decline.` });
      continue;
    }
    // A route with no history has not declined, it has started.
    if (parsed.shape === 'series' && p.firstSeen && cp.onset && dayNo(p.firstSeen) > dayNo(cp.onset) - o.minDays) {
      findings.push({ ...base, verdict: 'too-new', reason: `first appears in the export on ${p.firstSeen}, which leaves no real before-window` });
      continue;
    }
    if ((cp.drop ?? 0) < o.minDrop || cp.z < o.minZ) {
      const d = cp.drop ?? 0;
      findings.push({ ...base, verdict: 'stable',
        reason: `${d < 0 ? `up ${Math.round(-d * 100)}%` : `down ${Math.round(d * 100)}%`} at z=${r3(cp.z)}; material is a fall of ${Math.round(o.minDrop * 100)}% at z>=${o.minZ}` });
      continue;
    }

    const excess = cp.drop - siteDrop;
    const shape = declineShape(cp.drop, cp.imprDrop, cp.imprBefore ?? 0, cp.imprAfter ?? 0);

    if (sitewideMove && excess < o.minExcess) {
      findings.push({ ...base, verdict: 'sitewide', shape,
        reason: `down ${Math.round(cp.drop * 100)}% while the whole site fell ${Math.round(siteDrop * 100)}%. ` +
          `This page moved with the site, so no merge to this route explains it.` });
      continue;
    }

    // Only now is it worth asking git anything.
    if (gitError) { findings.push({ ...base, verdict: 'declined', shape, reason: `real decline, but the history could not be read: ${gitError}` }); continue; }

    const onsetDay = cp.onset ? dayNo(cp.onset) : assumedOnset ? dayNo(assumedOnset) : null;
    const cands = [];
    for (const c of enriched) {
      const touchesThis = c.touchedPages.includes(p.path) || c.removedRoutes.some((rp) => routeMatches(rp, p.path));
      if (!touchesThis) continue;
      const daysBefore = onsetDay === null ? 7 : onsetDay - dayNo(c.date);
      if (onsetDay !== null && (daysBefore > o.windowDays || daysBefore < -o.lagDays)) continue;
      const declinedTouched = c.declinedTouched;
      const removedRoute = c.removedRoutes.some((rp) => routeMatches(rp, p.path));
      const s = scoreCandidate({
        daysBefore, touchedPages: c.touchedPages.length || 1, declinedTouched: declinedTouched || (removedRoute ? 1 : 0),
        files: [...c.files, ...c.removed], shape, removedRoute, onsetKnown,
      }, o);
      cands.push({
        sha: c.sha, short: c.short, date: c.date, author: c.author, subject: c.subject,
        daysBeforeOnset: daysBefore, filesChanged: c.files.length + c.removed.length,
        files: [...c.files, ...c.removed].slice(0, 6),
        pagesTouched: c.touchedPages.length, pagesTouchedThatFell: declinedTouched,
        removedRoute, ...s,
        confidence: s.certain ? 'near-certain' : CONFIDENCE(s.score, s.specificity, onsetKnown),
      });
    }
    cands.sort((a, b) => b.score - a.score || a.daysBeforeOnset - b.daysBeforeOnset);
    const top = cands.slice(0, 5).map((c) => ({ ...c, evidence: evidence({ ...c, removedRoute: c.removedRoute }, p.path, shape, p.path) }));

    let separation = null;
    if (top.length >= 2 && top[0].score - top[1].score < 0.05 && !top[0].certain) {
      separation = `the top ${top.filter((c) => top[0].score - c.score < 0.05).length} candidates score within 0.05 of each other; the timing cannot separate them.`;
    }

    findings.push({
      ...base, verdict: top.length ? 'attributable' : 'declined', attributable: top.length > 0, shape,
      shapeNote: SHAPE_NOTE[shape], excessOverSite: r3(excess), suspects: top, separation,
      reason: top.length
        ? `down ${Math.round(cp.drop * 100)}%${cp.onset ? ` from ${cp.onset}` : ''} (site ${siteDrop >= 0 ? 'down' : 'up'} ${Math.abs(Math.round(siteDrop * 100))}%), ${top.length} merge(s) in the ${o.windowDays} days before it touched this route`
        : `down ${Math.round(cp.drop * 100)}%${cp.onset ? ` from ${cp.onset}` : ''}, and NO merge in the ${o.windowDays} days before touched anything this route depends on. Look outside the repo: a Google update, a lost backlink, a competitor, or a change made outside git.`,
    });
  }

  // Pages Google has that this repo does not serve. The interesting half is the
  // ones that used to earn clicks: a page that vanished is the loudest possible
  // cause and it never appears as a "route that declined", because there is no
  // route left to look at.
  const unmatched = findings.filter((f) => !f.route && !enriched.some((c) => c.removedRoutes.some((rp) => routeMatches(rp, f.page))));

  findings.sort((a, b) => (b.suspects.length ? 1 : 0) - (a.suspects.length ? 1 : 0) || (b.clicksBefore - b.clicksAfter) - (a.clicksBefore - a.clicksAfter));

  return {
    shape: parsed.shape,
    window: parsed.shape === 'series' ? { onsetKnown: true } : { onsetKnown: false },
    sitewide: {
      ...(sitewide.ok ? {
        clicksBefore: sitewide.clicksBefore, clicksAfter: sitewide.clicksAfter,
        dailyBefore: r3(sitewide.dailyBefore ?? 0), dailyAfter: r3(sitewide.dailyAfter ?? 0),
        beforeDays: sitewide.beforeDays, afterDays: sitewide.afterDays,
        drop: r3(sitewide.drop), z: r3(sitewide.z), onset: sitewide.onset,
      } : { ok: false, reason: sitewide.reason }),
      pagesWithVolume: trafficked.length, pagesThatFell: declined.size, breadth: r3(breadth),
      declining: sitewideMove,
      note: sitewideMove
        ? `the whole site fell together: ${declined.size} of ${trafficked.length} pages carrying real traffic fell with it. No single merge to one route explains a sitewide move, and a core update, seasonality or a reporting change is at least as likely. Routes that merely moved with the site are reported as such and given no suspects.`
        : null,
    },
    counts: {
      pages: findings.length,
      attributable: findings.filter((f) => f.attributable).length,
      declinedUnexplained: findings.filter((f) => f.verdict === 'declined').length,
      sitewide: findings.filter((f) => f.verdict === 'sitewide').length,
      insufficient: findings.filter((f) => f.verdict === 'insufficient-data').length,
      unmatchedPages: unmatched.length,
    },
    notes, findings, unmatched: unmatched.map((f) => f.page),
    caveat: 'These are suspects, not a cause. The join is correlation over a short window: a merge that lines up perfectly may be innocent, and the real cause may not be in this repo at all. Confirm one before you revert it.',
  };
}

// -------------------------------------------------------------------- report

function report(a, opt) {
  const L = [];
  L.push(`export shape       : ${a.shape}${a.shape === 'compare' ? ' (two periods, no onset date)' : ' (page by date)'}`);
  L.push(`pages in export    : ${a.counts.pages}`);
  if (a.sitewide.ok !== false) {
    L.push(`site total         : ${rateLine(a.sitewide)}, ${a.sitewide.drop >= 0 ? 'down' : 'up'} ${Math.abs(Math.round(a.sitewide.drop * 100))}%${a.sitewide.onset ? ` from ${a.sitewide.onset}` : ''}${totalsLine(a.sitewide)}`);
    L.push(`pages that fell    : ${a.sitewide.pagesThatFell} of ${a.sitewide.pagesWithVolume} carrying real traffic`);
  }
  for (const n of a.notes) L.push(`note               : ${n}`);
  if (a.sitewide.declining) {
    L.push('');
    L.push('SITEWIDE DECLINE');
    L.push(`  ${wrap(a.sitewide.note, 2)}`);
  }

  const attributable = a.findings.filter((f) => f.attributable);
  const unexplained = a.findings.filter((f) => f.verdict === 'declined');
  const sitewide = a.findings.filter((f) => f.verdict === 'sitewide');

  if (!attributable.length) {
    L.push('');
    L.push('No decline in this export can be pinned on a merge.');
  }
  for (const f of attributable) {
    L.push('');
    L.push(`${f.page}  ${rateLine(f)}, down ${Math.round(f.drop * 100)}%${f.onset ? ` from ${f.onset}` : ''}${totalsLine(f)}`);
    L.push(`  shape: ${f.shape}. ${wrap(f.shapeNote, 9)}`);
    if (f.separation) L.push(`  caution: ${f.separation}`);
    f.suspects.forEach((c, i) => {
      L.push(`  ${i + 1}. ${c.short}  ${c.date}  ${c.confidence} (${c.score})  ${c.subject}`);
      L.push(`     ${c.daysBeforeOnset >= 0 ? `${c.daysBeforeOnset}d before the onset` : `${-c.daysBeforeOnset}d AFTER the onset`}, ${c.filesChanged} file(s), touched ${c.pagesTouched} trafficked page(s) of which ${c.pagesTouchedThatFell} fell`);
      L.push(`     timing ${c.timing} / specificity ${c.specificity} / surface ${c.surface}`);
      for (const e of c.evidence) L.push(`     ${wrap(e, 5)}`);
    });
  }
  for (const f of sitewide) L.push(`\n${f.page}  down ${Math.round(f.drop * 100)}%  NOT ATTRIBUTED: ${wrap(f.reason, 2)}`);
  for (const f of unexplained) L.push(`\n${f.page}  down ${Math.round(f.drop * 100)}%  UNEXPLAINED: ${wrap(f.reason, 2)}`);
  if (a.counts.insufficient) L.push(`\n${a.counts.insufficient} page(s) skipped for too little data (floor: ${opt.minClicks} clicks before the split).`);
  if (a.unmatched.length) L.push(`\n${a.unmatched.length} page(s) in the export are not served by this repo: ${a.unmatched.slice(0, 5).join(', ')}${a.unmatched.length > 5 ? ' ...' : ''}`);
  L.push('');
  L.push(wrap(a.caveat, 0));
  return L.join('\n');
}

/**
 * The rate is the number the percentage came from, so the rate is what gets
 * printed beside it. Totals follow in brackets with their window lengths, which
 * is the only way they are not misleading when the windows differ.
 */
function rateLine(f) {
  const b = f.dailyBefore ?? 0, a = f.dailyAfter ?? 0;
  if (!f.beforeDays || f.beforeDays === 1) return `${Math.round(b)} -> ${Math.round(a)} clicks`;
  return `${b.toFixed(1)} -> ${a.toFixed(1)} clicks/day`;
}

const totalsLine = (f) =>
  (!f.beforeDays || f.beforeDays === 1 ? '' : `  [${f.clicksBefore} clicks over ${f.beforeDays}d, then ${f.clicksAfter} over ${f.afterDays}d]`);

function wrap(s, indent, width = 92) {
  if (!s) return '';
  const pad = ' '.repeat(indent);
  const words = String(s).split(/\s+/);
  const out = []; let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width - indent) { out.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out.join('\n' + pad);
}

// ---------------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, dflt) => {
    const i = argv.indexOf('--' + name);
    if (i === -1) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
  };
  // A junk value must fall back to the default, not become NaN: `?? default`
  // does not catch NaN, and a NaN threshold silently compares false against
  // everything, which turns every guard in this file off at once.
  const numFlag = (name) => {
    const v = flag(name);
    if (v === undefined || v === true) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) { console.error(`palate-traffic: --${name} needs a number, got "${v}". Using the default.`); return undefined; }
    return n;
  };

  const projectDir = resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : '.');
  const exportFile = flag('export');
  if (!exportFile || exportFile === true) {
    console.error('palate-traffic: --export <search-console.csv|json> is required.');
    console.error('  Search Console -> Performance -> Export. A CSV with page+date rows attributes best;');
    console.error('  a two-period comparison export works but cannot date the onset.');
    process.exit(2);
  }
  if (!existsSync(exportFile)) { console.error(`palate-traffic: no such file: ${exportFile}`); process.exit(2); }

  const index = buildIndex(projectDir);
  if (!index) {
    console.error(`palate-traffic: no src/pages in ${projectDir}, so there is no route graph to join against.`);
    process.exit(2);
  }

  const parsed = parseExport(readFileSync(exportFile, 'utf8'), basename(exportFile));
  if (!parsed.ok) { console.error(`palate-traffic: ${parsed.error}`); process.exit(2); }

  const opt = {
    ...DEFAULTS,
    windowDays: numFlag('window-days') ?? DEFAULTS.windowDays,
    minDays: numFlag('min-days') ?? DEFAULTS.minDays,
    minClicks: numFlag('min-clicks') ?? DEFAULTS.minClicks,
    minDrop: numFlag('min-drop') ?? DEFAULTS.minDrop,
    minExcess: numFlag('min-excess') ?? DEFAULTS.minExcess,
    ignoreLastDays: numFlag('ignore-last-days') ?? DEFAULTS.ignoreLastDays,
    onset: typeof flag('onset') === 'string' ? flag('onset') : null,
  };

  // Git paths are repo-relative; the index is project-relative. On a monorepo
  // they are not the same string, and a silent mismatch makes every commit look
  // like it touched nothing, which reads as "no merge could have done this".
  //
  // The prefix comes from `--show-prefix` rather than from comparing
  // `--show-toplevel` against the project directory, because those two strings
  // can differ for the same directory: on macOS /var is a symlink to
  // /private/var, git reports the resolved path, and subtracting one from the
  // other yields `../../../..` and strips every file. Git already knows where
  // it is; ask it.
  // Bound the log by date. Unbounded, `--name-status` over a long-lived
  // monorepo is hundreds of megabytes of output to build a candidate list that
  // can only ever contain commits from the window.
  const earliest = parsed.shape === 'series'
    ? [...parsed.series.values()].flatMap((m) => [...m.keys()]).sort()[0]
    : (opt.onset || todayISO());
  const since = earliest ? addDays(earliest, -(opt.windowDays + 7)) : undefined;

  let commits = [], gitError = null;
  try {
    const prefix = git(projectDir, ['rev-parse', '--show-prefix']).trim().replace(/\/$/, '');
    const ml = mainline(projectDir, { since });
    if (!ml.ok) gitError = ml.error;
    else commits = ml.commits.map((c) => ({
      ...c,
      files: strip(c.files, prefix),
      removed: strip(c.removed, prefix),
      outsideProject: prefix ? c.files.filter((f) => !f.startsWith(prefix + '/')).length : 0,
    }));
    if (git(projectDir, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
      console.error('palate-traffic: this is a shallow clone, so merges older than the fetch depth are invisible. `git fetch --unshallow` before trusting an empty candidate list.');
    }
  } catch (e) {
    gitError = `not a git repository, or git is unavailable (${e.message.split('\n')[0]})`;
  }

  const a = analyse({ index, parsed, commits, opt, gitError });
  if (argv.includes('--json')) console.log(JSON.stringify(a, null, 2));
  else console.log(report(a, opt));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
