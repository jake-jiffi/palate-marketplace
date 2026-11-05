#!/usr/bin/env node
/**
 * projected-vs-graded.mjs - does the plugin's LOCAL projected grade predict the PUBLIC grade?
 *
 * paired-grade.mjs answers a narrower question: it averages the shared deterministic checks
 * and compares populations. This one runs the grader's OWN rubric arithmetic (rubric.mjs,
 * byte-identical in both repos) exactly as verify-rendered.mjs does at the end of a build,
 * so the number it prints is the number the plugin would print, and it can be lined up
 * against the score the public grader actually stored for the same domain.
 *
 * The projection is deliberately partial and says so: the SigLIP appearance head and the
 * pairwise vision ladder own most of the design dimension and nothing here can reproduce
 * them. `measuredWeight` reports how much of the 100 the number rests on.
 *
 * Wiring copied from verify-rendered.mjs (the projection block):
 *   - design facts at desktop 1440x900 and mobile 390x844, after a real scroll to the bottom
 *   - vitals on a FRESH page at 390x844 under Lighthouse's slow-4G + 4x CPU lab conditions
 *   - axe-core at all three viewports, restricted to the rules the grader weights
 *   - the four axe-backed checks folded in as ZEROES when any viewport shows a violation
 *
 * Usage:
 *   node projected-vs-graded.mjs --in sites.json --out results.json
 *   sites.json: [{ "url": "...", "population": "real|palate|flagship", "graderScore": 42 }]
 *
 * A site that cannot be loaded is reported as unreachable and kept in the output. It is
 * never silently dropped: a missing row is indistinguishable from a passing one.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { measurePage, scoreDesignFacts } from './design-measure.mjs';
import { measureVitals, scoreVitals } from './vitals.mjs';
import { score as scoreRubric } from './rubric.mjs';

const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] != null) args[m[1]] = m[2];
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[m[1]] = argv[++i];
    else args[m[1]] = true;
  }
}
const sites = JSON.parse(readFileSync(args.in, 'utf8'));
const outPath = args.out || 'projected-vs-graded.json';

// Same rule list and same grader-check mapping as verify-rendered.mjs.
const AXE_RULES = {
  'color-contrast': 'text_contrast',
  'button-name': 'control_accessible_names',
  'link-name': 'control_accessible_names',
  'input-button-name': 'control_accessible_names',
  'select-name': 'control_accessible_names',
  'label': 'forms_and_errors',
  'form-field-multiple-labels': 'forms_and_errors',
  'html-has-lang': 'structure_and_landmarks',
  'document-title': 'structure_and_landmarks',
  'image-alt': 'structure_and_landmarks',
  'landmark-one-main': 'structure_and_landmarks',
  'heading-order': 'quotable_chunk_structure',
};
// A missing dependency is a blocked run, not a clean one.
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1440, height: 900 },
};

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });

async function settle(page) {
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1100)));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
}

async function runAxe(page) {
  const hits = [];
  try {
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(
      (rules) => window.axe.run(document, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] }),
      Object.keys(AXE_RULES),
    );
    for (const v of res.violations || []) {
      if (!AXE_RULES[v.id]) continue;
      hits.push({ rule: v.id, check: AXE_RULES[v.id], nodes: v.nodes.length });
    }
  } catch (e) {
    return { hits: null, error: String(e && e.message ? e.message : e).slice(0, 160) };
  }
  return { hits, error: null };
}

// Page weight, for the confound control. Same definitions paired-grade.mjs reports.
const complexity = () => ({
  nodes: document.querySelectorAll('*').length,
  controls: document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"]').length,
  media: document.querySelectorAll('img,video,iframe,picture,svg').length,
  height: document.body ? document.body.scrollHeight : 0,
  internalRoutes: new Set([...document.querySelectorAll('a[href]')]
    .map((a) => { try { const u = new URL(a.href, location.href); return u.origin === location.origin ? u.pathname : null; } catch { return null; } })
    .filter(Boolean)).size,
});

async function measure(site) {
  const row = { ...site, unreachable: false, errors: [] };
  const facts = {};
  const axeByViewport = {};

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    let ctx;
    try {
      ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      await page.goto(site.url, { waitUntil: 'load', timeout: 40000 });
      await settle(page);
      if (vpName === 'desktop' || vpName === 'mobile') facts[vpName] = await measurePage(page);
      if (vpName === 'desktop') row.complexity = await page.evaluate(complexity);
      axeByViewport[vpName] = await runAxe(page);
    } catch (e) {
      row.errors.push(vpName + ': ' + String(e && e.message ? e.message : e).slice(0, 160));
    } finally { try { if (ctx) await ctx.close(); } catch {} }
  }

  if (!facts.desktop && !facts.mobile) { row.unreachable = true; return row; }

  let vitals = null;
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
    vitals = await measureVitals(await ctx.newPage(), site.url);
    await ctx.close();
  } catch (e) { row.errors.push('vitals: ' + String(e && e.message ? e.message : e).slice(0, 160)); }

  const designScored = scoreDesignFacts(facts);
  const vitalsScored = scoreVitals(vitals);

  // --- the projection, wired exactly as verify-rendered.mjs does it -----------
  const m = new Map();
  for (const c of [...designScored, ...vitalsScored]) {
    if (c.raw === null || c.applicable === false) continue;
    m.set(c.id, { id: c.id, raw: c.raw, detail: c.detail, lowConfidence: !!c.lowConfidence });
  }
  const allHits = Object.values(axeByViewport).flatMap((a) => (a && a.hits) || []);
  const axeHit = (check) => allHits.some((h) => h.check === check);
  for (const id of ['text_contrast', 'control_accessible_names', 'forms_and_errors', 'structure_and_landmarks']) {
    if (axeHit(id)) m.set(id, { id, raw: 0, detail: 'An axe violation was found on the rendered page.', lowConfidence: false });
  }
  const projected = m.size ? scoreRubric(m) : null;

  // --- a symmetric variant, as a sensitivity check ---------------------------
  // The wiring above can only ever PENALISE accessibility: a clean page leaves those four
  // checks unmeasured, so the accessibility dimension enters the denominator for failing
  // sites and not for clean ones. This variant credits a clean axe run with 1.0 on the same
  // four checks, so the two numbers bracket the effect rather than arguing about it.
  const m2 = new Map(m);
  if (Object.values(axeByViewport).some((a) => a && a.hits)) {
    for (const id of ['text_contrast', 'control_accessible_names', 'forms_and_errors', 'structure_and_landmarks']) {
      if (!axeHit(id)) m2.set(id, { id, raw: 1, detail: 'No axe violation for this check at any viewport.', lowConfidence: false });
    }
  }
  const projectedSymmetric = m2.size ? scoreRubric(m2) : null;

  row.axe = axeByViewport;
  row.axeChecksFailed = [...new Set(allHits.map((h) => h.check))];
  row.axeRulesFailed = [...new Set(allHits.map((h) => h.rule))];
  row.designScored = designScored.map((c) => ({ id: c.id, raw: c.raw, applicable: c.applicable !== false, detail: c.detail }));
  row.vitalsScored = vitalsScored.map((c) => ({ id: c.id, raw: c.raw, applicable: c.applicable !== false, detail: c.detail }));
  row.vitalsRaw = vitals && vitals.applicable ? { lcpMs: vitals.lcpMs, clsScore: vitals.clsScore, tbtMs: vitals.tbtMs, scriptBytes: vitals.scriptBytes } : { applicable: false, reason: vitals && vitals.reason };
  row.projected = projected && {
    overall: projected.overall, band: projected.band.band, measuredWeight: projected.measuredWeight,
    caps: projected.caps,
    dimensions: projected.dimensions.map((d) => ({ id: d.id, score: d.score, measured: d.measured, total: d.total, weight: d.weight })),
    checks: projected.dimensions.flatMap((d) => d.checks.map((c) => ({ id: c.id, raw: Math.round(c.raw * 1000) / 1000, points: c.points, dimension: d.id }))),
  };
  row.projectedSymmetric = projectedSymmetric && { overall: projectedSymmetric.overall, band: projectedSymmetric.band.band, measuredWeight: projectedSymmetric.measuredWeight };
  return row;
}

const out = [];
for (const site of sites) {
  const t0 = Date.now();
  const row = await measure(site);
  out.push(row);
  const tag = row.unreachable ? 'UNREACHABLE'
    : `${String(row.projected.overall).padStart(3)}/100 ${row.projected.band}  sym ${String(row.projectedSymmetric.overall).padStart(3)}  w${row.projected.measuredWeight}`;
  console.log(`${(site.population || '').padEnd(9)} ${tag}  ${site.graderScore != null ? 'grader ' + String(site.graderScore).padStart(3) : '           '}  ${site.url}  (${Math.round((Date.now() - t0) / 1000)}s)`);
  writeFileSync(outPath, JSON.stringify(out, null, 1));
}
await browser.close();
console.log('\nwrote ' + outPath + '  (' + out.length + ' rows, ' + out.filter((r) => r.unreachable).length + ' unreachable)');
